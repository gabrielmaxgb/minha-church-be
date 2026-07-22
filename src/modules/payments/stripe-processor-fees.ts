import type Stripe from 'stripe';

/**
 * Estima tarifa Stripe Brasil (tabela pública) quando ainda não há
 * `processorFeeCents` gravado. Fonte: https://stripe.com/br/pricing
 */
export function estimateStripeBrFeeCents(
  amountCents: number,
  paymentMethodType: string | null | undefined,
): number {
  const amount = Math.max(0, amountCents);
  const method = (paymentMethodType ?? '').toLowerCase();

  if (method === 'pix') {
    return Math.round(amount * 0.0119);
  }

  if (method === 'boleto') {
    return 345;
  }

  // cartão (default) e meios desconhecidos — taxa de cartão nacional
  return Math.round(amount * 0.0399) + 39;
}

export function resolvePaymentFeeCents(params: {
  amountCents: number;
  processorFeeCents: number | null | undefined;
  paymentMethodType: string | null | undefined;
}): { feeCents: number; estimated: boolean } {
  if (
    typeof params.processorFeeCents === 'number' &&
    Number.isFinite(params.processorFeeCents) &&
    params.processorFeeCents >= 0
  ) {
    return { feeCents: params.processorFeeCents, estimated: false };
  }

  return {
    feeCents: estimateStripeBrFeeCents(
      params.amountCents,
      params.paymentMethodType,
    ),
    estimated: true,
  };
}

export function extractFeeFromPaymentIntent(paymentIntent: Stripe.PaymentIntent): {
  feeCents: number | null;
  paymentMethodType: string | null;
} {
  const charge =
    paymentIntent.latest_charge &&
    typeof paymentIntent.latest_charge === 'object'
      ? paymentIntent.latest_charge
      : null;

  const balanceTransaction =
    charge?.balance_transaction &&
    typeof charge.balance_transaction === 'object'
      ? charge.balance_transaction
      : null;

  const feeCents =
    balanceTransaction && typeof balanceTransaction.fee === 'number'
      ? balanceTransaction.fee
      : null;

  const paymentMethodType =
    charge?.payment_method_details?.type ??
    paymentIntent.payment_method_types?.[0] ??
    null;

  return { feeCents, paymentMethodType };
}

export function sumProcessorFees(
  rows: Array<{
    amountCents: number;
    processorFeeCents: number | null;
    paymentMethodType: string | null;
  }>,
): { feeCents: number; estimated: boolean } {
  let feeCents = 0;
  let estimated = false;

  for (const row of rows) {
    const resolved = resolvePaymentFeeCents(row);
    feeCents += resolved.feeCents;
    if (resolved.estimated) {
      estimated = true;
    }
  }

  return { feeCents, estimated };
}
