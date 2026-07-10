-- CreateTable
CREATE TABLE "families" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "families_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "families_church_id_idx" ON "families"("church_id");

-- CreateIndex
CREATE UNIQUE INDEX "families_church_id_name_key" ON "families"("church_id", "name");

-- AddForeignKey
ALTER TABLE "families" ADD CONSTRAINT "families_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "members" ADD COLUMN "family_id" TEXT;

-- CreateIndex
CREATE INDEX "members_church_id_family_id_idx" ON "members"("church_id", "family_id");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE SET NULL ON UPDATE CASCADE;
