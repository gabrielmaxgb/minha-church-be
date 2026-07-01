-- AlterTable
ALTER TABLE "users" ADD COLUMN "cpf" TEXT,
ADD COLUMN "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "members" ADD COLUMN "cpf" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_cpf_key" ON "users"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "members_church_id_cpf_key" ON "members"("church_id", "cpf");
