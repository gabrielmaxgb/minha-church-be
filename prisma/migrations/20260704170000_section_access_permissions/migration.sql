-- Section access permissions for nav / route gating.
-- Enum values must be committed before use (PostgreSQL limitation).

ALTER TYPE "ChurchPermission" ADD VALUE IF NOT EXISTS 'dashboard_access';
ALTER TYPE "ChurchPermission" ADD VALUE IF NOT EXISTS 'members_access';
ALTER TYPE "ChurchPermission" ADD VALUE IF NOT EXISTS 'ministries_access';
ALTER TYPE "ChurchPermission" ADD VALUE IF NOT EXISTS 'activities_access';
ALTER TYPE "ChurchPermission" ADD VALUE IF NOT EXISTS 'schedules_access';
