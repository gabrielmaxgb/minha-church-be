-- CreateEnum
CREATE TYPE "PastoralNoteType" AS ENUM ('visit', 'conversation', 'call', 'follow_up', 'other');

-- CreateTable
CREATE TABLE "pastoral_notes" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "type" "PastoralNoteType" NOT NULL DEFAULT 'other',
    "body" TEXT NOT NULL,
    "occurred_on" DATE NOT NULL,
    "follow_up_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "pastoral_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pastoral_notes_church_id_member_id_deleted_at_occurred_on_idx" ON "pastoral_notes"("church_id", "member_id", "deleted_at", "occurred_on");

-- CreateIndex
CREATE INDEX "pastoral_notes_church_id_follow_up_on_deleted_at_idx" ON "pastoral_notes"("church_id", "follow_up_on", "deleted_at");

-- CreateIndex
CREATE INDEX "pastoral_notes_author_user_id_idx" ON "pastoral_notes"("author_user_id");

-- AddForeignKey
ALTER TABLE "pastoral_notes" ADD CONSTRAINT "pastoral_notes_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pastoral_notes" ADD CONSTRAINT "pastoral_notes_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pastoral_notes" ADD CONSTRAINT "pastoral_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: admin e pastor do sistema
INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT cr.id, 'pastoral_care'::"ChurchPermission"
FROM "church_roles" cr
WHERE cr.system_key IN ('admin', 'pastor')
ON CONFLICT DO NOTHING;

-- Quem já recebe aconselhamento também pode acompanhar (cargos custom)
INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT crp.role_id, 'pastoral_care'::"ChurchPermission"
FROM "church_role_permissions" crp
WHERE crp.permission = 'counseling_receive'::"ChurchPermission"
ON CONFLICT DO NOTHING;
