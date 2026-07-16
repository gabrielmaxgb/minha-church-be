function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

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
  const inboxUrl = escapeHtml(input.inboxUrl);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Nova solicitação — MinhaChurch</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141413;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f5f2;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e8e8e3;">
          <tr>
            <td style="padding:32px 28px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#6f6f6a;text-transform:uppercase;letter-spacing:0.04em;">MinhaChurch</p>
              <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;font-weight:650;color:#141413;">Nova solicitação de ${requestTypeLabel.toLowerCase()}</h1>
              <p style="margin:0;font-size:15px;line-height:1.55;color:#3a3a36;">
                Olá, ${recipientName}. <strong>${requesterName}</strong> pediu ${requestTypeLabel.toLowerCase()} em <strong>${churchName}</strong>.
              </p>
              <p style="margin:16px 0 0;font-size:14px;line-height:1.5;color:#6f6f6a;">
                Por privacidade, a mensagem (se houver) aparece somente no app — este e-mail não inclui o conteúdo do pedido.
              </p>
              <p style="margin:24px 0 0;">
                <a href="${inboxUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#141413;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;">Abrir no app</a>
              </p>
              <p style="margin:20px 0 0;font-size:13px;line-height:1.5;color:#6f6f6a;">
                Marque a solicitação como visualizada no app para o solicitante saber que você viu o pedido. O contato pode ser feito fora do MinhaChurch.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
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
    'MinhaChurch',
  ].join('\n');
}
