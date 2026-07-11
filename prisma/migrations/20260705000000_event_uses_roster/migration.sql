-- AlterTable
ALTER TABLE "ministry_events" ADD COLUMN "uses_roster" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: eventos que já participavam do fluxo de escala
UPDATE "ministry_events" AS e
SET "uses_roster" = true
WHERE e."roster_open" = true
   OR (
     e."ministry_id" IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM "ministries" AS m
       WHERE m."id" = e."ministry_id" AND m."has_roster" = true
     )
   );
