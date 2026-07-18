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

const JWT_SECRET_MIN_LENGTH = 32;

function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim() ?? '';

  if (secret.length < JWT_SECRET_MIN_LENGTH) {
    throw new Error(
      `JWT_SECRET is required and must be at least ${JWT_SECRET_MIN_LENGTH} characters.`,
    );
  }

  return secret;
}

export default () => ({
  port: parseInt(process.env.PORT ?? '3001', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  appUrl:
    process.env.APP_URL ?? process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  jwt: {
    secret: requireJwtSecret(),
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
    /** Dias que a página pública de doação continua no ar após entrar em past_due. */
    pastDueGraceDays: parseInt(process.env.PAST_DUE_GRACE_DAYS ?? '7', 10),
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
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    connectWebhookSecret: process.env.STRIPE_CONNECT_WEBHOOK_SECRET ?? '',
    prices: stripePricesFromEnv(),
  },
  payments: {
    /** Taxa da plataforma por transação, em basis points (100 = 1%). Default 0 no lançamento. */
    platformFeeBps: parseInt(process.env.PAYMENTS_PLATFORM_FEE_BPS ?? '0', 10),
    /** Métodos habilitados para cobranças da igreja (capabilities solicitadas no Connect). */
    enabledMethods: (process.env.PAYMENTS_ENABLED_METHODS ?? 'pix,card,boleto')
      .split(',')
      .map((method) => method.trim())
      .filter(Boolean),
  },
  /** Web Push (PWA). Sem chaves, subscribe/send ficam no-op. */
  webPush: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() ?? '',
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY?.trim() ?? '',
    vapidSubject:
      process.env.VAPID_SUBJECT?.trim() ?? 'https://minhachurch.com',
  },
});
