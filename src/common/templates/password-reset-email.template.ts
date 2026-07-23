import {
  buildEmailCtaButton,
  buildEmailFallbackLink,
  buildEmailHeading,
  buildEmailParagraph,
  buildEmailShell,
  buildEmailTextFooter,
} from './email-shell';

export interface PasswordResetEmailContent {
  userName: string;
  resetUrl: string;
  appUrl: string;
}

export function buildPasswordResetEmailHtml(
  input: PasswordResetEmailContent,
): string {
  return buildEmailShell({
    title: 'Redefinir senha — MinhaChurch',
    eyebrow: 'Recuperação de senha',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading(`Olá, ${input.userName}!`)}
              ${buildEmailParagraph(
                'Recebemos uma solicitação para redefinir a senha da sua conta no MinhaChurch.',
                12,
              )}
              ${buildEmailParagraph(
                'Clique no botão abaixo para criar uma nova senha. O link é válido por <strong>1 hora</strong>.',
                28,
              )}
              ${buildEmailCtaButton(input.resetUrl, 'Redefinir minha senha')}
              ${buildEmailFallbackLink(input.resetUrl)}`,
    cardFooterHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:#6f6f6a;">
                      Se você não solicitou a redefinição, ignore este e-mail. Sua senha atual continuará a mesma.
                    </p>`,
  });
}

export function buildPasswordResetEmailText(
  input: PasswordResetEmailContent,
): string {
  return [
    `Olá, ${input.userName}!`,
    '',
    'Recebemos uma solicitação para redefinir a senha da sua conta no MinhaChurch.',
    '',
    'Acesse o link abaixo para criar uma nova senha (válido por 1 hora):',
    input.resetUrl,
    '',
    'Se você não solicitou isso, ignore este e-mail.',
    '',
    buildEmailTextFooter(input.appUrl),
  ].join('\n');
}
