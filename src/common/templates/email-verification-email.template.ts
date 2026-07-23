import {
  buildEmailCtaButton,
  buildEmailFallbackLink,
  buildEmailHeading,
  buildEmailParagraph,
  buildEmailShell,
  buildEmailTextFooter,
  escapeHtml,
} from './email-shell';

export interface EmailVerificationEmailContent {
  userName: string;
  verifyUrl: string;
  appUrl: string;
}

export function buildEmailVerificationEmailHtml(
  input: EmailVerificationEmailContent,
): string {
  const userName = escapeHtml(input.userName);

  return buildEmailShell({
    title: 'Confirme seu e-mail — MinhaChurch',
    eyebrow: 'Confirmação de e-mail',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading('Confirme seu e-mail')}
              ${buildEmailParagraph(
                `Olá, ${userName}! Falta só este passo para ativar sua conta e entrar no painel.`,
              )}
              ${buildEmailCtaButton(input.verifyUrl, 'Confirmar e-mail')}
              ${buildEmailFallbackLink(input.verifyUrl)}`,
    cardFooterHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:#6f6f6a;">
                      O link expira em 24 horas. Se você não criou esta conta, ignore este e-mail.
                    </p>`,
  });
}

export function buildEmailVerificationEmailText(
  input: EmailVerificationEmailContent,
): string {
  return [
    `Olá, ${input.userName}!`,
    '',
    'Confirme seu e-mail para ativar sua conta no MinhaChurch:',
    input.verifyUrl,
    '',
    'O link expira em 24 horas.',
    '',
    buildEmailTextFooter(input.appUrl),
  ].join('\n');
}
