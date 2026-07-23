import {
  buildEmailCtaButton,
  buildEmailHeading,
  buildEmailParagraph,
  buildEmailShell,
  buildEmailTextFooter,
  escapeHtml,
} from './email-shell';

export interface CareRequestEmailContent {
  recipientName: string;
  requesterName: string;
  churchName: string;
  requestTypeLabel: string;
  inboxUrl: string;
  appUrl: string;
}

/**
 * Aviso genérico — sem corpo da mensagem pastoral.
 * O conteúdo sensível fica só no app (menor perímetro de vazamento).
 */
export function buildCareRequestEmailHtml(
  input: CareRequestEmailContent,
): string {
  const recipientName = escapeHtml(input.recipientName);
  const requesterName = escapeHtml(input.requesterName);
  const churchName = escapeHtml(input.churchName);
  const requestTypeLabel = escapeHtml(input.requestTypeLabel);

  return buildEmailShell({
    title: 'Nova solicitação — MinhaChurch',
    eyebrow: 'Cuidado pastoral',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading(`Nova solicitação de ${input.requestTypeLabel.toLowerCase()}`)}
              ${buildEmailParagraph(
                `Olá, ${recipientName}. <strong>${requesterName}</strong> pediu ${requestTypeLabel.toLowerCase()} em <strong>${churchName}</strong>.`,
              )}
              ${buildEmailParagraph(
                'Por privacidade, a mensagem (se houver) aparece somente no app — este e-mail não inclui o conteúdo do pedido.',
                24,
              )}
              ${buildEmailCtaButton(input.inboxUrl, 'Abrir no app')}`,
    cardFooterHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:#6f6f6a;">
                      Marque a solicitação como visualizada no app para o solicitante saber que você viu o pedido. O contato pode ser feito fora do MinhaChurch.
                    </p>`,
  });
}

export function buildCareRequestEmailText(
  input: CareRequestEmailContent,
): string {
  return [
    `Olá, ${input.recipientName}.`,
    '',
    `${input.requesterName} pediu ${input.requestTypeLabel.toLowerCase()} em ${input.churchName}.`,
    '',
    'Por privacidade, a mensagem (se houver) aparece somente no app — este e-mail não inclui o conteúdo do pedido.',
    '',
    `Abrir no app: ${input.inboxUrl}`,
    '',
    'Marque a solicitação como visualizada no app para o solicitante saber que você viu o pedido.',
    '',
    buildEmailTextFooter(input.appUrl),
  ].join('\n');
}
