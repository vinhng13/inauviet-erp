-- CreateEnum
CREATE TYPE "PricingMode" AS ENUM ('AREA', 'UNIT');

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'SENT', 'WON', 'LOST');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "quoteId" UUID;

-- AlterTable
ALTER TABLE "OrderLine" ADD COLUMN     "areaPriceVnd" BIGINT,
ADD COLUMN     "heightM" DECIMAL(8,2),
ADD COLUMN     "productId" UUID,
ADD COLUMN     "quoteLineId" UUID,
ADD COLUMN     "unit" TEXT,
ADD COLUMN     "widthM" DECIMAL(8,2);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "pricingMode" "PricingMode" NOT NULL,
    "unit" TEXT NOT NULL,
    "unitPriceVnd" BIGINT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "title" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "quoteDate" DATE NOT NULL,
    "validDays" INTEGER NOT NULL DEFAULT 7,
    "note" TEXT,
    "totalVnd" BIGINT NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "lostAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "wonAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuoteLine" (
    "id" UUID NOT NULL,
    "quoteId" UUID NOT NULL,
    "productId" UUID,
    "description" TEXT NOT NULL,
    "spec" TEXT,
    "unit" TEXT NOT NULL,
    "widthM" DECIMAL(8,2),
    "heightM" DECIMAL(8,2),
    "areaPriceVnd" BIGINT,
    "quantity" INTEGER NOT NULL,
    "unitPriceVnd" BIGINT NOT NULL,
    "lineTotalVnd" BIGINT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Product_name_key" ON "Product"("name");

-- CreateIndex
CREATE INDEX "Product_isActive_category_idx" ON "Product"("isActive", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_code_key" ON "Quote"("code");

-- CreateIndex
CREATE INDEX "Quote_customerId_idx" ON "Quote"("customerId");

-- CreateIndex
CREATE INDEX "Quote_status_quoteDate_idx" ON "Quote"("status", "quoteDate");

-- CreateIndex
CREATE INDEX "QuoteLine_quoteId_idx" ON "QuoteLine"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuoteLine" ADD CONSTRAINT "QuoteLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: groups that can create orders can see the product catalog; those that also see prices get the quote permissions.
UPDATE "Role"
SET "permissions" = ARRAY(SELECT DISTINCT p FROM unnest("permissions" || ARRAY['products.view']::text[]) AS p)
WHERE NOT "isSystem" AND 'orders.create' = ANY("permissions");

UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT p FROM unnest("permissions" || ARRAY['customers.view', 'quotes.view', 'quotes.create', 'quotes.update', 'quotes.close']::text[]) AS p
)
WHERE NOT "isSystem" AND 'orders.create' = ANY("permissions") AND 'money.view' = ANY("permissions");
