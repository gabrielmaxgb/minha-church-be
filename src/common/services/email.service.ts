import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

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

    await this.resend.emails.send({
      from: fromEmail,
      to,
      subject: 'Redefinir sua senha — MinhaChurch',
      html: `
        <p>Olá, ${this.escapeHtml(userName)}!</p>
        <p>Recebemos uma solicitação para redefinir a senha da sua conta no MinhaChurch.</p>
        <p><a href="${resetUrl}">Clique aqui para criar uma nova senha</a></p>
        <p>O link expira em 1 hora. Se você não solicitou isso, ignore este e-mail.</p>
      `,
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
}
