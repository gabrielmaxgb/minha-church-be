-- CreateEnum
CREATE TYPE "MemberStatus" AS ENUM ('visitor', 'active', 'inactive');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('single', 'married', 'divorced', 'widowed');

-- CreateTable
CREATE TABLE "members" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "phone_secondary" TEXT,
    "birth_date" DATE,
    "gender" "Gender",
    "marital_status" "MaritalStatus",
    "wedding_anniversary" DATE,
    "street" TEXT,
    "number" TEXT,
    "complement" TEXT,
    "neighborhood" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "status" "MemberStatus" NOT NULL DEFAULT 'visitor',
    "visitor_since" DATE,
    "baptism_date" DATE,
    "membership_date" DATE,
    "user_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ministries" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ministries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ministry_roles" (
    "id" TEXT NOT NULL,
    "ministry_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "can_manage_events" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ministry_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_ministries" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "ministry_id" TEXT NOT NULL,
    "ministry_role_id" TEXT,
    "started_at" DATE,
    "ended_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_ministries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ministry_events" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "ministry_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "created_by_user_id" TEXT,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ministry_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "members_user_id_key" ON "members"("user_id");

-- CreateIndex
CREATE INDEX "members_church_id_status_idx" ON "members"("church_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "members_church_id_email_key" ON "members"("church_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ministries_church_id_name_key" ON "ministries"("church_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ministry_roles_ministry_id_name_key" ON "ministry_roles"("ministry_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "member_ministries_member_id_ministry_id_key" ON "member_ministries"("member_id", "ministry_id");

-- CreateIndex
CREATE INDEX "ministry_events_church_id_ministry_id_starts_at_idx" ON "ministry_events"("church_id", "ministry_id", "starts_at");

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ministries" ADD CONSTRAINT "ministries_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ministry_roles" ADD CONSTRAINT "ministry_roles_ministry_id_fkey" FOREIGN KEY ("ministry_id") REFERENCES "ministries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_ministries" ADD CONSTRAINT "member_ministries_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_ministries" ADD CONSTRAINT "member_ministries_ministry_id_fkey" FOREIGN KEY ("ministry_id") REFERENCES "ministries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_ministries" ADD CONSTRAINT "member_ministries_ministry_role_id_fkey" FOREIGN KEY ("ministry_role_id") REFERENCES "ministry_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ministry_events" ADD CONSTRAINT "ministry_events_ministry_id_fkey" FOREIGN KEY ("ministry_id") REFERENCES "ministries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ministry_events" ADD CONSTRAINT "ministry_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
