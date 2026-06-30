-- Custom church roles: replace fixed UserRole enum with per-church RBAC.

-- CreateEnum
CREATE TYPE "ChurchPermission" AS ENUM (
  'members_manage',
  'ministries_manage',
  'events_create_church_wide',
  'finances_access',
  'communication_access',
  'reports_access',
  'settings_access',
  'roles_manage',
  'memberships_manage'
);

-- CreateTable
CREATE TABLE "church_roles" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "system_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "church_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "church_role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission" "ChurchPermission" NOT NULL,

    CONSTRAINT "church_role_permissions_pkey" PRIMARY KEY ("role_id","permission")
);

-- CreateTable
CREATE TABLE "church_membership_roles" (
    "membership_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "church_membership_roles_pkey" PRIMARY KEY ("membership_id","role_id")
);

-- AlterTable
ALTER TABLE "church_memberships" ADD COLUMN "is_owner" BOOLEAN NOT NULL DEFAULT false;

-- Seed default system roles for every existing church
INSERT INTO "church_roles" ("id", "church_id", "name", "sort_order", "is_system", "system_key", "created_at", "updated_at")
SELECT
  'crole_' || c."id" || '_admin',
  c."id",
  'Administrador',
  10,
  true,
  'admin',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "churches" c;

INSERT INTO "church_roles" ("id", "church_id", "name", "sort_order", "is_system", "system_key", "created_at", "updated_at")
SELECT
  'crole_' || c."id" || '_pastor',
  c."id",
  'Pastor',
  20,
  true,
  'pastor',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "churches" c;

INSERT INTO "church_roles" ("id", "church_id", "name", "sort_order", "is_system", "system_key", "created_at", "updated_at")
SELECT
  'crole_' || c."id" || '_secretary',
  c."id",
  'Secretário',
  30,
  true,
  'secretary',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "churches" c;

INSERT INTO "church_roles" ("id", "church_id", "name", "sort_order", "is_system", "system_key", "created_at", "updated_at")
SELECT
  'crole_' || c."id" || '_treasurer',
  c."id",
  'Tesoureiro',
  40,
  true,
  'treasurer',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "churches" c;

INSERT INTO "church_roles" ("id", "church_id", "name", "sort_order", "is_system", "system_key", "created_at", "updated_at")
SELECT
  'crole_' || c."id" || '_leader',
  c."id",
  'Líder',
  50,
  true,
  'leader',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "churches" c;

INSERT INTO "church_roles" ("id", "church_id", "name", "sort_order", "is_system", "system_key", "created_at", "updated_at")
SELECT
  'crole_' || c."id" || '_member',
  c."id",
  'Membro',
  60,
  true,
  'member',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "churches" c;

-- Admin permissions
INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT cr."id", p."permission"
FROM "church_roles" cr
CROSS JOIN (
  VALUES
    ('members_manage'::"ChurchPermission"),
    ('ministries_manage'::"ChurchPermission"),
    ('events_create_church_wide'::"ChurchPermission"),
    ('finances_access'::"ChurchPermission"),
    ('communication_access'::"ChurchPermission"),
    ('reports_access'::"ChurchPermission"),
    ('settings_access'::"ChurchPermission"),
    ('roles_manage'::"ChurchPermission"),
    ('memberships_manage'::"ChurchPermission")
) AS p("permission")
WHERE cr."system_key" = 'admin';

-- Pastor permissions
INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT cr."id", p."permission"
FROM "church_roles" cr
CROSS JOIN (
  VALUES
    ('members_manage'::"ChurchPermission"),
    ('ministries_manage'::"ChurchPermission"),
    ('events_create_church_wide'::"ChurchPermission"),
    ('finances_access'::"ChurchPermission"),
    ('communication_access'::"ChurchPermission"),
    ('reports_access'::"ChurchPermission"),
    ('settings_access'::"ChurchPermission"),
    ('memberships_manage'::"ChurchPermission")
) AS p("permission")
WHERE cr."system_key" = 'pastor';

-- Secretary permissions
INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT cr."id", p."permission"
FROM "church_roles" cr
CROSS JOIN (
  VALUES
    ('members_manage'::"ChurchPermission"),
    ('communication_access'::"ChurchPermission")
) AS p("permission")
WHERE cr."system_key" = 'secretary';

-- Treasurer permissions
INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT cr."id", p."permission"
FROM "church_roles" cr
CROSS JOIN (
  VALUES
    ('finances_access'::"ChurchPermission"),
    ('reports_access'::"ChurchPermission")
) AS p("permission")
WHERE cr."system_key" = 'treasurer';

-- Migrate owner flag
UPDATE "church_memberships"
SET "is_owner" = true
WHERE "role" = 'owner';

-- Migrate role assignments (non-owners)
INSERT INTO "church_membership_roles" ("membership_id", "role_id", "assigned_at")
SELECT
  cm."id",
  cr."id",
  CURRENT_TIMESTAMP
FROM "church_memberships" cm
INNER JOIN "church_roles" cr
  ON cr."church_id" = cm."church_id"
  AND cr."system_key" = cm."role"::text
WHERE cm."role" <> 'owner';

-- Drop legacy role column
ALTER TABLE "church_memberships" DROP COLUMN "role";

-- DropEnum
DROP TYPE "UserRole";

-- CreateIndex
CREATE UNIQUE INDEX "church_roles_church_id_name_key" ON "church_roles"("church_id", "name");
CREATE UNIQUE INDEX "church_roles_church_id_system_key_key" ON "church_roles"("church_id", "system_key");

-- AddForeignKey
ALTER TABLE "church_roles" ADD CONSTRAINT "church_roles_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "church_role_permissions" ADD CONSTRAINT "church_role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "church_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "church_membership_roles" ADD CONSTRAINT "church_membership_roles_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "church_memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "church_membership_roles" ADD CONSTRAINT "church_membership_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "church_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
