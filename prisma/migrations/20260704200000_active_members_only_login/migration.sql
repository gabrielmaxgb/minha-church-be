-- Visitantes e inativos ficam só no cadastro pastoral; login só para membros ativos.

DELETE FROM "church_membership_roles" cmr
USING "church_memberships" cm, "members" m
WHERE cmr."membership_id" = cm."id"
  AND m."user_id" = cm."user_id"
  AND m."church_id" = cm."church_id"
  AND m."status" IN ('visitor', 'inactive')
  AND m."deleted_at" IS NULL
  AND cm."is_owner" = false;

DELETE FROM "church_memberships" cm
USING "members" m
WHERE m."user_id" = cm."user_id"
  AND m."church_id" = cm."church_id"
  AND m."status" IN ('visitor', 'inactive')
  AND m."deleted_at" IS NULL
  AND cm."is_owner" = false;

UPDATE "members" m
SET "user_id" = NULL
WHERE m."status" IN ('visitor', 'inactive')
  AND m."deleted_at" IS NULL
  AND m."user_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "church_memberships" cm
    WHERE cm."user_id" = m."user_id"
      AND cm."church_id" = m."church_id"
      AND cm."is_owner" = true
  );
