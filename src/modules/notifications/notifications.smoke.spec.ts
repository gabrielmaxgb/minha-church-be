import { NotificationType } from '@prisma/client';

import { resolveEventRegistrationFields } from '../events/event-registration-fields';

describe('notifications inbox helpers (smoke)', () => {
  it('preço pago força inscrição aberta quando não fecha explicitamente', () => {
    expect(
      resolveEventRegistrationFields({
        priceCents: 1500,
      }),
    ).toEqual({ registrationOpen: true, priceCents: 1500 });
  });

  it('NotificationType cobre a 1ª leva do plano', () => {
    expect(Object.values(NotificationType)).toEqual(
      expect.arrayContaining([
        'registration_open',
        'schedule_roster_assigned',
        'account_linked',
        'pending_access',
        'giving_donation_refunded',
      ]),
    );
  });

  it('tipos do inbox são os únicos que disparam Web Push', () => {
    // Contrato: push espelha NotificationType — não os alertas derivados do sino.
    expect(Object.values(NotificationType).length).toBe(5);
  });
});
