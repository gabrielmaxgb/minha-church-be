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
  onboarding: {
    enforceCanonicalEmail: readOnboardingFlag('ENFORCE_CANONICAL_EMAIL', true),
    emailVerificationRequired: readOnboardingFlag(
      'EMAIL_VERIFICATION_REQUIRED',
      true,
    ),
    unverifiedMemberLimit: parseInt(
      process.env.UNVERIFIED_MEMBER_LIMIT ?? '5',
      10,
    ),
  },
});

function readOnboardingFlag(
  envName: string,
  productionDefault: boolean,
): boolean {
  const raw = process.env[envName]?.trim().toLowerCase();

  if (raw === 'true') {
    return true;
  }

  if (raw === 'false') {
    return false;
  }

  return (process.env.NODE_ENV ?? 'development') === 'production'
    ? productionDefault
    : !productionDefault;
}
