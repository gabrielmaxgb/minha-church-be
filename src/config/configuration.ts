import {
  BILLING_TIER_IDS,
  TIER_STRIPE_ENV_KEYS,
  type BillingTierId,
} from './billing-plans.config';

function stripePricesFromEnv(): Record<
  BillingTierId,
  { monthly: string; yearly: string }
> {
  return Object.fromEntries(
    BILLING_TIER_IDS.map((tierId) => {
      const key = TIER_STRIPE_ENV_KEYS[tierId];

      return [
        tierId,
        {
          monthly: process.env[`STRIPE_PRICE_${key}_MONTHLY`] ?? '',
          yearly: process.env[`STRIPE_PRICE_${key}_YEARLY`] ?? '',
        },
      ];
    }),
  ) as Record<BillingTierId, { monthly: string; yearly: string }>;
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  appUrl:
    process.env.APP_URL ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  jwt: {
    secret:
      process.env.JWT_SECRET ?? 'dev-secret-change-in-production-min-32-chars',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    fromEmail:
      process.env.RESEND_FROM_EMAIL ??
      'MinhaChurch <nao-responda@send.minhachurch.com>',
  },
  trial: {
    enforcement: process.env.TRIAL_ENFORCEMENT === 'true',
    durationDays: parseInt(process.env.TRIAL_DURATION_DAYS ?? '30', 10),
  },
  email: {
    /** Força deduplicação Gmail (+tag) mesmo fora de produção. */
    strictGmailAliases:
      process.env.ENFORCE_CANONICAL_EMAIL === 'true' ||
      process.env.EMAIL_STRICT_GMAIL_ALIASES === 'true' ||
      (process.env.ENFORCE_CANONICAL_EMAIL !== 'false' &&
        process.env.EMAIL_STRICT_GMAIL_ALIASES !== 'false' &&
        process.env.NODE_ENV === 'production'),
    verificationRequired: process.env.EMAIL_VERIFICATION_REQUIRED === 'true',
  },
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    prices: stripePricesFromEnv(),
  },
});
