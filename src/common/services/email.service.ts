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
import {
  buildPaymentFailedEmailHtml,
  buildPaymentFailedEmailText,
  buildSubscriptionCancelScheduledEmailHtml,
  buildSubscriptionCancelScheduledEmailText,
  buildSubscriptionCanceledEmailHtml,
  buildSubscriptionCanceledEmailText,
  buildSubscriptionConfirmedEmailHtml,
  buildSubscriptionConfirmedEmailText,
  buildTierUpgradeRequestEmailHtml,
  buildTierUpgradeRequestEmailText,
  type BillingEmailContent,
} from '../templates/billing-email.template';
import {
  buildMemberAccountLinkedEmailHtml,
  buildMemberAccountLinkedEmailText,
  type MemberAccountLinkedEmailContent,
} from '../templates/member-account-linked-email.template';
import {
  buildCareRequestEmailHtml,
  buildCareRequestEmailText,
  type CareRequestEmailContent,
} from '../templates/care-request-email.template';

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
  }

  async sendEmailVerificationEmail(
    to: string,
    verifyUrl: string,
    userName: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY não configurada — e-mail de verificação não enviado para ${to}.`,
      );
      return;
    }

    const fromEmail = this.config.getOrThrow<string>('resend.fromEmail');
    const appUrl = this.config.getOrThrow<string>('appUrl');
    const emailContent = { userName, verifyUrl, appUrl };

    await this.resend.emails.send({
      from: fromEmail,
      to,
      subject: 'Confirme seu e-mail — MinhaChurch',
      html: buildEmailVerificationEmailHtml(emailContent),
      text: buildEmailVerificationEmailText(emailContent),
    });
  }

  async sendSubscriptionConfirmedEmail(
    to: string,
    content: BillingEmailContent,
  ): Promise<void> {
    await this.sendBillingEmail(
      to,
      'Assinatura confirmada — MinhaChurch',
      buildSubscriptionConfirmedEmailHtml(content),
      buildSubscriptionConfirmedEmailText(content),
    );
  }

  async sendPaymentFailedEmail(
    to: string,
    content: BillingEmailContent,
  ): Promise<void> {
    await this.sendBillingEmail(
      to,
      'Falha no pagamento — MinhaChurch',
      buildPaymentFailedEmailHtml(content),
      buildPaymentFailedEmailText(content),
    );
  }

  async sendSubscriptionCanceledEmail(
    to: string,
    content: BillingEmailContent,
  ): Promise<void> {
    await this.sendBillingEmail(
      to,
      'Assinatura encerrada — MinhaChurch',
      buildSubscriptionCanceledEmailHtml(content),
      buildSubscriptionCanceledEmailText(content),
    );
  }

  async sendSubscriptionCancelScheduledEmail(
    to: string,
    content: BillingEmailContent,
  ): Promise<void> {
    await this.sendBillingEmail(
      to,
      'Cancelamento agendado — MinhaChurch',
      buildSubscriptionCancelScheduledEmailHtml(content),
      buildSubscriptionCancelScheduledEmailText(content),
    );
  }

  async sendTierUpgradeRequestEmail(
    to: string,
    content: BillingEmailContent,
  ): Promise<void> {
    await this.sendBillingEmail(
      to,
      'Pedido de mudança de faixa — MinhaChurch',
      buildTierUpgradeRequestEmailHtml(content),
      buildTierUpgradeRequestEmailText(content),
    );
  }

  async sendMemberAccountLinkedEmail(
    to: string,
    content: MemberAccountLinkedEmailContent,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY não configurada — e-mail de vínculo de conta não enviado para ${to}.`,
      );
      return;
    }

    const fromEmail = this.config.getOrThrow<string>('resend.fromEmail');

    await this.resend.emails.send({
      from: fromEmail,
      to,
      subject: 'Você foi adicionado a uma igreja — MinhaChurch',
      html: buildMemberAccountLinkedEmailHtml(content),
      text: buildMemberAccountLinkedEmailText(content),
    });
  }

  async sendCareRequestEmail(
    to: string,
    content: CareRequestEmailContent,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY não configurada — e-mail de aconselhamento/visita não enviado para ${to}.`,
      );
      return;
    }

    const fromEmail = this.config.getOrThrow<string>('resend.fromEmail');

    await this.resend.emails.send({
      from: fromEmail,
      to,
      subject: `Nova solicitação de ${content.requestTypeLabel.toLowerCase()} — MinhaChurch`,
      html: buildCareRequestEmailHtml(content),
      text: buildCareRequestEmailText(content),
    });
  }

  private async sendBillingEmail(
    to: string,
    subject: string,
    html: string,
    text: string,
  ): Promise<void> {
    if (!this.resend) {
      this.logger.warn(
        `RESEND_API_KEY não configurada — e-mail de billing não enviado para ${to}. Assunto: ${subject}`,
      );
      return;
    }

    const fromEmail = this.config.getOrThrow<string>('resend.fromEmail');

    await this.resend.emails.send({
      from: fromEmail,
      to,
      subject,
      html,
      text,
    });
  }
}
