-- Kho động: danh mục kho, kho – vật tư, quy cách, đơn vị tính, tồn theo kho, thủ kho xác nhận phiếu,
-- phiếu chuyển kho, bản chụp tồn cuối ngày. Dữ liệu cũ (vật tư, phiếu, kiểm kê, chốt tháng) chuyển vào "Kho giấy".

CREATE TYPE "WhWarehouseKind" AS ENUM ('STOCK', 'DIE');
CREATE TYPE "WhSlipStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');
ALTER TYPE "WhSlipKind" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "WhSlipKind" ADD VALUE 'TRANSFER_IN';

-- Kho
CREATE TABLE "WhWarehouse" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "kind" "WhWarehouseKind" NOT NULL DEFAULT 'STOCK',
    "note" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhWarehouse_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhWarehouse_code_key" ON "WhWarehouse"("code");

INSERT INTO "WhWarehouse" ("id", "code", "name", "kind", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid(), 'GIAY', 'Kho giấy', 'STOCK', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'BAT', 'Kho vật tư xưởng bạt', 'STOCK', 20, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'OFFSET', 'Kho tồn offset', 'STOCK', 30, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'KHUON', 'Kho khuôn', 'DIE', 40, CURRENT_TIMESTAMP);

CREATE TABLE "WhWarehouseMember" (
    "warehouseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    CONSTRAINT "WhWarehouseMember_pkey" PRIMARY KEY ("warehouseId","userId")
);
CREATE TABLE "WhWarehouseMaterial" (
    "warehouseId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    CONSTRAINT "WhWarehouseMaterial_pkey" PRIMARY KEY ("warehouseId","materialId")
);

-- Vật tư: mã (không bắt buộc)
ALTER TABLE "WhMaterial" ADD COLUMN "code" TEXT;
CREATE UNIQUE INDEX "WhMaterial_code_key" ON "WhMaterial"("code");

-- Khổ cũ trở thành quy cách; tồn chuyển sang bảng tồn theo kho
ALTER TABLE "WhStockItem" RENAME TO "WhSpec";
ALTER TABLE "WhSpec" RENAME CONSTRAINT "WhStockItem_pkey" TO "WhSpec_pkey";
ALTER TABLE "WhSpec" RENAME CONSTRAINT "WhStockItem_materialId_fkey" TO "WhSpec_materialId_fkey";
ALTER INDEX "WhStockItem_materialId_widthCm_lengthCm_key" RENAME TO "WhSpec_materialId_widthCm_lengthCm_key";

CREATE TABLE "WhStock" (
    "id" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "specId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "minQty" DECIMAL(14,3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhStock_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhStock_warehouseId_specId_key" ON "WhStock"("warehouseId", "specId");

INSERT INTO "WhStock" ("id", "warehouseId", "specId", "qty", "minQty", "isActive", "createdAt")
SELECT gen_random_uuid(), w."id", s."id", s."qty", s."minQty", s."isActive", s."createdAt"
FROM "WhSpec" s CROSS JOIN (SELECT "id" FROM "WhWarehouse" WHERE "code" = 'GIAY') w;

INSERT INTO "WhWarehouseMaterial" ("warehouseId", "materialId")
SELECT w."id", m."id" FROM "WhMaterial" m CROSS JOIN (SELECT "id" FROM "WhWarehouse" WHERE "code" = 'GIAY') w;

ALTER TABLE "WhSpec" DROP COLUMN "qty", DROP COLUMN "minQty";

-- Đơn vị tính (hệ số theo vật tư, hoặc riêng cho một quy cách)
CREATE TABLE "WhUnit" (
    "id" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "specId" UUID,
    "name" TEXT NOT NULL,
    "factor" DECIMAL(14,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhUnit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WhUnit_materialId_idx" ON "WhUnit"("materialId");

-- Bản chụp tồn cuối ngày
CREATE TABLE "WhDailyStock" (
    "date" DATE NOT NULL,
    "warehouseId" UUID NOT NULL,
    "specId" UUID NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "takenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhDailyStock_pkey" PRIMARY KEY ("date","warehouseId","specId")
);
CREATE INDEX "WhDailyStock_warehouseId_date_idx" ON "WhDailyStock"("warehouseId", "date");

-- Phiếu: thuộc một kho, có trạng thái xác nhận; phiếu cũ coi như đã xác nhận
ALTER TABLE "WhSlip"
  ADD COLUMN "warehouseId" UUID,
  ADD COLUMN "transferId" UUID,
  ADD COLUMN "status" "WhSlipStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "confirmedById" UUID,
  ADD COLUMN "rejectReason" TEXT;
UPDATE "WhSlip" SET "warehouseId" = (SELECT "id" FROM "WhWarehouse" WHERE "code" = 'GIAY'),
  "status" = 'CONFIRMED', "confirmedAt" = "createdAt", "confirmedById" = "createdById";
ALTER TABLE "WhSlip" ALTER COLUMN "warehouseId" SET NOT NULL;
DROP INDEX IF EXISTS "WhSlip_date_idx";
CREATE INDEX "WhSlip_warehouseId_date_idx" ON "WhSlip"("warehouseId", "date");
CREATE INDEX "WhSlip_transferId_idx" ON "WhSlip"("transferId");
CREATE INDEX "WhSlip_status_idx" ON "WhSlip"("status");

ALTER TABLE "WhSlipLine" RENAME COLUMN "stockItemId" TO "specId";
ALTER TABLE "WhSlipLine" DROP CONSTRAINT "WhSlipLine_stockItemId_fkey";
ALTER INDEX "WhSlipLine_stockItemId_idx" RENAME TO "WhSlipLine_specId_idx";
ALTER TABLE "WhSlipLine" ADD COLUMN "unitName" TEXT, ADD COLUMN "unitQty" DECIMAL(14,3), ADD COLUMN "factor" DECIMAL(14,4);

-- Kiểm kê thuộc một kho
ALTER TABLE "WhCount" ADD COLUMN "warehouseId" UUID;
UPDATE "WhCount" SET "warehouseId" = (SELECT "id" FROM "WhWarehouse" WHERE "code" = 'GIAY');
ALTER TABLE "WhCount" ALTER COLUMN "warehouseId" SET NOT NULL;
ALTER TABLE "WhCountLine" RENAME COLUMN "stockItemId" TO "specId";
ALTER TABLE "WhCountLine" DROP CONSTRAINT "WhCountLine_stockItemId_fkey";
ALTER INDEX "WhCountLine_countId_stockItemId_key" RENAME TO "WhCountLine_countId_specId_key";

-- Chốt tháng theo kho
ALTER TABLE "WhMonthLock" ADD COLUMN "warehouseId" UUID;
UPDATE "WhMonthLock" SET "warehouseId" = (SELECT "id" FROM "WhWarehouse" WHERE "code" = 'GIAY');
ALTER TABLE "WhMonthLock" ALTER COLUMN "warehouseId" SET NOT NULL;
ALTER TABLE "WhMonthLock" DROP CONSTRAINT "WhMonthLock_pkey", ADD CONSTRAINT "WhMonthLock_pkey" PRIMARY KEY ("warehouseId", "month");

-- Khoá ngoại
ALTER TABLE "WhUnit" ADD CONSTRAINT "WhUnit_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "WhMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhUnit" ADD CONSTRAINT "WhUnit_specId_fkey" FOREIGN KEY ("specId") REFERENCES "WhSpec"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhWarehouseMember" ADD CONSTRAINT "WhWarehouseMember_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhWarehouseMember" ADD CONSTRAINT "WhWarehouseMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhWarehouseMaterial" ADD CONSTRAINT "WhWarehouseMaterial_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhWarehouseMaterial" ADD CONSTRAINT "WhWarehouseMaterial_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "WhMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhStock" ADD CONSTRAINT "WhStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhStock" ADD CONSTRAINT "WhStock_specId_fkey" FOREIGN KEY ("specId") REFERENCES "WhSpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhDailyStock" ADD CONSTRAINT "WhDailyStock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhDailyStock" ADD CONSTRAINT "WhDailyStock_specId_fkey" FOREIGN KEY ("specId") REFERENCES "WhSpec"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhSlip" ADD CONSTRAINT "WhSlip_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhSlip" ADD CONSTRAINT "WhSlip_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhSlipLine" ADD CONSTRAINT "WhSlipLine_specId_fkey" FOREIGN KEY ("specId") REFERENCES "WhSpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhCount" ADD CONSTRAINT "WhCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhCountLine" ADD CONSTRAINT "WhCountLine_specId_fkey" FOREIGN KEY ("specId") REFERENCES "WhSpec"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhMonthLock" ADD CONSTRAINT "WhMonthLock_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;
