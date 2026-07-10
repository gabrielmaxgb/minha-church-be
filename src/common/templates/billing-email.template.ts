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
  /** Data formatada de fim de acesso (cancelamento agendado). */
  accessEndsAtLabel?: string;
  requesterName?: string;
  currentTierName?: string;
  projectedTierName?: string;
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

export function buildSubscriptionCancelScheduledEmailHtml(
  input: BillingEmailContent,
): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);
  const settingsUrl = escapeHtml(input.settingsUrl);
  const accessEndsAtLabel = input.accessEndsAtLabel
    ? escapeHtml(input.accessEndsAtLabel)
    : null;

  const accessLine = accessEndsAtLabel
    ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">O acesso completo permanece até <strong>${accessEndsAtLabel}</strong>. Depois disso, não haverá novas cobranças.</p>`
    : `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">O acesso completo permanece até o fim do período já pago. Depois disso, não haverá novas cobranças.</p>`;

  return buildBillingEmailShell(
    'Cancelamento agendado — MinhaChurch',
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:#141413;">Cancelamento agendado</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">Olá, ${ownerName}. O cancelamento da assinatura da <strong>${churchName}</strong> foi agendado.</p>
              ${accessLine}
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3d3d38;">Se mudou de ideia, você pode reativar a renovação a qualquer momento nas configurações ou no portal de pagamento.</p>
              <p style="margin:0 0 24px;">
                <a href="${settingsUrl}" style="display:inline-block;background:#141413;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px;">Ver assinatura</a>
              </p>`,
    input.appUrl,
  );
}

export function buildSubscriptionCancelScheduledEmailText(
  input: BillingEmailContent,
): string {
  const lines = [
    `Olá, ${input.ownerName}.`,
    '',
    `O cancelamento da assinatura da ${input.churchName} foi agendado.`,
  ];

  if (input.accessEndsAtLabel) {
    lines.push(
      '',
      `O acesso completo permanece até ${input.accessEndsAtLabel}. Depois disso, não haverá novas cobranças.`,
    );
  } else {
    lines.push(
      '',
      'O acesso completo permanece até o fim do período já pago. Depois disso, não haverá novas cobranças.',
    );
  }

  lines.push(
    '',
    'Se mudou de ideia, reative a renovação em Configurações → Assinatura.',
    '',
    input.settingsUrl,
    '',
    '— MinhaChurch',
  );

  return lines.join('\n');
}

export function buildTierUpgradeRequestEmailHtml(
  input: BillingEmailContent,
): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);
  const settingsUrl = escapeHtml(input.settingsUrl);
  const requesterName = input.requesterName
    ? escapeHtml(input.requesterName)
    : 'Um administrador';
  const currentTierName = input.currentTierName
    ? escapeHtml(input.currentTierName)
    : null;
  const projectedTierName = input.projectedTierName
    ? escapeHtml(input.projectedTierName)
    : null;

  const tierLine =
    currentTierName && projectedTierName
      ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">Faixa <strong>${currentTierName}</strong> → <strong>${projectedTierName}</strong></p>`
      : '';

  return buildBillingEmailShell(
    'Pedido de mudança de faixa — MinhaChurch',
    `<h1 style="margin:0 0 16px;font-size:24px;line-height:1.25;font-weight:700;color:#141413;">Pedido de mudança de faixa</h1>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#3d3d38;">Olá, ${ownerName}. <strong>${requesterName}</strong> tentou adicionar ou ativar um membro na <strong>${churchName}</strong>, o que mudaria a faixa de cobrança.</p>
              ${tierLine}
              <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#3d3d38;">Somente você pode autorizar essa mudança. Depois da autorização, a equipe poderá tentar de novo o cadastro.</p>
              <p style="margin:0 0 24px;">
                <a href="${settingsUrl}" style="display:inline-block;background:#141413;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 20px;border-radius:10px;">Revisar pedido</a>
              </p>`,
    input.appUrl,
  );
}

export function buildTierUpgradeRequestEmailText(
  input: BillingEmailContent,
): string {
  const lines = [
    `Olá, ${input.ownerName}.`,
    '',
    `${input.requesterName ?? 'Um administrador'} tentou adicionar ou ativar um membro na ${input.churchName}, o que mudaria a faixa de cobrança.`,
  ];

  if (input.currentTierName && input.projectedTierName) {
    lines.push(
      '',
      `Faixa: ${input.currentTierName} → ${input.projectedTierName}`,
    );
  }

  lines.push(
    '',
    'Somente você pode autorizar. Depois, a equipe poderá tentar o cadastro novamente.',
    '',
    input.settingsUrl,
    '',
    '— MinhaChurch',
  );

  return lines.join('\n');
}
