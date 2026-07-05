-- CreateEnum
CREATE TYPE "WorshipAvailabilityPeriod" AS ENUM ('weekly', 'monthly', 'quarterly', 'semiannual', 'annual');

-- AlterTable
ALTER TABLE "ministries" ADD COLUMN     "availability_window_active" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "availability_period_type" "WorshipAvailabilityPeriod",
ADD COLUMN     "availability_period_start" DATE,
ADD COLUMN     "availability_period_end" DATE;
