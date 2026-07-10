function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface BillingEmailContent {
  ownerName: string;
  churchName: string;
  appUrl: string;
  settingsUrl: string;
  tierName?: string;
  intervalLabel?: string;
  amountLabel?: string;
}

function buildBillingEmailShell(
  title: string,
  bodyHtml: string,
  appUrl: string,
): string {
  const safeAppUrl = escapeHtml(appUrl.replace(/\/$/, ''));

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f5f5f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#141413;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#f5f5f2;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid #e8e8e3;">
          <tr>
            <td style="padding:32px 28px;">
              <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#6f6f6a;text-transform:uppercase;letter-spacing:0.04em;">MinhaChurch</p>
              ${bodyHtml}
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-size:12px;color:#6f6f6a;">${safeAppUrl}</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildSubscriptionConfirmedEmailHtml(
  input: BillingEmailContent,
): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);
  const settingsUrl = escapeHtml(input.settingsUrl);
  const tierName = input.tierName ? escapeHtml(input.tierName) : null;
  const intervalLabel = input.intervalLabel
    ? escapeHtml(input.intervalLabel)
    : null;
  const amountLabel = input.amountLabel ? escapeHtml(input.amountLabel) : null;

  const details =
    tierName && intervalLabel && amountLabel
      ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">Faixa <strong>${tierName}</strong> · ${intervalLabel} · ${amountLabel}</p>`
      : '';

  return buildBillingEmailShell(
    'Assinatura confirmada — MinhaChurch',
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:#141413;">Assinatura confirmada</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">Olá, ${ownerName}! A assinatura da <strong>${churchName}</strong> está ativa. Obrigado por confiar no MinhaChurch.</p>
              ${details}
              <p style="margin:0 0 24px;">
                <a href="${settingsUrl}" style="display:inline-block;background:#141413;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px;">Ver assinatura</a>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#6f6f6a;">Você pode gerenciar cartão, faturas e cancelamento a qualquer momento nas configurações.</p>`,
    input.appUrl,
  );
}

export function buildSubscriptionConfirmedEmailText(
  input: BillingEmailContent,
): string {
  const lines = [
    `Olá, ${input.ownerName}!`,
    '',
    `A assinatura da ${input.churchName} está ativa.`,
  ];

  if (input.tierName && input.intervalLabel && input.amountLabel) {
    lines.push(
      '',
      `Faixa: ${input.tierName} · ${input.intervalLabel} · ${input.amountLabel}`,
    );
  }

  lines.push('', 'Ver assinatura:', input.settingsUrl, '', '— MinhaChurch');

  return lines.join('\n');
}

export function buildPaymentFailedEmailHtml(input: BillingEmailContent): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);
  const settingsUrl = escapeHtml(input.settingsUrl);

  return buildBillingEmailShell(
    'Falha no pagamento — MinhaChurch',
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:#141413;">Não conseguimos processar o pagamento</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">Olá, ${ownerName}. O último pagamento da assinatura da <strong>${churchName}</strong> não foi aprovado.</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3d3d38;">Atualize o cartão ou regularize a fatura para manter o acesso completo ao painel.</p>
              <p style="margin:0 0 24px;">
                <a href="${settingsUrl}" style="display:inline-block;background:#141413;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px;">Atualizar pagamento</a>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.5;color:#6f6f6a;">Se você já regularizou o pagamento, pode ignorar este e-mail.</p>`,
    input.appUrl,
  );
}

export function buildPaymentFailedEmailText(input: BillingEmailContent): string {
  return [
    `Olá, ${input.ownerName}.`,
    '',
    `O último pagamento da assinatura da ${input.churchName} não foi aprovado.`,
    'Atualize o cartão ou regularize a fatura para manter o acesso completo ao painel.',
    '',
    'Atualizar pagamento:',
    input.settingsUrl,
    '',
    '— MinhaChurch',
  ].join('\n');
}

export function buildSubscriptionCanceledEmailHtml(
  input: BillingEmailContent,
): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);
  const settingsUrl = escapeHtml(input.settingsUrl);

  return buildBillingEmailShell(
    'Assinatura encerrada — MinhaChurch',
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:#141413;">Assinatura encerrada</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">Olá, ${ownerName}. A assinatura da <strong>${churchName}</strong> foi cancelada e não haverá novas cobranças.</p>
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3d3d38;">Você ainda pode consultar o painel e cadastrar membros. Para voltar a editar ministérios, atividades e comunicados, assine novamente quando quiser.</p>
              <p style="margin:0 0 24px;">
                <a href="${settingsUrl}" style="display:inline-block;background:#141413;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px;">Ver assinatura</a>
              </p>`,
    input.appUrl,
  );
}

export function buildSubscriptionCanceledEmailText(
  input: BillingEmailContent,
): string {
  return [
    `Olá, ${input.ownerName}.`,
    '',
    `A assinatura da ${input.churchName} foi cancelada e não haverá novas cobranças.`,
    'Para reativar os recursos de gestão, assine novamente em Configurações → Assinatura.',
    '',
    input.settingsUrl,
    '',
    '— MinhaChurch',
  ].join('\n');
}
