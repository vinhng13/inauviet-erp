-- Khuôn: nhiều kho khuôn (Kho khuôn Âu Việt, Kho Xuân Đỉnh), phiếu giao nhận có thủ kho xác nhận xuất / nhận

-- Enums
ALTER TYPE "WhDieStatus" ADD VALUE 'TRANSIT';
ALTER TYPE "WhDieStatus" ADD VALUE 'INCOMING';
ALTER TYPE "WhDieAction" ADD VALUE 'REQUEST';
ALTER TYPE "WhDieAction" ADD VALUE 'SEND';
ALTER TYPE "WhDieAction" ADD VALUE 'RECEIVE';
ALTER TYPE "WhDieAction" ADD VALUE 'REJECT';
ALTER TYPE "WhDieAction" ADD VALUE 'REUSE';
ALTER TYPE "WhDieAction" ADD VALUE 'COUNT';
CREATE TYPE "WhDieBatchStatus" AS ENUM ('OPEN', 'DONE', 'REJECTED', 'CANCELLED');
CREATE TYPE "WhConfirmState" AS ENUM ('PENDING', 'OK', 'NONE');

-- Kho
UPDATE "WhWarehouse" SET "name" = 'Kho khuôn Âu Việt' WHERE "code" = 'KHUON' AND "name" = 'Kho khuôn';
INSERT INTO "WhWarehouse" ("id", "code", "name", "kind", "sortOrder", "updatedAt")
VALUES (gen_random_uuid(), 'XUANDINH', 'Kho Xuân Đỉnh', 'DIE', 45, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

-- Xưởng bế
INSERT INTO "WhPartner" ("id", "name", "kind", "updatedAt")
SELECT gen_random_uuid(), v.name, 'DIE_SHOP', CURRENT_TIMESTAMP
FROM (VALUES ('A.Kiên Trương Định'), ('Em Hòa'), ('Khoa Nhật Minh'), ('Mê Linh')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM "WhPartner" p WHERE lower(p."name") = lower(v.name));

-- Kệ thuộc một kho
ALTER TABLE "WhLocation" ADD COLUMN "warehouseId" UUID;
UPDATE "WhLocation" SET "warehouseId" = (SELECT "id" FROM "WhWarehouse" WHERE "code" = 'KHUON');
ALTER TABLE "WhLocation" ALTER COLUMN "warehouseId" SET NOT NULL;
DROP INDEX "WhLocation_code_key";
CREATE UNIQUE INDEX "WhLocation_warehouseId_code_key" ON "WhLocation"("warehouseId", "code");
ALTER TABLE "WhLocation" ADD CONSTRAINT "WhLocation_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lịch sử: nơi trước thao tác
ALTER TABLE "WhDieMove" ADD COLUMN "fromPlace" TEXT;

-- Khuôn thuộc một kho
ALTER TABLE "WhDie" ADD COLUMN "warehouseId" UUID, ADD COLUMN "pendingBatchId" UUID;
UPDATE "WhDie" SET "warehouseId" = (SELECT "id" FROM "WhWarehouse" WHERE "code" = 'KHUON');

-- Xuân Đỉnh trước đây là một "xưởng"; nay là kho của Âu Việt: khuôn ở đó về Kho Xuân Đỉnh
INSERT INTO "WhDieMove" ("id", "dieId", "action", "date", "fromStatus", "toStatus", "fromPlace", "place", "note", "createdAt")
SELECT gen_random_uuid(), d."id", 'MOVE', CURRENT_DATE, d."status", CASE WHEN d."status" = 'IN_USE' THEN 'READY'::"WhDieStatus" ELSE d."status" END,
       p."name", 'Kho Xuân Đỉnh', 'Xuân Đỉnh chuyển thành kho của Âu Việt', CURRENT_TIMESTAMP
FROM "WhDie" d JOIN "WhPartner" p ON p."id" = d."holderId"
WHERE lower(p."name") = lower('Xuân Đỉnh');
UPDATE "WhDie" d SET
  "warehouseId" = (SELECT "id" FROM "WhWarehouse" WHERE "code" = 'XUANDINH'),
  "holderId" = NULL, "locationId" = NULL, "expectedBackOn" = NULL,
  "status" = CASE WHEN d."status" = 'IN_USE' THEN 'READY'::"WhDieStatus" ELSE d."status" END
FROM "WhPartner" p
WHERE p."id" = d."holderId" AND lower(p."name") = lower('Xuân Đỉnh');
UPDATE "WhPartner" SET "isActive" = false WHERE lower("name") = lower('Xuân Đỉnh');

ALTER TABLE "WhDie" ALTER COLUMN "warehouseId" SET NOT NULL;
CREATE INDEX "WhDie_warehouseId_idx" ON "WhDie"("warehouseId");
ALTER TABLE "WhDie" ADD CONSTRAINT "WhDie_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phiếu giao nhận: từ / đến, trạng thái xác nhận
ALTER TABLE "WhDieBatch"
  ALTER COLUMN "kind" DROP NOT NULL,
  ALTER COLUMN "partnerId" DROP NOT NULL,
  ADD COLUMN "fromWarehouseId" UUID,
  ADD COLUMN "fromPartnerId" UUID,
  ADD COLUMN "toWarehouseId" UUID,
  ADD COLUMN "toPartnerId" UUID,
  ADD COLUMN "toLocationId" UUID,
  ADD COLUMN "controlWarehouseId" UUID,
  ADD COLUMN "status" "WhDieBatchStatus" NOT NULL DEFAULT 'DONE',
  ADD COLUMN "outState" "WhConfirmState" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "inState" "WhConfirmState" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "outById" UUID,
  ADD COLUMN "outAt" TIMESTAMP(3),
  ADD COLUMN "inById" UUID,
  ADD COLUMN "inAt" TIMESTAMP(3),
  ADD COLUMN "isNew" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "expectedBackOn" DATE,
  ADD COLUMN "rejectReason" TEXT;
UPDATE "WhDieBatch" SET "fromWarehouseId" = (SELECT "id" FROM "WhWarehouse" WHERE "code" = 'KHUON'), "toPartnerId" = "partnerId" WHERE "kind" = 'OUT';
UPDATE "WhDieBatch" SET "fromPartnerId" = "partnerId", "toWarehouseId" = (SELECT "id" FROM "WhWarehouse" WHERE "code" = 'KHUON') WHERE "kind" = 'IN';
ALTER TABLE "WhDieBatch" ALTER COLUMN "status" SET DEFAULT 'OPEN';
CREATE INDEX "WhDieBatch_status_idx" ON "WhDieBatch"("status");
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_fromWarehouseId_fkey" FOREIGN KEY ("fromWarehouseId") REFERENCES "WhWarehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_fromPartnerId_fkey" FOREIGN KEY ("fromPartnerId") REFERENCES "WhPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_toWarehouseId_fkey" FOREIGN KEY ("toWarehouseId") REFERENCES "WhWarehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_toPartnerId_fkey" FOREIGN KEY ("toPartnerId") REFERENCES "WhPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "WhLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_controlWarehouseId_fkey" FOREIGN KEY ("controlWarehouseId") REFERENCES "WhWarehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_outById_fkey" FOREIGN KEY ("outById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_inById_fkey" FOREIGN KEY ("inById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WhDieBatch" DROP CONSTRAINT "WhDieBatch_partnerId_fkey";
ALTER TABLE "WhDieBatch" ADD CONSTRAINT "WhDieBatch_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "WhPartner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhDie" ADD CONSTRAINT "WhDie_pendingBatchId_fkey" FOREIGN KEY ("pendingBatchId") REFERENCES "WhDieBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WhDieBatchItem" (
  "id" UUID NOT NULL,
  "batchId" UUID NOT NULL,
  "dieId" UUID NOT NULL,
  CONSTRAINT "WhDieBatchItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhDieBatchItem_batchId_dieId_key" ON "WhDieBatchItem"("batchId", "dieId");
ALTER TABLE "WhDieBatchItem" ADD CONSTRAINT "WhDieBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WhDieBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhDieBatchItem" ADD CONSTRAINT "WhDieBatchItem_dieId_fkey" FOREIGN KEY ("dieId") REFERENCES "WhDie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
INSERT INTO "WhDieBatchItem" ("id", "batchId", "dieId")
SELECT gen_random_uuid(), s."batchId", s."dieId" FROM (SELECT DISTINCT "batchId", "dieId" FROM "WhDieMove" WHERE "batchId" IS NOT NULL) s;

-- Kiểm kê khuôn theo kho
ALTER TABLE "WhDieCount" ADD COLUMN "warehouseId" UUID;
ALTER TABLE "WhDieCount" ADD CONSTRAINT "WhDieCount_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
