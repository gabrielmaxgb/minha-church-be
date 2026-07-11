-- Garante a função padrão "voluntario" em ministérios existentes.
INSERT INTO "ministry_service_functions" ("id", "ministry_id", "label", "sort_order", "updated_at")
SELECT
  md5(random()::text || m.id || clock_timestamp()::text),
  m.id,
  'voluntario',
  0,
  CURRENT_TIMESTAMP
FROM "ministries" m
WHERE NOT EXISTS (
  SELECT 1
  FROM "ministry_service_functions" sf
  WHERE sf.ministry_id = m.id
    AND sf.label = 'voluntario'
);
