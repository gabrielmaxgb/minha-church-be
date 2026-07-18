import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush, { type PushSubscription as WebPushSubscription } from 'web-push';

import { PrismaService } from '../../database/prisma.service';

export type PushPayload = {
  title: string;
  body?: string | null;
  href?: string | null;
  tag?: string;
};

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private configured = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const publicKey = this.config.get<string>('webPush.vapidPublicKey') ?? '';
    const privateKey = this.config.get<string>('webPush.vapidPrivateKey') ?? '';
    const subject = this.config.get<string>('webPush.vapidSubject') ?? '';

    if (publicKey && privateKey && subject) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.configured = true;
    } else {
      this.logger.warn(
        'Web Push desligado: defina VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY e VAPID_SUBJECT.',
      );
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  getPublicKey(): string {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Notificações push não estão configuradas neste ambiente.',
      );
    }

    return this.config.getOrThrow<string>('webPush.vapidPublicKey');
  }

  async getStatus(userId: string): Promise<{
    configured: boolean;
    enabled: boolean;
    subscriptionCount: number;
  }> {
    if (!this.configured) {
      return { configured: false, enabled: false, subscriptionCount: 0 };
    }

    const subscriptionCount = await this.prisma.pushSubscription.count({
      where: { userId },
    });

    return {
      configured: true,
      enabled: subscriptionCount > 0,
      subscriptionCount,
    };
  }

  async upsertSubscription(
    userId: string,
    input: {
      endpoint: string;
      keys: { p256dh: string; auth: string };
      userAgent?: string | null;
    },
  ): Promise<{ ok: true }> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'Notificações push não estão configuradas neste ambiente.',
      );
    }

    const endpoint = input.endpoint.trim();
    const p256dh = input.keys.p256dh.trim();
    const auth = input.keys.auth.trim();

    if (!endpoint || !p256dh || !auth) {
      throw new BadRequestException('Subscription de push inválida.');
    }

    await this.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: {
        userId,
        endpoint,
        p256dh,
        auth,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
      },
      update: {
        userId,
        p256dh,
        auth,
        userAgent: input.userAgent?.slice(0, 512) ?? null,
      },
    });

    return { ok: true };
  }

  async removeSubscription(
    userId: string,
    endpoint: string,
  ): Promise<{ ok: true }> {
    const trimmed = endpoint.trim();
    if (!trimmed) {
      throw new BadRequestException('Endpoint obrigatório.');
    }

    await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint: trimmed },
    });

    return { ok: true };
  }

  /** Fire-and-forget: envia para todos os devices do usuário. */
  scheduleSendToUser(userId: string, payload: PushPayload): void {
    if (!this.configured) {
      return;
    }

    void this.sendToUser(userId, payload).catch((error: unknown) => {
      this.logger.warn(
        `Falha ao enviar push (user=${userId}): ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    });
  }

  async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    if (!this.configured) {
      return;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (subscriptions.length === 0) {
      return;
    }

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body ?? '',
      href: payload.href ?? '/app/dashboard',
      tag: payload.tag ?? 'minha-church',
    });

    await Promise.all(
      subscriptions.map(async (row) => {
        const subscription: WebPushSubscription = {
          endpoint: row.endpoint,
          keys: { p256dh: row.p256dh, auth: row.auth },
        };

        try {
          await webpush.sendNotification(subscription, body, {
            TTL: 60 * 60 * 12,
            urgency: 'normal',
          });
        } catch (error: unknown) {
          const statusCode =
            error &&
            typeof error === 'object' &&
            'statusCode' in error &&
            typeof (error as { statusCode?: unknown }).statusCode === 'number'
              ? (error as { statusCode: number }).statusCode
              : null;

          // 404/410 = subscription morta (app desinstalado / permissão revogada)
          if (statusCode === 404 || statusCode === 410) {
            await this.prisma.pushSubscription.deleteMany({
              where: { endpoint: row.endpoint },
            });
            return;
          }

          this.logger.warn(
            `Push rejeitado (endpoint=${row.endpoint.slice(0, 48)}…): ${
              error instanceof Error ? error.message : 'erro desconhecido'
            }`,
          );
        }
      }),
    );
  }

  async sendToUsers(userIds: string[], payload: PushPayload): Promise<void> {
    const unique = [...new Set(userIds.filter(Boolean))];
    await Promise.all(
      unique.map((userId) => this.sendToUser(userId, payload)),
    );
  }

  scheduleSendToUsers(userIds: string[], payload: PushPayload): void {
    if (!this.configured || userIds.length === 0) {
      return;
    }

    void this.sendToUsers(userIds, payload).catch((error: unknown) => {
      this.logger.warn(
        `Falha ao enviar push em lote: ${
          error instanceof Error ? error.message : 'erro desconhecido'
        }`,
      );
    });
  }
}
