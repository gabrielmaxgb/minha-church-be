import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_TRIAL_EXPIRED_KEY = 'allowWhenTrialExpired';

/** Permite esta rota de escrita mesmo com o trial expirado (whitelist). */
export const AllowWhenTrialExpired = () =>
  SetMetadata(ALLOW_WHEN_TRIAL_EXPIRED_KEY, true);
