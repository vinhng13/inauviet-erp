-- CreateEnum
CREATE TYPE "ProductionStage" AS ENUM ('RECEIVED', 'PRINTING', 'FINISHING', 'QC', 'DONE');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "DesignFeedback" AS ENUM ('PENDING', 'CHANGES_REQUESTED', 'APPROVED');

-- AlterEnum


ALTER TYPE "OrderStatus" ADD VALUE 'DESIGNING' BEFORE 'IN_PRODUCTION';
ALTER TYPE "OrderStatus" ADD VALUE 'DESIGN_FINALIZING' BEFORE 'IN_PRODUCTION';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "acceptanceNote" TEXT,
ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedByName" TEXT,
ADD COLUMN     "approvalChannel" TEXT,
ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "approvedVersion" INTEGER,
ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "designApprovedAt" TIMESTAMP(3),
ADD COLUMN     "designFinalizedAt" TIMESTAMP(3),
ADD COLUMN     "designLockedAt" TIMESTAMP(3),
ADD COLUMN     "designerId" UUID,
ADD COLUMN     "needsDesign" BOOLEAN,
ADD COLUMN     "productionCode" TEXT,
ADD COLUMN     "productionDoneAt" TIMESTAMP(3),
ADD COLUMN     "productionDueDate" DATE,
ADD COLUMN     "productionNote" TEXT,
ADD COLUMN     "productionPriority" "Priority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "productionStage" "ProductionStage";

-- CreateTable
CREATE TABLE "DesignVersion" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "feedback" "DesignFeedback" NOT NULL DEFAULT 'PENDING',
    "feedbackAt" TIMESTAMP(3),
    "feedbackNote" TEXT,
    "createdById" UUID NOT NULL,

    CONSTRAINT "DesignVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DesignVersion_orderId_version_key" ON "DesignVersion"("orderId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Order_productionCode_key" ON "Order"("productionCode");

-- CreateIndex
CREATE INDEX "Order_designerId_idx" ON "Order"("designerId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_designerId_fkey" FOREIGN KEY ("designerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignVersion" ADD CONSTRAINT "DesignVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DesignVersion" ADD CONSTRAINT "DesignVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Data: orders created before the 6-step process.
-- Every existing order is already agreed with the customer (step 2).
UPDATE "Order" SET "confirmedAt" = "createdAt";
-- Orders already in the workshop or further: no design step recorded, production stage known from the status.
UPDATE "Order" SET "needsDesign" = false, "productionStage" = 'RECEIVED', "productionDueDate" = "dueDate" WHERE "productionStartedAt" IS NOT NULL;
UPDATE "Order" SET "productionStage" = 'DONE', "productionDoneAt" = COALESCE("productionStartedAt", "createdAt")
WHERE "status" IN ('DELIVERING', 'COMPLETED');
-- Completed orders were completed by delivery; treat that as the acceptance.
UPDATE "Order" SET "acceptedAt" = "completedAt", "acceptanceNote" = 'Hoàn thành trước khi có biên bản nghiệm thu'
WHERE "status" = 'COMPLETED' AND "completedAt" IS NOT NULL;

-- Data: permissions for the new steps.
-- Groups that create orders follow design and production and can record the signed acceptance report.
UPDATE "Role"
SET "permissions" = ARRAY(
  SELECT DISTINCT p FROM unnest("permissions" || ARRAY['design.view', 'design.assign', 'production.view', 'deliveries.accept']::text[]) AS p
)
WHERE NOT "isSystem" AND 'orders.create' = ANY("permissions");
-- Groups that confirm deliveries also bring back the signed acceptance report.
UPDATE "Role"
SET "permissions" = ARRAY(SELECT DISTINCT p FROM unnest("permissions" || ARRAY['deliveries.accept']::text[]) AS p)
WHERE NOT "isSystem" AND 'deliveries.deliver' = ANY("permissions");
-- Groups that could start production (orders.update) keep seeing the workshop.
UPDATE "Role"
SET "permissions" = ARRAY(SELECT DISTINCT p FROM unnest("permissions" || ARRAY['production.view']::text[]) AS p)
WHERE NOT "isSystem" AND 'orders.update' = ANY("permissions");

-- New starting groups for designers and the workshop.
INSERT INTO "Role" ("id", "name", "description", "permissions", "updatedAt") VALUES
  (gen_random_uuid(), 'Thiết kế', 'Nhận đơn cần thiết kế, gửi maket, ghi phản hồi của khách, chốt thiết kế. Không thấy giá tiền.',
   ARRAY['orders.view', 'design.view', 'design.work'], CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Sản xuất', 'Xem lệnh sản xuất, chuyển công đoạn in, gia công, kiểm tra. Không thấy giá tiền.',
   ARRAY['orders.view', 'production.view', 'production.update'], CURRENT_TIMESTAMP)
ON CONFLICT ("name") DO NOTHING;
