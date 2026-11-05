-- CreateEnum
CREATE TYPE "PeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "EntrySource" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "EntryKind" AS ENUM ('CUSTOMER_RECEIPT', 'RECEIPT_VOID', 'REVENUE', 'COGS', 'PURCHASE', 'ISSUE', 'EXPENSE', 'SUPPLIER_PAYMENT', 'ASSET_PURCHASE', 'DEPRECIATION', 'ALLOCATION', 'VAT_OFFSET', 'CLOSING', 'MANUAL');

-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('CASH', 'BANK', 'CREDIT');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('FIXED_ASSET', 'TOOL');

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCredit" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LedgerAccount_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "status" "PeriodStatus" NOT NULL DEFAULT 'OPEN',
    "pricedAt" TIMESTAMP(3),
    "depreciatedAt" TIMESTAMP(3),
    "allocatedAt" TIMESTAMP(3),
    "vatOffsetAt" TIMESTAMP(3),
    "transferredAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "revenueVnd" BIGINT,
    "cogsVnd" BIGINT,
    "sellingVnd" BIGINT,
    "adminVnd" BIGINT,
    "otherNetVnd" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodOpening" (
    "periodId" UUID NOT NULL,
    "accountCode" TEXT NOT NULL,
    "balanceVnd" BIGINT NOT NULL,

    CONSTRAINT "PeriodOpening_pkey" PRIMARY KEY ("periodId","accountCode")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "periodId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "EntryKind" NOT NULL,
    "source" "EntrySource" NOT NULL DEFAULT 'AUTO',
    "sourceType" TEXT,
    "sourceId" TEXT,
    "orderId" UUID,
    "customerId" UUID,
    "supplierId" UUID,
    "note" TEXT,
    "originalLines" JSONB,
    "editReason" TEXT,
    "editedById" UUID,
    "editedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountCode" TEXT NOT NULL,
    "debitVnd" BIGINT NOT NULL DEFAULT 0,
    "creditVnd" BIGINT NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "taxCode" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Material" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Material_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialOpening" (
    "periodId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "priceVnd" BIGINT NOT NULL,

    CONSTRAINT "MaterialOpening_pkey" PRIMARY KEY ("periodId","materialId")
);

-- CreateTable
CREATE TABLE "StockReceipt" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "periodId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "supplierId" UUID NOT NULL,
    "payMethod" "PayMethod" NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 8,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceiptLine" (
    "id" UUID NOT NULL,
    "receiptId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "priceVnd" BIGINT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockReceiptLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockIssue" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "periodId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "orderId" UUID,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockIssueLine" (
    "id" UUID NOT NULL,
    "issueId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "priceVnd" BIGINT NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "StockIssueLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "split" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashPayment" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "periodId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" UUID,
    "supplierId" UUID,
    "amountVnd" BIGINT NOT NULL,
    "vatRate" INTEGER NOT NULL DEFAULT 0,
    "vatVnd" BIGINT NOT NULL DEFAULT 0,
    "method" "PayMethod" NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FixedAsset" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "costVnd" BIGINT NOT NULL,
    "startMonth" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "expenseAccount" TEXT NOT NULL,
    "supplierId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FixedAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountingPeriod_month_key" ON "AccountingPeriod"("month");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_code_key" ON "JournalEntry"("code");

-- CreateIndex
CREATE INDEX "JournalEntry_periodId_date_idx" ON "JournalEntry"("periodId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_kind_idx" ON "JournalEntry"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_sourceType_sourceId_key" ON "JournalEntry"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- CreateIndex
CREATE INDEX "JournalLine_accountCode_idx" ON "JournalLine"("accountCode");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Material_code_key" ON "Material"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceipt_code_key" ON "StockReceipt"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StockIssue_code_key" ON "StockIssue"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseCategory_name_key" ON "ExpenseCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CashPayment_code_key" ON "CashPayment"("code");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_code_key" ON "FixedAsset"("code");

-- AddForeignKey
ALTER TABLE "AccountingPeriod" ADD CONSTRAINT "AccountingPeriod_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodOpening" ADD CONSTRAINT "PeriodOpening_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodOpening" ADD CONSTRAINT "PeriodOpening_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "LedgerAccount"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountCode_fkey" FOREIGN KEY ("accountCode") REFERENCES "LedgerAccount"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialOpening" ADD CONSTRAINT "MaterialOpening_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialOpening" ADD CONSTRAINT "MaterialOpening_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "StockReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceiptLine" ADD CONSTRAINT "StockReceiptLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIssue" ADD CONSTRAINT "StockIssue_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIssueLine" ADD CONSTRAINT "StockIssueLine_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "StockIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockIssueLine" ADD CONSTRAINT "StockIssueLine_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashPayment" ADD CONSTRAINT "CashPayment_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data: chart of accounts (Circular 133, the accounts the internal books use)
INSERT INTO "LedgerAccount" ("code", "name", "isCredit", "sortOrder") VALUES
  ('111', 'Tiền mặt', false, 10),
  ('112', 'Tiền gửi ngân hàng', false, 20),
  ('131', 'Phải thu của khách hàng', false, 30),
  ('1331', 'Thuế GTGT được khấu trừ', false, 40),
  ('138', 'Phải thu khác', false, 50),
  ('141', 'Tạm ứng', false, 60),
  ('152', 'Nguyên liệu, vật liệu', false, 70),
  ('153', 'Công cụ, dụng cụ', false, 80),
  ('154', 'Chi phí sản xuất, kinh doanh dở dang', false, 90),
  ('211', 'Tài sản cố định', false, 100),
  ('214', 'Hao mòn tài sản cố định', true, 110),
  ('242', 'Chi phí trả trước', false, 120),
  ('331', 'Phải trả cho người bán', true, 130),
  ('33311', 'Thuế GTGT đầu ra phải nộp', true, 140),
  ('3334', 'Thuế thu nhập doanh nghiệp', true, 150),
  ('334', 'Phải trả người lao động', true, 160),
  ('338', 'Phải trả, phải nộp khác', true, 170),
  ('341', 'Vay và nợ thuê tài chính', true, 180),
  ('411', 'Vốn đầu tư của chủ sở hữu', true, 190),
  ('421', 'Lợi nhuận sau thuế chưa phân phối', true, 200),
  ('511', 'Doanh thu bán hàng và cung cấp dịch vụ', true, 210),
  ('515', 'Doanh thu hoạt động tài chính', true, 220),
  ('632', 'Giá vốn hàng bán', false, 230),
  ('635', 'Chi phí tài chính', false, 240),
  ('6421', 'Chi phí bán hàng', false, 250),
  ('6422', 'Chi phí quản lý doanh nghiệp', false, 260),
  ('711', 'Thu nhập khác', true, 270),
  ('811', 'Chi phí khác', false, 280),
  ('821', 'Chi phí thuế thu nhập doanh nghiệp', false, 290),
  ('911', 'Xác định kết quả kinh doanh', true, 300);

-- Data: expense categories and how they split
INSERT INTO "ExpenseCategory" ("id", "name", "split", "sortOrder") VALUES
  (gen_random_uuid(), 'Thuê mặt bằng', '[{"account":"6422","percent":100}]', 10),
  (gen_random_uuid(), 'Điện, nước', '[{"account":"154","percent":60},{"account":"6422","percent":40}]', 20),
  (gen_random_uuid(), 'Lương nhân viên', '[{"account":"154","percent":50},{"account":"6421","percent":20},{"account":"6422","percent":30}]', 30),
  (gen_random_uuid(), 'Vận chuyển thuê ngoài', '[{"account":"6421","percent":100}]', 40),
  (gen_random_uuid(), 'Tiếp khách', '[{"account":"6421","percent":100}]', 50),
  (gen_random_uuid(), 'Văn phòng phẩm, internet', '[{"account":"6422","percent":100}]', 60),
  (gen_random_uuid(), 'Sửa chữa máy móc', '[{"account":"154","percent":100}]', 70);

-- Data: the accounting group keeps the books; groups that saw payments can read them
UPDATE "Role"
SET "permissions" = ARRAY(SELECT DISTINCT p FROM unnest("permissions" || ARRAY['accounting.view', 'accounting.post', 'accounting.close']::text[]) AS p)
WHERE NOT "isSystem" AND "name" = 'Kế toán';
