-- CreateEnum
CREATE TYPE "EventNoteVisibility" AS ENUM ('public', 'private');

-- CreateTable
CREATE TABLE "event_notes" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "author_user_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "visibility" "EventNoteVisibility" NOT NULL DEFAULT 'public',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "event_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_note_roles" (
    "note_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,

    CONSTRAINT "event_note_roles_pkey" PRIMARY KEY ("note_id","role_id")
);

-- CreateIndex
CREATE INDEX "event_notes_church_id_event_id_deleted_at_created_at_idx" ON "event_notes"("church_id", "event_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "event_notes_author_user_id_idx" ON "event_notes"("author_user_id");

-- CreateIndex
CREATE INDEX "event_note_roles_role_id_idx" ON "event_note_roles"("role_id");

-- AddForeignKey
ALTER TABLE "event_notes" ADD CONSTRAINT "event_notes_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_notes" ADD CONSTRAINT "event_notes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "ministry_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_notes" ADD CONSTRAINT "event_notes_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_note_roles" ADD CONSTRAINT "event_note_roles_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "event_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_note_roles" ADD CONSTRAINT "event_note_roles_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "church_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
