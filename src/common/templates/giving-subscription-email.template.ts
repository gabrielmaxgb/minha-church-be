import {
  buildEmailCtaButton,
  buildEmailFallbackLink,
  buildEmailHeading,
  buildEmailParagraph,
  buildEmailShell,
  buildEmailTextFooter,
  escapeHtml,
} from './email-shell';

export interface GivingSubscriptionManageEmailContent {
  donorName: string;
  churchName: string;
  fundName: string;
  amountLabel: string;
  manageUrl: string;
  appUrl: string;
}

export function buildGivingSubscriptionManageEmailHtml(
  input: GivingSubscriptionManageEmailContent,
): string {
  const donorName = escapeHtml(input.donorName);
  const churchName = escapeHtml(input.churchName);
  const fundName = escapeHtml(input.fundName);
  const amountLabel = escapeHtml(input.amountLabel);
  const greeting = donorName ? `Olá, ${donorName}!` : 'Olá!';

  return buildEmailShell({
    title: 'Sua contribuição mensal — MinhaChurch',
    eyebrow: 'Contribuição mensal',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading('Contribuição mensal confirmada')}
              ${buildEmailParagraph(
                `${greeting} Sua contribuição de <strong>${amountLabel}/mês</strong> para <strong>${fundName}</strong> (${churchName}) está ativa.`,
              )}
              ${buildEmailParagraph(
                'Guarde este e-mail. Por aqui você cancela ou fala com a igreja quando quiser.',
              )}
              ${buildEmailCtaButton(input.manageUrl, 'Gerenciar ou cancelar')}
              ${buildEmailFallbackLink(input.manageUrl)}`,
    cardFooterHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:#6f6f6a;">
                      Este link é pessoal. Não compartilhe com outras pessoas.
                    </p>`,
  });
}

export function buildGivingSubscriptionManageEmailText(
  input: GivingSubscriptionManageEmailContent,
): string {
  const greeting = input.donorName ? `Olá, ${input.donorName}!` : 'Olá!';
  return `${greeting}

Sua contribuição de ${input.amountLabel}/mês para ${input.fundName} (${input.churchName}) está ativa.

Guarde este e-mail. Para cancelar ou falar com a igreja:
${input.manageUrl}

${buildEmailTextFooter(input.appUrl)}
`;
}

export interface GivingSubscriptionContactEmailContent {
  ownerName: string;
  churchName: string;
  fundName: string;
  amountLabel: string;
  subscriptionStatusLabel: string;
  donorName: string;
  donorEmail: string;
  reasonLabel: string;
  message: string;
  manageUrl: string;
  financesUrl: string;
  appUrl: string;
}

export function buildGivingSubscriptionContactEmailHtml(
  input: GivingSubscriptionContactEmailContent,
): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);
  const fundName = escapeHtml(input.fundName);
  const amountLabel = escapeHtml(input.amountLabel);
  const statusLabel = escapeHtml(input.subscriptionStatusLabel);
  const donorName = escapeHtml(input.donorName);
  const donorEmail = escapeHtml(input.donorEmail);
  const reasonLabel = escapeHtml(input.reasonLabel);
  const message = escapeHtml(input.message).replaceAll('\n', '<br />');

  return buildEmailShell({
    title: 'Mensagem de doador — contribuição mensal',
    eyebrow: 'Contribuições',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading('Mensagem sobre contribuição mensal')}
              ${buildEmailParagraph(
                `Olá, ${ownerName}. Um doador escreveu sobre a contribuição mensal da <strong>${churchName}</strong>.`,
              )}
              ${buildEmailParagraph(
                `<strong>Fundo:</strong> ${fundName}<br /><strong>Valor:</strong> ${amountLabel}/mês<br /><strong>Status:</strong> ${statusLabel}<br /><strong>Motivo:</strong> ${reasonLabel}`,
                12,
              )}
              ${buildEmailParagraph(
                `<strong>De:</strong> ${donorName} &lt;${donorEmail}&gt;`,
                12,
              )}
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#2c2c2a;padding:14px 16px;background:#f5f5f2;border-radius:12px;border:1px solid #e8e8e4;">${message}</p>
              ${buildEmailCtaButton(input.financesUrl, 'Abrir contribuições mensais')}
              ${buildEmailFallbackLink(input.financesUrl)}`,
    cardFooterHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:#6f6f6a;">
                      Link do doador: <a href="${escapeHtml(input.manageUrl)}" style="color:#1a1a18;word-break:break-all;">${escapeHtml(input.manageUrl)}</a>
                    </p>`,
  });
}

export function buildGivingSubscriptionContactEmailText(
  input: GivingSubscriptionContactEmailContent,
): string {
  return `Olá, ${input.ownerName}.

Um doador escreveu sobre a contribuição mensal da ${input.churchName}.

Fundo: ${input.fundName}
Valor: ${input.amountLabel}/mês
Status: ${input.subscriptionStatusLabel}
Motivo: ${input.reasonLabel}
De: ${input.donorName} <${input.donorEmail}>

Mensagem:
${input.message}

Painel: ${input.financesUrl}
Link do doador: ${input.manageUrl}

${buildEmailTextFooter(input.appUrl)}
`;
}
