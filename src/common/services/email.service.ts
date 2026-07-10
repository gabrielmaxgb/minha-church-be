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
  buildSubscriptionCanceledEmailHtml,
  buildSubscriptionCanceledEmailText,
  buildSubscriptionConfirmedEmailHtml,
  buildSubscriptionConfirmedEmailText,
  type BillingEmailContent,
} from '../templates/billing-email.template';

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
        `RESEND_API_KEY não configurada — e-mail de reset não enviado para ${to}. URL: ${resetUrl}`,
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
        `RESEND_API_KEY não configurada — e-mail de verificação não enviado para ${to}. URL: ${verifyUrl}`,
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
