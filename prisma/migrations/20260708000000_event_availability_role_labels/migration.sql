-- Funções que o membro pode exercer neste evento (subset dos slots do evento).
ALTER TABLE "event_availabilities" ADD COLUMN "role_labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
