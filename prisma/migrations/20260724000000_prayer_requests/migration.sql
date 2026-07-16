-- CreateTable
CREATE TABLE "prayer_requests" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "author_member_id" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_anonymous" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "prayer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prayer_request_prayers" (
    "id" TEXT NOT NULL,
    "prayer_request_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prayer_request_prayers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prayer_requests_church_id_deleted_at_created_at_idx" ON "prayer_requests"("church_id", "deleted_at", "created_at");

-- CreateIndex
CREATE INDEX "prayer_requests_author_member_id_idx" ON "prayer_requests"("author_member_id");

-- CreateIndex
CREATE INDEX "prayer_request_prayers_member_id_idx" ON "prayer_request_prayers"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "prayer_request_prayers_prayer_request_id_member_id_key" ON "prayer_request_prayers"("prayer_request_id", "member_id");

-- AddForeignKey
ALTER TABLE "prayer_requests" ADD CONSTRAINT "prayer_requests_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayer_requests" ADD CONSTRAINT "prayer_requests_author_member_id_fkey" FOREIGN KEY ("author_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayer_request_prayers" ADD CONSTRAINT "prayer_request_prayers_prayer_request_id_fkey" FOREIGN KEY ("prayer_request_id") REFERENCES "prayer_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prayer_request_prayers" ADD CONSTRAINT "prayer_request_prayers_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
