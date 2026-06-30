-- CreateEnum
CREATE TYPE "ChurchPlanTier" AS ENUM ('starter', 'small', 'growth', 'consolidated', 'enterprise');

-- AlterTable
ALTER TABLE "churches" ADD COLUMN "plan_tier" "ChurchPlanTier" NOT NULL DEFAULT 'starter';

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_church_id_created_at_id_idx" ON "audit_logs"("church_id", "created_at" DESC, "id" DESC);
CREATE INDEX "audit_logs_church_id_action_idx" ON "audit_logs"("church_id", "action");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Demo church on growth tier for longer retention during development
UPDATE "churches" SET "plan_tier" = 'growth' WHERE "id" = 'church_demo';
