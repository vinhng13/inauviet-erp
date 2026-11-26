-- v0.17.2: một danh sách Kho chung. Đối tác (xưởng bế, nơi làm khuôn…) thành kho "Kho ngoài";
-- bỏ thủ kho (phiếu vật tư có hiệu lực ngay); nơi lấy hàng của phiếu nhập thành chữ ghi thêm.

CREATE TYPE "WhOwnership" AS ENUM ('AU_VIET', 'EXTERNAL');
ALTER TABLE "WhWarehouse" ADD COLUMN "ownership" "WhOwnership" NOT NULL DEFAULT 'AU_VIET', ADD COLUMN "phone" TEXT;

-- Phiếu nhập: nơi lấy hàng giữ dạng chữ
ALTER TABLE "WhSlip" ADD COLUMN "supplierName" TEXT;
UPDATE "WhSlip" s SET "supplierName" = p."name" FROM "WhPartner" p WHERE p."id" = s."partnerId";

-- Đối tác nào thành kho: mọi đối tác có dính tới khuôn, hoặc loại xưởng bế / nơi làm khuôn / khác.
-- Đối tác chỉ làm nơi lấy hàng (nhà cung cấp) không thành kho.
CREATE TEMP TABLE pmap (pid UUID PRIMARY KEY, wid UUID);
INSERT INTO pmap (pid)
SELECT p."id" FROM "WhPartner" p
WHERE p."kind" <> 'SUPPLIER'
   OR EXISTS (SELECT 1 FROM "WhDie" d WHERE d."makerId" = p."id" OR d."holderId" = p."id")
   OR EXISTS (SELECT 1 FROM "WhDieMove" x WHERE x."partnerId" = p."id")
   OR EXISTS (SELECT 1 FROM "WhDieBatch" b WHERE p."id" IN (b."partnerId", b."fromPartnerId", b."toPartnerId"));

-- Trùng tên với một kho đã có thì gộp vào kho đó
UPDATE pmap m SET "wid" = w."id"
FROM "WhPartner" p, "WhWarehouse" w
WHERE p."id" = m."pid" AND lower(btrim(w."name")) = lower(btrim(p."name"));

-- Còn lại: tạo kho ngoài, mã sinh từ tên (bỏ dấu, chữ hoa, tối đa 16 ký tự, trùng thì thêm số)
DO $$
DECLARE r RECORD; base TEXT; c TEXT; i INT; nid UUID;
BEGIN
  FOR r IN SELECT m."pid", p."name", p."phone", p."note", p."isActive" FROM pmap m JOIN "WhPartner" p ON p."id" = m."pid" WHERE m."wid" IS NULL ORDER BY p."name" LOOP
    base := upper(regexp_replace(translate(r."name", 'àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬÈÉẺẼẸÊỀẾỂỄỆÌÍỈĨỊÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢÙÚỦŨỤƯỪỨỬỮỰỲÝỶỸỴĐ', 'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyydAAAAAAAAAAAAAAAAAEEEEEEEEEEEIIIIIOOOOOOOOOOOOOOOOOUUUUUUUUUUUYYYYYD'), '[^A-Za-z0-9]', '', 'g'));
    base := left(COALESCE(NULLIF(base, ''), 'KHONGOAI'), 16);
    c := base; i := 1;
    WHILE EXISTS (SELECT 1 FROM "WhWarehouse" WHERE "code" = c) LOOP
      i := i + 1; c := left(base, 14) || i;
    END LOOP;
    nid := gen_random_uuid();
    INSERT INTO "WhWarehouse" ("id", "code", "name", "ownership", "phone", "note", "isActive", "sortOrder", "createdAt", "updatedAt")
    VALUES (nid, c, r."name", 'EXTERNAL', r."phone", r."note", r."isActive", 100, now(), now());
    UPDATE pmap SET "wid" = nid WHERE "pid" = r."pid";
  END LOOP;
END $$;

-- Khuôn: nơi làm khuôn trỏ sang kho; khuôn đang ở đối tác thì ở kho ngoài tương ứng (không còn kệ)
ALTER TABLE "WhDie" DROP CONSTRAINT "WhDie_makerId_fkey";
UPDATE "WhDie" d SET "makerId" = m."wid" FROM pmap m WHERE m."pid" = d."makerId";
UPDATE "WhDie" SET "makerId" = NULL WHERE "makerId" IS NOT NULL AND "makerId" NOT IN (SELECT "id" FROM "WhWarehouse");
ALTER TABLE "WhDie" ADD CONSTRAINT "WhDie_makerId_fkey" FOREIGN KEY ("makerId") REFERENCES "WhWarehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "WhDie" d SET "warehouseId" = m."wid", "locationId" = NULL FROM pmap m WHERE m."pid" = d."holderId";
ALTER TABLE "WhDie" DROP CONSTRAINT "WhDie_holderId_fkey";
ALTER TABLE "WhDie" DROP COLUMN "holderId";

-- Lịch sử khuôn: đối tác → kho
ALTER TABLE "WhDieMove" DROP CONSTRAINT "WhDieMove_partnerId_fkey";
UPDATE "WhDieMove" x SET "partnerId" = m."wid" FROM pmap m WHERE m."pid" = x."partnerId";
UPDATE "WhDieMove" SET "partnerId" = NULL WHERE "partnerId" IS NOT NULL AND "partnerId" NOT IN (SELECT "id" FROM "WhWarehouse");
ALTER TABLE "WhDieMove" RENAME COLUMN "partnerId" TO "warehouseId";
ALTER TABLE "WhDieMove" ADD CONSTRAINT "WhDieMove_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "WhWarehouse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phiếu chuyển khuôn: nơi đi / nơi đến chỉ còn kho
UPDATE "WhDieBatch" b SET "fromWarehouseId" = m."wid" FROM pmap m WHERE m."pid" = b."fromPartnerId" AND b."fromWarehouseId" IS NULL;
UPDATE "WhDieBatch" b SET "toWarehouseId" = m."wid" FROM pmap m WHERE m."pid" = b."toPartnerId" AND b."toWarehouseId" IS NULL;
UPDATE "WhDieBatch" b SET "toWarehouseId" = m."wid" FROM pmap m WHERE m."pid" = b."partnerId" AND b."kind" = 'OUT' AND b."toWarehouseId" IS NULL;
UPDATE "WhDieBatch" b SET "fromWarehouseId" = m."wid" FROM pmap m WHERE m."pid" = b."partnerId" AND b."kind" = 'IN' AND b."fromWarehouseId" IS NULL;
ALTER TABLE "WhDieBatch" DROP CONSTRAINT "WhDieBatch_partnerId_fkey";
ALTER TABLE "WhDieBatch" DROP CONSTRAINT "WhDieBatch_fromPartnerId_fkey";
ALTER TABLE "WhDieBatch" DROP CONSTRAINT "WhDieBatch_toPartnerId_fkey";
ALTER TABLE "WhDieBatch" DROP COLUMN "partnerId", DROP COLUMN "fromPartnerId", DROP COLUMN "toPartnerId";

-- Phiếu kho: bỏ liên kết đối tác
ALTER TABLE "WhSlip" DROP CONSTRAINT "WhSlip_partnerId_fkey";
ALTER TABLE "WhSlip" DROP COLUMN "partnerId";

-- Bỏ thủ kho và danh mục đối tác
DROP TABLE "WhWarehouseMember";
DROP TABLE "WhPartner";
DROP TYPE "WhPartnerKind";
