-- Remove o valor morto 'ministries_rosters_manage' do enum "ChurchPermission".
-- Ele foi abandonado na migration 20260704220000 (a lógica migrou para a coluna
-- booleana ministry_roles.can_manage_roster) e removido do schema.prisma, mas
-- continuava existindo fisicamente no tipo do Postgres, gerando drift.
-- Nenhum dado usa esse valor. Padrão recreate-type do Postgres (seguro, sem perda).

ALTER TYPE "ChurchPermission" RENAME TO "ChurchPermission_old";

CREATE TYPE "ChurchPermission" AS ENUM (
  'dashboard_access',
  'members_access',
  'ministries_access',
  'activities_access',
  'schedules_access',
  'members_manage',
  'ministries_manage',
  'events_create_church_wide',
  'finances_access',
  'communication_access',
  'reports_access',
  'settings_access',
  'roles_manage',
  'memberships_manage',
  'communication_manage',
  'counseling_receive'
);

-- Rede de segurança: garante que não reste nenhuma linha com o valor morto
-- antes de converter a coluna para o novo tipo (o cast falharia se restasse).
DELETE FROM "church_role_permissions"
WHERE "permission"::text = 'ministries_rosters_manage';

ALTER TABLE "church_role_permissions"
  ALTER COLUMN "permission" TYPE "ChurchPermission"
  USING ("permission"::text::"ChurchPermission");

DROP TYPE "ChurchPermission_old";
