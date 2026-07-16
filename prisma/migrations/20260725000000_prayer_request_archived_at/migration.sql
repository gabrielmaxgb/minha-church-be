-- Soft-archive de pedidos de oração (sai do quadro ativo após 30 dias).
ALTER TABLE "prayer_requests" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "prayer_requests_church_id_deleted_at_archived_at_created_at_idx"
  ON "prayer_requests"("church_id", "deleted_at", "archived_at", "created_at");
