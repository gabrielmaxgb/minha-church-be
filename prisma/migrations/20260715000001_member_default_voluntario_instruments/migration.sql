-- Membros ativos em ministérios passam a ter Voluntário como função padrão.
UPDATE "member_ministries"
SET "instruments" = ARRAY['voluntario']::text[]
WHERE cardinality("instruments") = 0
  AND "ended_at" IS NULL;
