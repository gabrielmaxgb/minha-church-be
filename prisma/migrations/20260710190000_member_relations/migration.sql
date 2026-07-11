-- CreateEnum
CREATE TYPE "MemberRelationType" AS ENUM ('spouse', 'parent');

-- CreateTable
CREATE TABLE "member_relations" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "from_member_id" TEXT NOT NULL,
    "to_member_id" TEXT NOT NULL,
    "type" "MemberRelationType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_relations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "member_relations_church_id_idx" ON "member_relations"("church_id");

-- CreateIndex
CREATE INDEX "member_relations_to_member_id_idx" ON "member_relations"("to_member_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_relations_from_member_id_to_member_id_type_key" ON "member_relations"("from_member_id", "to_member_id", "type");

-- AddForeignKey
ALTER TABLE "member_relations" ADD CONSTRAINT "member_relations_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_relations" ADD CONSTRAINT "member_relations_from_member_id_fkey" FOREIGN KEY ("from_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_relations" ADD CONSTRAINT "member_relations_to_member_id_fkey" FOREIGN KEY ("to_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
