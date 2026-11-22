-- Quy trình khuôn mới: chuyển khuôn có hiệu lực ngay (không chờ thủ kho xác nhận), khuôn mới nằm ở nơi làm khuôn
-- ("Đang làm") cho tới khi được chuyển đi; không còn hạn trả.
ALTER TYPE "WhDieStatus" ADD VALUE IF NOT EXISTS 'MAKING';
ALTER TYPE "WhDieAction" ADD VALUE IF NOT EXISTS 'TRANSFER';

-- Ở xưởng chỉ còn một trạng thái "Ở xưởng" (IN_USE): khuôn xưởng đang giữ (READY) gộp vào
UPDATE "WhDie" SET "status" = 'IN_USE' WHERE "holderId" IS NOT NULL AND "status" = 'READY';
-- Không còn hạn trả / nhắc quá hạn
UPDATE "WhDie" SET "expectedBackOn" = NULL WHERE "expectedBackOn" IS NOT NULL;
