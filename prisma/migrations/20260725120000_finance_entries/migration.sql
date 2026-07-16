-- CreateEnum
CREATE TYPE "FinanceEntryType" AS ENUM ('income', 'expense');

-- CreateEnum
CREATE TYPE "FinanceEntryMethod" AS ENUM ('cash', 'transfer', 'other');

-- CreateTable
CREATE TABLE "finance_entries" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "type" "FinanceEntryType" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'brl',
    "occurred_on" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "fund_id" TEXT,
    "method" "FinanceEntryMethod" NOT NULL DEFAULT 'other',
    "note" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "finance_entries_church_id_occurred_on_idx" ON "finance_entries"("church_id", "occurred_on");

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_fund_id_fkey" FOREIGN KEY ("fund_id") REFERENCES "giving_funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_entries" ADD CONSTRAINT "finance_entries_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
