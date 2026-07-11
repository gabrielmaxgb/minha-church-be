-- CreateTable
CREATE TABLE "event_roster_assignments" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "role_label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_roster_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_roster_assignments_member_id_idx" ON "event_roster_assignments"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_roster_assignments_event_id_member_id_key" ON "event_roster_assignments"("event_id", "member_id");

-- AddForeignKey
ALTER TABLE "event_roster_assignments" ADD CONSTRAINT "event_roster_assignments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ministry_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_roster_assignments" ADD CONSTRAINT "event_roster_assignments_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
