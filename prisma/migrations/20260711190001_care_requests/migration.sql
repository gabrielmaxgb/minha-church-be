-- CreateEnum
CREATE TYPE "CareRequestType" AS ENUM ('counseling', 'visit');

-- CreateEnum
CREATE TYPE "CareRequestStatus" AS ENUM ('pending', 'viewed');

-- CreateTable
CREATE TABLE "care_requests" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "type" "CareRequestType" NOT NULL,
    "requester_member_id" TEXT NOT NULL,
    "recipient_member_id" TEXT NOT NULL,
    "message" TEXT,
    "status" "CareRequestStatus" NOT NULL DEFAULT 'pending',
    "viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "care_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "care_requests_church_id_recipient_member_id_status_idx" ON "care_requests"("church_id", "recipient_member_id", "status");

-- CreateIndex
CREATE INDEX "care_requests_church_id_requester_member_id_idx" ON "care_requests"("church_id", "requester_member_id");

-- AddForeignKey
ALTER TABLE "care_requests" ADD CONSTRAINT "care_requests_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_requests" ADD CONSTRAINT "care_requests_requester_member_id_fkey" FOREIGN KEY ("requester_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_requests" ADD CONSTRAINT "care_requests_recipient_member_id_fkey" FOREIGN KEY ("recipient_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill system roles: admin + pastor receive counseling requests
INSERT INTO "church_role_permissions" ("role_id", "permission")
SELECT cr.id, 'counseling_receive'::"ChurchPermission"
FROM "church_roles" cr
WHERE cr.system_key IN ('admin', 'pastor')
ON CONFLICT DO NOTHING;
