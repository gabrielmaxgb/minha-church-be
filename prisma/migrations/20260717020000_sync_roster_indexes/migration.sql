-- Sincroniza índices que existiam no schema.prisma mas não na história de
-- migrations (drift pré-existente, não-destrutivo):
--   1) índice ausente em event_roster_assignments(event_id, roster_slot_id);
--   2) renomeação de índice em member_event_role_profiles (nome truncado pelo
--      Postgres divergia do esperado pelo schema).

-- CreateIndex
CREATE INDEX "event_roster_assignments_event_id_roster_slot_id_idx" ON "event_roster_assignments"("event_id", "roster_slot_id");

-- RenameIndex
ALTER INDEX "member_event_role_profiles_member_id_ministry_id_profile_key_ke" RENAME TO "member_event_role_profiles_member_id_ministry_id_profile_ke_key";
