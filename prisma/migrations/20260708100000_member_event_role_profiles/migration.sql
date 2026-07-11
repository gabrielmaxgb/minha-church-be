-- Perfil de funções do membro por evento ou série (não por ministério).
CREATE TABLE "member_event_role_profiles" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "ministry_id" TEXT NOT NULL,
    "profile_key" TEXT NOT NULL,
    "role_labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_event_role_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "member_event_role_profiles_member_id_ministry_id_profile_key_key" ON "member_event_role_profiles"("member_id", "ministry_id", "profile_key");

CREATE INDEX "member_event_role_profiles_member_id_idx" ON "member_event_role_profiles"("member_id");

ALTER TABLE "member_event_role_profiles" ADD CONSTRAINT "member_event_role_profiles_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "member_event_role_profiles" ADD CONSTRAINT "member_event_role_profiles_ministry_id_fkey" FOREIGN KEY ("ministry_id") REFERENCES "ministries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
