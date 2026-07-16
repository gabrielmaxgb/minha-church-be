-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM (
  'registration_open',
  'schedule_roster_assigned',
  'account_linked',
  'pending_access'
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "user_id" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "read_at" TIMESTAMP(3),
    "acked_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_reads" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_church_id_user_id_created_at_idx" ON "notifications"("church_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_church_id_type_entity_id_idx" ON "notifications"("church_id", "type", "entity_id");

-- CreateIndex
CREATE INDEX "notifications_expires_at_idx" ON "notifications"("expires_at");

-- Partial unique: personal dedupe
CREATE UNIQUE INDEX "notifications_personal_dedupe_idx"
ON "notifications" ("church_id", "type", "entity_id", "user_id")
WHERE "user_id" IS NOT NULL AND "entity_id" IS NOT NULL;

-- Partial unique: shared staff dedupe
CREATE UNIQUE INDEX "notifications_shared_dedupe_idx"
ON "notifications" ("church_id", "type", "entity_id")
WHERE "user_id" IS NULL AND "entity_id" IS NOT NULL;

-- CreateIndex
CREATE INDEX "notification_reads_user_id_idx" ON "notification_reads"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_reads_notification_id_user_id_key" ON "notification_reads"("notification_id", "user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
