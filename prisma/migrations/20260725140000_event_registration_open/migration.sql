-- Inscrição independente do preço: free (null) ou paga (>= 500).
ALTER TABLE "ministry_events"
ADD COLUMN "registration_open" BOOLEAN NOT NULL DEFAULT false;

-- Eventos já com preço pago continuam com inscrição aberta.
UPDATE "ministry_events"
SET "registration_open" = true
WHERE "price_cents" IS NOT NULL
  AND "price_cents" > 0
  AND "deleted_at" IS NULL;

-- Evita duas confirmações succeeded do mesmo membro no mesmo evento (race-safe).
CREATE UNIQUE INDEX "event_ticket_purchases_event_member_succeeded_uidx"
ON "event_ticket_purchases" ("event_id", "member_id")
WHERE "status" = 'succeeded' AND "member_id" IS NOT NULL;
