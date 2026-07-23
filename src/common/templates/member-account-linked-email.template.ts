import {
  buildEmailCtaButton,
  buildEmailHeading,
  buildEmailParagraph,
  buildEmailShell,
  buildEmailTextFooter,
  escapeHtml,
  normalizeAppUrl,
} from './email-shell';

export interface MemberAccountLinkedEmailContent {
  userName: string;
  churchName: string;
  login: string;
  appUrl: string;
}

export function buildMemberAccountLinkedEmailHtml(
  input: MemberAccountLinkedEmailContent,
): string {
  const userName = escapeHtml(input.userName);
  const churchName = escapeHtml(input.churchName);
  const login = escapeHtml(input.login);
  const loginUrl = `${normalizeAppUrl(input.appUrl)}/entrar`;

  return buildEmailShell({
    title: 'Acesso a uma nova igreja — MinhaChurch',
    eyebrow: 'Nova igreja',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading('Você foi adicionado a uma igreja')}
              ${buildEmailParagraph(
                `Olá, ${userName}. Sua conta MinhaChurch foi vinculada à <strong>${churchName}</strong>.`,
              )}
              ${buildEmailParagraph(
                `Use o login <strong>${login}</strong> e a senha que você já utiliza. No painel, você pode alternar entre as igrejas às quais tem acesso.`,
              )}
              ${buildEmailCtaButton(loginUrl, 'Entrar no painel')}`,
    cardFooterHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:#6f6f6a;">
                      Se você não reconhece este vínculo, entre em contato com a liderança da igreja ou ignore este e-mail.
                    </p>`,
  });
}

export function buildMemberAccountLinkedEmailText(
  input: MemberAccountLinkedEmailContent,
): string {
  return [
    `Olá, ${input.userName}.`,
    '',
    `Sua conta MinhaChurch foi vinculada à ${input.churchName}.`,
    `Use o login ${input.login} e a senha que você já utiliza.`,
    '',
    `Entrar: ${normalizeAppUrl(input.appUrl)}/entrar`,
    '',
    'Se você não reconhece este vínculo, fale com a liderança da igreja.',
    '',
    buildEmailTextFooter(input.appUrl),
  ].join('\n');
}
