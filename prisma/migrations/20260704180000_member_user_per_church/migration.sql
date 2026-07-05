-- Allow one pastoral record per user per church (instead of one globally).
DROP INDEX IF EXISTS "members_user_id_key";

CREATE UNIQUE INDEX "members_church_id_user_id_key" ON "members"("church_id", "user_id");

-- Link existing pastoral records by e-mail when login was not connected yet.
UPDATE "members" m
SET
  "user_id" = cm."user_id",
  "name" = u."name",
  "status" = 'active',
  "deleted_at" = NULL
FROM "church_memberships" cm
INNER JOIN "users" u ON u."id" = cm."user_id"
WHERE m."church_id" = cm."church_id"
  AND m."deleted_at" IS NULL
  AND m."user_id" IS NULL
  AND m."email" IS NOT NULL
  AND lower(m."email") = lower(u."email")
  AND NOT EXISTS (
    SELECT 1
    FROM "members" linked
    WHERE linked."church_id" = cm."church_id"
      AND linked."user_id" = cm."user_id"
      AND linked."deleted_at" IS NULL
  );

-- Backfill pastoral records for users with church access but no member row in that church.
INSERT INTO "members" (
  "id",
  "church_id",
  "name",
  "email",
  "status",
  "membership_date",
  "user_id",
  "created_at",
  "updated_at"
)
SELECT
  'mbr_' || substr(md5(cm."user_id" || cm."church_id" || random()::text), 1, 22),
  cm."church_id",
  u."name",
  u."email",
  'active',
  COALESCE(cm."created_at"::date, CURRENT_DATE),
  cm."user_id",
  NOW(),
  NOW()
FROM "church_memberships" cm
INNER JOIN "users" u ON u."id" = cm."user_id"
WHERE NOT EXISTS (
  SELECT 1
  FROM "members" m
  WHERE m."church_id" = cm."church_id"
    AND m."user_id" = cm."user_id"
    AND m."deleted_at" IS NULL
)
AND NOT EXISTS (
  SELECT 1
  FROM "members" m
  WHERE m."church_id" = cm."church_id"
    AND m."email" IS NOT NULL
    AND lower(m."email") = lower(u."email")
    AND m."deleted_at" IS NULL
);
