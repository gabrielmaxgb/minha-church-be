-- Allow multiple assignments per roster slot (one person per role, N people per function).
ALTER TABLE "event_roster_slots" ADD COLUMN "required_count" INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS "event_roster_assignments_event_id_roster_slot_id_key";
