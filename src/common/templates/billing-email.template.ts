import {
  buildEmailCtaButton,
  buildEmailHeading,
  buildEmailParagraph,
  buildEmailShell,
  buildEmailTextFooter,
  escapeHtml,
} from './email-shell';

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

export function buildSubscriptionConfirmedEmailHtml(
  input: BillingEmailContent,
): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);
  const tierName = input.tierName ? escapeHtml(input.tierName) : null;
  const intervalLabel = input.intervalLabel
    ? escapeHtml(input.intervalLabel)
    : null;
  const amountLabel = input.amountLabel ? escapeHtml(input.amountLabel) : null;

  const details =
    tierName && intervalLabel && amountLabel
      ? buildEmailParagraph(
          `Faixa <strong>${tierName}</strong> · ${intervalLabel} · ${amountLabel}`,
        )
      : '';

  return buildEmailShell({
    title: 'Assinatura confirmada — MinhaChurch',
    eyebrow: 'Assinatura',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading('Assinatura confirmada')}
              ${buildEmailParagraph(
                `Olá, ${ownerName}! A assinatura da <strong>${churchName}</strong> está ativa. Obrigado por confiar no MinhaChurch.`,
              )}
              ${details}
              ${buildEmailCtaButton(input.settingsUrl, 'Ver assinatura')}`,
    cardFooterHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:#6f6f6a;">
                      Você pode gerenciar cartão, faturas e cancelamento a qualquer momento nas configurações.
                    </p>`,
  });
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

  lines.push(
    '',
    'Ver assinatura:',
    input.settingsUrl,
    '',
    buildEmailTextFooter(input.appUrl),
  );

  return lines.join('\n');
}

export function buildPaymentFailedEmailHtml(input: BillingEmailContent): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);

  return buildEmailShell({
    title: 'Falha no pagamento — MinhaChurch',
    eyebrow: 'Assinatura',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading('Não conseguimos processar o pagamento')}
              ${buildEmailParagraph(
                `Olá, ${ownerName}. O último pagamento da assinatura da <strong>${churchName}</strong> não foi aprovado.`,
              )}
              ${buildEmailParagraph(
                'Atualize o cartão ou regularize a fatura para manter o acesso completo ao painel.',
              )}
              ${buildEmailCtaButton(input.settingsUrl, 'Atualizar pagamento')}`,
    cardFooterHtml: `<p style="margin:0;font-size:13px;line-height:1.6;color:#6f6f6a;">
                      Se você já regularizou o pagamento, pode ignorar este e-mail.
                    </p>`,
  });
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
    buildEmailTextFooter(input.appUrl),
  ].join('\n');
}

export function buildSubscriptionCanceledEmailHtml(
  input: BillingEmailContent,
): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);

  return buildEmailShell({
    title: 'Assinatura encerrada — MinhaChurch',
    eyebrow: 'Assinatura',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading('Assinatura encerrada')}
              ${buildEmailParagraph(
                `Olá, ${ownerName}. A assinatura da <strong>${churchName}</strong> foi cancelada e não haverá novas cobranças.`,
              )}
              ${buildEmailParagraph(
                'Você ainda pode consultar o painel e cadastrar membros. Para voltar a editar ministérios, atividades e comunicados, assine novamente quando quiser.',
              )}
              ${buildEmailCtaButton(input.settingsUrl, 'Ver assinatura')}`,
  });
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
    buildEmailTextFooter(input.appUrl),
  ].join('\n');
}

export function buildSubscriptionCancelScheduledEmailHtml(
  input: BillingEmailContent,
): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);
  const accessEndsAtLabel = input.accessEndsAtLabel
    ? escapeHtml(input.accessEndsAtLabel)
    : null;

  const accessLine = accessEndsAtLabel
    ? buildEmailParagraph(
        `O acesso completo permanece até <strong>${accessEndsAtLabel}</strong>. Depois disso, não haverá novas cobranças.`,
      )
    : buildEmailParagraph(
        'O acesso completo permanece até o fim do período já pago. Depois disso, não haverá novas cobranças.',
      );

  return buildEmailShell({
    title: 'Cancelamento agendado — MinhaChurch',
    eyebrow: 'Assinatura',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading('Cancelamento agendado')}
              ${buildEmailParagraph(
                `Olá, ${ownerName}. O cancelamento da assinatura da <strong>${churchName}</strong> foi agendado.`,
              )}
              ${accessLine}
              ${buildEmailParagraph(
                'Se mudou de ideia, você pode reativar a renovação a qualquer momento nas configurações ou no portal de pagamento.',
              )}
              ${buildEmailCtaButton(input.settingsUrl, 'Ver assinatura')}`,
  });
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
    buildEmailTextFooter(input.appUrl),
  );

  return lines.join('\n');
}

export function buildTierUpgradeRequestEmailHtml(
  input: BillingEmailContent,
): string {
  const ownerName = escapeHtml(input.ownerName);
  const churchName = escapeHtml(input.churchName);
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
      ? buildEmailParagraph(
          `Faixa <strong>${currentTierName}</strong> → <strong>${projectedTierName}</strong>`,
        )
      : '';

  return buildEmailShell({
    title: 'Pedido de mudança de faixa — MinhaChurch',
    eyebrow: 'Assinatura',
    appUrl: input.appUrl,
    bodyHtml: `${buildEmailHeading('Pedido de mudança de faixa')}
              ${buildEmailParagraph(
                `Olá, ${ownerName}. <strong>${requesterName}</strong> tentou adicionar ou ativar um membro na <strong>${churchName}</strong>, o que mudaria a faixa de cobrança.`,
              )}
              ${tierLine}
              ${buildEmailParagraph(
                'Somente você pode autorizar essa mudança. Depois da autorização, a equipe poderá tentar de novo o cadastro.',
              )}
              ${buildEmailCtaButton(input.settingsUrl, 'Revisar pedido')}`,
  });
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
    buildEmailTextFooter(input.appUrl),
  );

  return lines.join('\n');
}
