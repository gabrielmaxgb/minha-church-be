-- Taxa do processador (Stripe) por contribuição / inscrição, para saldo líquido transparente.
ALTER TABLE "giving_donations"
  ADD COLUMN IF NOT EXISTS "processor_fee_cents" INTEGER,
  ADD COLUMN IF NOT EXISTS "payment_method_type" TEXT;

ALTER TABLE "event_ticket_purchases"
  ADD COLUMN IF NOT EXISTS "processor_fee_cents" INTEGER,
  ADD COLUMN IF NOT EXISTS "payment_method_type" TEXT;
