-- CreateEnum
CREATE TYPE "AnnouncementPriority" AS ENUM ('normal', 'important', 'urgent');

-- CreateEnum
CREATE TYPE "AnnouncementAudienceType" AS ENUM ('church_wide', 'ministries');

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" "AnnouncementPriority" NOT NULL DEFAULT 'normal',
    "audience_type" "AnnouncementAudienceType" NOT NULL DEFAULT 'church_wide',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_ministries" (
    "announcement_id" TEXT NOT NULL,
    "ministry_id" TEXT NOT NULL,

    CONSTRAINT "announcement_ministries_pkey" PRIMARY KEY ("announcement_id", "ministry_id")
);

-- CreateTable
CREATE TABLE "announcement_reads" (
    "announcement_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcement_reads_pkey" PRIMARY KEY ("announcement_id", "user_id")
);

-- CreateIndex
CREATE INDEX "announcements_church_id_deleted_at_published_at_idx" ON "announcements"("church_id", "deleted_at", "published_at");

-- CreateIndex
CREATE INDEX "announcement_ministries_ministry_id_idx" ON "announcement_ministries"("ministry_id");

-- CreateIndex
CREATE INDEX "announcement_reads_user_id_idx" ON "announcement_reads"("user_id");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_ministries" ADD CONSTRAINT "announcement_ministries_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_ministries" ADD CONSTRAINT "announcement_ministries_ministry_id_fkey" FOREIGN KEY ("ministry_id") REFERENCES "ministries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_fkey" FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: concede o envio de comunicados aos cargos que já administram a igreja.
INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT cr.id, 'communication_manage'::"ChurchPermission"
FROM "church_roles" cr
WHERE cr.system_key IN ('admin', 'pastor', 'secretary')
ON CONFLICT DO NOTHING;
