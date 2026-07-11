-- Colunas de e-mail canônico / verificação (idempotente para bancos já atualizados manualmente).
ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "email_canonical" TEXT,
ADD COLUMN IF NOT EXISTS "email_verified_at" TIMESTAMP(3);

-- Backfill: e-mail canônico = e-mail em minúsculas onde ainda estiver nulo.
UPDATE "users"
SET "email_canonical" = LOWER(TRIM("email"))
WHERE "email_canonical" IS NULL;

ALTER TABLE "users"
ALTER COLUMN "email_canonical" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_canonical_key" ON "users"("email_canonical");
