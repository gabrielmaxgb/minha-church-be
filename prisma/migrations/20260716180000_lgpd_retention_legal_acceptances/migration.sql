-- Soft-delete / LGPD retention fields + legal acceptances
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "users_deleted_at_idx" ON "users"("deleted_at");

ALTER TABLE "churches" ADD COLUMN IF NOT EXISTS "dpa_accepted_at" TIMESTAMP(3);
ALTER TABLE "churches" ADD COLUMN IF NOT EXISTS "dpa_version" TEXT;
ALTER TABLE "churches" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
ALTER TABLE "churches" ADD COLUMN IF NOT EXISTS "purge_after" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "churches_deleted_at_idx" ON "churches"("deleted_at");
CREATE INDEX IF NOT EXISTS "churches_purge_after_idx" ON "churches"("purge_after");

CREATE INDEX IF NOT EXISTS "members_deleted_at_idx" ON "members"("deleted_at");

DO $$ BEGIN
  CREATE TYPE "LegalDocumentType" AS ENUM ('terms', 'privacy', 'dpa');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "legal_acceptances" (
  "id" TEXT NOT NULL,
  "church_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "document_type" "LegalDocumentType" NOT NULL,
  "version" TEXT NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ip" TEXT,
  CONSTRAINT "legal_acceptances_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "legal_acceptances_church_id_document_type_idx" ON "legal_acceptances"("church_id", "document_type");
CREATE INDEX IF NOT EXISTS "legal_acceptances_user_id_idx" ON "legal_acceptances"("user_id");

DO $$ BEGIN
  ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "legal_acceptances" ADD CONSTRAINT "legal_acceptances_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
