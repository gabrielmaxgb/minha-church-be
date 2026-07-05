-- CreateEnum
CREATE TYPE "MinistryArchetype" AS ENUM ('none', 'worship');

-- CreateEnum
CREATE TYPE "EventAvailabilityStatus" AS ENUM ('available', 'unavailable');

-- AlterTable
ALTER TABLE "ministries" ADD COLUMN "archetype" "MinistryArchetype" NOT NULL DEFAULT 'none';

-- AlterTable
ALTER TABLE "member_ministries" ADD COLUMN "instruments" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ministry_events" ADD COLUMN "roster_open" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "event_availabilities" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "status" "EventAvailabilityStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_availabilities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_availabilities_member_id_idx" ON "event_availabilities"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_availabilities_event_id_member_id_key" ON "event_availabilities"("event_id", "member_id");

-- AddForeignKey
ALTER TABLE "event_availabilities" ADD CONSTRAINT "event_availabilities_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ministry_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_availabilities" ADD CONSTRAINT "event_availabilities_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
