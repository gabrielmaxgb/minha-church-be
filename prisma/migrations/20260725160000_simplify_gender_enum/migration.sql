-- Map removed gender options to null (Não informado)
UPDATE "members"
SET "gender" = NULL
WHERE "gender" IN ('other', 'prefer_not_to_say');

-- Recreate Gender enum with only male/female
CREATE TYPE "Gender_new" AS ENUM ('male', 'female');

ALTER TABLE "members"
  ALTER COLUMN "gender" TYPE "Gender_new"
  USING ("gender"::text::"Gender_new");

DROP TYPE "Gender";
ALTER TYPE "Gender_new" RENAME TO "Gender";
