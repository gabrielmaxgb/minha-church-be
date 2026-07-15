import { GIVING_MIN_AMOUNT_CENTS } from '../payments/dto/create-giving-checkout.dto';
import { resolveEventRegistrationFields } from './event-registration-fields';

describe('resolveEventRegistrationFields', () => {
  it('abre inscrição gratuita sem preço', () => {
    expect(
      resolveEventRegistrationFields({ registrationOpen: true }),
    ).toEqual({ registrationOpen: true, priceCents: null });
  });

  it('fecha inscrição e limpa preço', () => {
    expect(
      resolveEventRegistrationFields({
        registrationOpen: false,
        priceCents: 2500,
        existingRegistrationOpen: true,
        existingPriceCents: 2500,
      }),
    ).toEqual({ registrationOpen: false, priceCents: null });
  });

  it('preço pago força inscrição aberta', () => {
    expect(
      resolveEventRegistrationFields({
        priceCents: GIVING_MIN_AMOUNT_CENTS,
      }),
    ).toEqual({
      registrationOpen: true,
      priceCents: GIVING_MIN_AMOUNT_CENTS,
    });
  });

  it('fechar inscrição vence preço no mesmo payload', () => {
    expect(
      resolveEventRegistrationFields({
        registrationOpen: false,
        priceCents: GIVING_MIN_AMOUNT_CENTS,
      }),
    ).toEqual({ registrationOpen: false, priceCents: null });
  });

  it('ignora valor abaixo do mínimo e trata como gratuita', () => {
    expect(
      resolveEventRegistrationFields({
        registrationOpen: true,
        priceCents: 100,
      }),
    ).toEqual({ registrationOpen: true, priceCents: null });
  });

  it('mantém estado existente quando campos omitidos', () => {
    expect(
      resolveEventRegistrationFields({
        existingRegistrationOpen: true,
        existingPriceCents: 1500,
      }),
    ).toEqual({ registrationOpen: true, priceCents: 1500 });
  });
});
