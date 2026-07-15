import { GIVING_MIN_AMOUNT_CENTS } from '../payments/dto/create-giving-checkout.dto';

/**
 * Normaliza inscrição + preço:
 * - fechar inscrição explicitamente ⇒ priceCents sempre null
 * - preço pago (≥ mínimo Stripe) ⇒ inscrição aberta
 * - inscrição aberta sem preço ⇒ gratuita
 */
export function resolveEventRegistrationFields(input: {
  registrationOpen?: boolean;
  priceCents?: number | null;
  existingRegistrationOpen?: boolean;
  existingPriceCents?: number | null;
}): { registrationOpen: boolean; priceCents: number | null } {
  // Fechar inscrição vence qualquer preço no mesmo payload.
  if (input.registrationOpen === false) {
    return { registrationOpen: false, priceCents: null };
  }

  let registrationOpen =
    input.registrationOpen !== undefined
      ? input.registrationOpen
      : (input.existingRegistrationOpen ?? false);

  let priceCents =
    input.priceCents !== undefined
      ? input.priceCents
      : (input.existingPriceCents ?? null);

  if (priceCents != null && priceCents >= GIVING_MIN_AMOUNT_CENTS) {
    registrationOpen = true;
  } else if (priceCents != null && priceCents > 0) {
    // Valores abaixo do mínimo não são válidos; tratar como gratuita.
    priceCents = null;
  }

  if (!registrationOpen) {
    priceCents = null;
  }

  return { registrationOpen, priceCents };
}
