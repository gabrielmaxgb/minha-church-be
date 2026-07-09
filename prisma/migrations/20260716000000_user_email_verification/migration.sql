-- Email canonical + verification for onboarding anti-abuse

ALTER TABLE "users" ADD COLUMN "email_canonical" TEXT;
ALTER TABLE "users" ADD COLUMN "email_verified_at" TIMESTAMP(3);

UPDATE "users"
SET
  "email_canonical" = lower(trim("email")),
  "email_verified_at" = COALESCE("email_verified_at", CURRENT_TIMESTAMP)
WHERE "email_canonical" IS NULL;

ALTER TABLE "users" ALTER COLUMN "email_canonical" SET NOT NULL;

CREATE UNIQUE INDEX "users_email_canonical_key" ON "users"("email_canonical");

CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "email_verification_tokens_token_hash_key" ON "email_verification_tokens"("token_hash");
CREATE INDEX "email_verification_tokens_user_id_idx" ON "email_verification_tokens"("user_id");

ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
