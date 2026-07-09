-- Trial / subscription base for church onboarding (soft paywall)

CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'canceled');

ALTER TABLE "churches"
  ADD COLUMN "subscription_status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
  ADD COLUMN "trial_ends_at" TIMESTAMP(3);

-- Igrejas já existentes ganham um trial justo a partir de agora (sem bloqueio surpresa).
UPDATE "churches"
SET "trial_ends_at" = CURRENT_TIMESTAMP + INTERVAL '30 days'
WHERE "trial_ends_at" IS NULL;
