-- CreateEnum
CREATE TYPE "ChurchDocumentType" AS ENUM ('cnpj', 'cpf');

-- CreateEnum
CREATE TYPE "ConnectOnboardingStatus" AS ENUM ('none', 'created', 'onboarding', 'verifying', 'active', 'restricted', 'rejected');

-- CreateEnum
CREATE TYPE "ConnectCapabilityStatus" AS ENUM ('inactive', 'pending', 'active');

-- CreateTable
CREATE TABLE "church_fiscal_profiles" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "document_type" "ChurchDocumentType" NOT NULL,
    "document_number" TEXT NOT NULL,
    "legal_name" TEXT NOT NULL,
    "responsible_name" TEXT NOT NULL,
    "responsible_document" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip_code" TEXT,
    "contact_email" TEXT,
    "contact_phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "church_fiscal_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "church_payment_accounts" (
    "id" TEXT NOT NULL,
    "church_id" TEXT NOT NULL,
    "stripe_account_id" TEXT,
    "account_type" TEXT NOT NULL DEFAULT 'express',
    "onboarding_status" "ConnectOnboardingStatus" NOT NULL DEFAULT 'none',
    "charges_enabled" BOOLEAN NOT NULL DEFAULT false,
    "payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
    "details_submitted" BOOLEAN NOT NULL DEFAULT false,
    "pix_status" "ConnectCapabilityStatus" NOT NULL DEFAULT 'inactive',
    "card_status" "ConnectCapabilityStatus" NOT NULL DEFAULT 'inactive',
    "boleto_status" "ConnectCapabilityStatus" NOT NULL DEFAULT 'inactive',
    "requirements_due" JSONB,
    "disabled_reason" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "church_payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "connect_webhook_events" (
    "id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "connect_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "church_fiscal_profiles_church_id_key" ON "church_fiscal_profiles"("church_id");

-- CreateIndex
CREATE UNIQUE INDEX "church_payment_accounts_church_id_key" ON "church_payment_accounts"("church_id");

-- CreateIndex
CREATE UNIQUE INDEX "church_payment_accounts_stripe_account_id_key" ON "church_payment_accounts"("stripe_account_id");

-- AddForeignKey
ALTER TABLE "church_fiscal_profiles" ADD CONSTRAINT "church_fiscal_profiles_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "church_payment_accounts" ADD CONSTRAINT "church_payment_accounts_church_id_fkey" FOREIGN KEY ("church_id") REFERENCES "churches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
