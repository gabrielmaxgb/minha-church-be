-- Fundos de cobrança (dízimo, oferta, etc.) — base da Fase 2.
CREATE TABLE "giving_funds" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "giving_funds_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "giving_funds_church_id_is_active_idx" ON "giving_funds"("church_id", "is_active");

CREATE UNIQUE INDEX "giving_funds_church_id_slug_key" ON "giving_funds"("church_id", "slug");

ALTER TABLE "giving_funds" ADD CONSTRAINT "giving_funds_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
