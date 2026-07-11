-- Replace worship archetype with generic roster flag on any ministry.

ALTER TABLE "ministries" ADD COLUMN "has_roster" BOOLEAN NOT NULL DEFAULT false;

UPDATE "ministries" SET "has_roster" = true WHERE "archetype" = 'worship';

ALTER TABLE "ministries" DROP COLUMN "archetype";

DROP TYPE "MinistryArchetype";
