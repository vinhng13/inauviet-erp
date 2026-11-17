-- CreateEnum
CREATE TYPE "WhPartnerKind" AS ENUM ('DIE_MAKER', 'DIE_SHOP', 'SUPPLIER', 'OTHER');

-- CreateEnum
CREATE TYPE "WhSlipKind" AS ENUM ('RECEIPT', 'ISSUE', 'RETURN', 'ADJUST');

-- CreateEnum
CREATE TYPE "WhCountStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhDieKind" AS ENUM ('CUT', 'FOIL', 'EMBOSS');

-- CreateEnum
CREATE TYPE "WhDieStatus" AS ENUM ('READY', 'IN_USE', 'CHECKING', 'REPAIRING', 'DEFECT', 'BROKEN', 'DISPOSED');

-- CreateEnum
CREATE TYPE "WhDieOwner" AS ENUM ('AU_VIET', 'CUSTOMER', 'PARTNER');

-- CreateEnum
CREATE TYPE "WhOrientation" AS ENUM ('PORTRAIT', 'LANDSCAPE');

-- CreateEnum
CREATE TYPE "WhDieAction" AS ENUM ('CREATE', 'ISSUE', 'KEEP', 'RETURN', 'PASS', 'DEFECT', 'SEND_REPAIR', 'BACK_REPAIR', 'DISPOSE', 'MOVE', 'EDIT', 'IMPORT');

-- CreateEnum
CREATE TYPE "WhBatchKind" AS ENUM ('OUT', 'IN');

-- CreateTable
CREATE TABLE "WhPartner" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "WhPartnerKind" NOT NULL,
    "phone" TEXT,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhLocation" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhMaterial" (
    "id" UUID NOT NULL,
    "group" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "hasSizes" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhStockItem" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "widthCm" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "lengthCm" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "minQty" DECIMAL(14,3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhStockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSlip" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "WhSlipKind" NOT NULL,
    "date" DATE NOT NULL,
    "partnerId" UUID,
    "receiver" TEXT,
    "purpose" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "countId" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedById" UUID,

    CONSTRAINT "WhSlip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhSlipLine" (
    "id" UUID NOT NULL,
    "slipId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "unitPriceVnd" BIGINT,

    CONSTRAINT "WhSlipLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhCount" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "WhCountStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "WhCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhCountLine" (
    "id" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "stockItemId" UUID NOT NULL,
    "systemQty" DECIMAL(14,3) NOT NULL,
    "countedQty" DECIMAL(14,3),

    CONSTRAINT "WhCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhMonthLock" (
    "month" TEXT NOT NULL,
    "lockedById" UUID NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhMonthLock_pkey" PRIMARY KEY ("month")
);

-- CreateTable
CREATE TABLE "WhDieSymbol" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lastNo" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "WhDieSymbol_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "WhDie" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "symbolCode" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "kind" "WhDieKind" NOT NULL DEFAULT 'CUT',
    "productName" TEXT NOT NULL,
    "customerName" TEXT,
    "lengthCm" DECIMAL(8,2),
    "widthCm" DECIMAL(8,2),
    "heightCm" DECIMAL(8,2),
    "sizeText" TEXT,
    "orientation" "WhOrientation",
    "pieces" INTEGER,
    "ups" INTEGER,
    "makerId" UUID,
    "owner" "WhDieOwner" NOT NULL DEFAULT 'AU_VIET',
    "status" "WhDieStatus" NOT NULL DEFAULT 'READY',
    "locationId" UUID,
    "holderId" UUID,
    "expectedBackOn" DATE,
    "costVnd" BIGINT,
    "photo" TEXT,
    "note" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewNote" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhDie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhDieMove" (
    "id" UUID NOT NULL,
    "dieId" UUID NOT NULL,
    "action" "WhDieAction" NOT NULL,
    "date" DATE NOT NULL,
    "fromStatus" "WhDieStatus",
    "toStatus" "WhDieStatus",
    "place" TEXT,
    "partnerId" UUID,
    "locationId" UUID,
    "reference" TEXT,
    "expectedBackOn" DATE,
    "note" TEXT,
    "batchId" UUID,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhDieMove_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhDieBatch" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "WhBatchKind" NOT NULL,
    "date" DATE NOT NULL,
    "partnerId" UUID NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhDieBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhDieCount" (
    "id" UUID NOT NULL,
    "locationId" UUID,
    "scope" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "WhDieCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhDieCountLine" (
    "id" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "dieId" UUID NOT NULL,
    "found" BOOLEAN NOT NULL DEFAULT false,
    "extra" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "WhDieCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhPartner_name_key" ON "WhPartner"("name");

-- CreateIndex
CREATE UNIQUE INDEX "WhLocation_code_key" ON "WhLocation"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WhMaterial_group_name_key" ON "WhMaterial"("group", "name");

-- CreateIndex
CREATE UNIQUE INDEX "WhStockItem_materialId_widthCm_lengthCm_key" ON "WhStockItem"("materialId", "widthCm", "lengthCm");

-- CreateIndex
CREATE UNIQUE INDEX "WhSlip_code_key" ON "WhSlip"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WhSlip_countId_key" ON "WhSlip"("countId");

-- CreateIndex
CREATE INDEX "WhSlip_date_idx" ON "WhSlip"("date");

-- CreateIndex
CREATE INDEX "WhSlipLine_stockItemId_idx" ON "WhSlipLine"("stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "WhCount_code_key" ON "WhCount"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WhCountLine_countId_stockItemId_key" ON "WhCountLine"("countId", "stockItemId");

-- CreateIndex
CREATE UNIQUE INDEX "WhDie_code_key" ON "WhDie"("code");

-- CreateIndex
CREATE INDEX "WhDie_status_idx" ON "WhDie"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WhDie_symbolCode_seq_key" ON "WhDie"("symbolCode", "seq");

-- CreateIndex
CREATE INDEX "WhDieMove_dieId_createdAt_idx" ON "WhDieMove"("dieId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhDieBatch_code_key" ON "WhDieBatch"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WhDieCountLine_countId_dieId_key" ON "WhDieCountLine"("countId", "dieId");

-- AddForeignKey
ALTER TABLE "WhStockItem" ADD CONSTRAINT "WhStockItem_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "WhMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSlip" ADD CONSTRAINT "WhSlip_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "WhPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSlip" ADD CONSTRAINT "WhSlip_countId_fkey" FOREIGN KEY ("countId") REFERENCES "WhCount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSlip" ADD CONSTRAINT "WhSlip_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSlip" ADD CONSTRAINT "WhSlip_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSlipLine" ADD CONSTRAINT "WhSlipLine_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "WhSlip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhSlipLine" ADD CONSTRAINT "WhSlipLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "WhStockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCount" ADD CONSTRAINT "WhCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCountLine" ADD CONSTRAINT "WhCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "WhCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhCountLine" ADD CONSTRAINT "WhCountLine_stockItemId_fkey" FOREIGN KEY ("stockItemId") REFERENCES "WhStockItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhMonthLock" ADD CONSTRAINT "WhMonthLock_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDie" ADD CONSTRAINT "WhDie_symbolCode_fkey" FOREIGN KEY ("symbolCode") REFERENCES "WhDieSymbol"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDie" ADD CONSTRAINT "WhDie_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "WhPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDie" ADD CONSTRAINT "WhDie_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "WhPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDie" ADD CONSTRAINT "WhDie_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WhLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieMove" ADD CONSTRAINT "WhDieMove_dieId_fkey" FOREIGN KEY ("dieId") REFERENCES "WhDie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieMove" ADD CONSTRAINT "WhDieMove_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "WhPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieMove" ADD CONSTRAINT "WhDieMove_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WhLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieMove" ADD CONSTRAINT "WhDieMove_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WhDieBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieMove" ADD CONSTRAINT "WhDieMove_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "WhPartner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieCount" ADD CONSTRAINT "WhDieCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "WhLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieCount" ADD CONSTRAINT "WhDieCount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieCountLine" ADD CONSTRAINT "WhDieCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "WhDieCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhDieCountLine" ADD CONSTRAINT "WhDieCountLine_dieId_fkey" FOREIGN KEY ("dieId") REFERENCES "WhDie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ký hiệu nhóm khuôn đang dùng trong bảng khuôn Excel (tên sửa được ở Kho → Danh mục)
INSERT INTO "WhDieSymbol" ("code", "name") VALUES
  ('TUI', 'Túi giấy'), ('KEF', 'Kẹp file'), ('HOP', 'Hộp'), ('TEM', 'Tem, tag'), ('LIX', 'Lì xì'),
  ('PBI', 'Phong bì'), ('CAT', 'Catalogue'), ('SAC', 'Sổ, sách'), ('TGA', 'Tờ gấp'), ('TOR', 'Tờ rơi'),
  ('LIC', 'Lịch'), ('BBI', 'Bao bì'), ('KHA', 'Khác'), ('POS', 'Poster'), ('TOG', 'TOG')
ON CONFLICT DO NOTHING;

-- Nhóm quyền mẫu cho thủ kho
INSERT INTO "Role" ("id", "name", "description", "permissions", "isSystem", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Thủ kho', 'Phân hệ Kho: phiếu nhập xuất giấy, vật tư, khuôn, kiểm kê. Không thấy giá tiền.',
       ARRAY['warehouse.view', 'warehouse.slip', 'warehouse.dies', 'warehouse.count'], false, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "Role" WHERE "name" = 'Thủ kho');
