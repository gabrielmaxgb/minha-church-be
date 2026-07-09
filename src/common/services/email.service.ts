import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

import {
  buildPasswordResetEmailHtml,
  buildPasswordResetEmailText,
} from '../templates/password-reset-email.template';
import {
  buildEmailVerificationEmailHtml,
  buildEmailVerificationEmailText,
} from '../templates/email-verification-email.template';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('resend.apiKey') ?? '';

    this.resend = apiKey ? new Resend(apiKey) : null;
  }

  async sendPasswordResetEmail(
    to: string,
    resetUrl: string,
    userName: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logDevEmailLink('reset de senha', to, resetUrl);
      this.logger.warn(
        `RESEND_API_KEY não configurada — e-mail de reset não enviado para ${to}.`,
      );
      return;
    }

    const fromEmail = this.config.getOrThrow<string>('resend.fromEmail');
    const appUrl = this.config.getOrThrow<string>('appUrl');
    const emailContent = { userName, resetUrl, appUrl };

    await this.resend.emails.send({
      from: fromEmail,
      to,
      subject: 'Redefinir sua senha — MinhaChurch',
      html: buildPasswordResetEmailHtml(emailContent),
      text: buildPasswordResetEmailText(emailContent),
    });

    this.logDevEmailLink('reset de senha', to, resetUrl);
  }

  async sendEmailVerificationEmail(
    to: string,
    verifyUrl: string,
    userName: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logDevEmailLink('verificação de e-mail', to, verifyUrl);
      this.logger.warn(
        `RESEND_API_KEY não configurada — e-mail de verificação não enviado para ${to}.`,
      );
      return;
    }

    const fromEmail = this.config.getOrThrow<string>('resend.fromEmail');
    const appUrl = this.config.getOrThrow<string>('appUrl');
    const emailContent = { userName, verifyUrl, appUrl };

    try {
      await this.resend.emails.send({
        from: fromEmail,
        to,
        subject: 'Confirme seu e-mail — MinhaChurch',
        html: buildEmailVerificationEmailHtml(emailContent),
        text: buildEmailVerificationEmailText(emailContent),
      });

      this.logDevEmailLink('verificação de e-mail', to, verifyUrl);
    } catch (error) {
      this.logDevEmailLink('verificação de e-mail (falhou — use o link)', to, verifyUrl);
      this.logger.error(
        `Falha ao enviar verificação para ${to} via Resend`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private logDevEmailLink(kind: string, to: string, url: string): void {
    if (this.config.get<string>('nodeEnv') !== 'development') {
      return;
    }

    this.logger.log(`[dev] Link de ${kind} para ${to}: ${url}`);
  }
}
