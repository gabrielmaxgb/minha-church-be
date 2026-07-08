-- AlterTable
ALTER TABLE "ministries" ADD COLUMN "service_functions_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "member_ministries" ADD COLUMN "service_functions_catalog_seen_at" TIMESTAMP(3);
