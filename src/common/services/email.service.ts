import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

import {
  buildPasswordResetEmailHtml,
  buildPasswordResetEmailText,
} from '../templates/password-reset-email.template';

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
}
