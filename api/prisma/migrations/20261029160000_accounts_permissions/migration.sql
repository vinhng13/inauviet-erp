-- Accounts with username + password, permission groups ("Nhóm quyền") and login sessions.
-- Existing data is kept:
--   OWNER accounts → built-in group "Quản trị viên" (all permissions)
--   STAFF accounts → group "Nhân viên" (same rights as before)
--   username = the part of the email before "@"; no password yet.
-- `npm run db:seed` then gives the first admin account a password.

-- 1. Keep the old role in a temporary column: the enum type "Role" must go before a table "Role" can exist.
ALTER TABLE "User" ADD COLUMN "legacyRole" TEXT;
UPDATE "User" SET "legacyRole" = "role"::TEXT;
ALTER TABLE "User" DROP COLUMN "role";

-- DropEnum
DROP TYPE "Role";

-- CreateTable
CREATE TABLE "Role" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- 2. Built-in groups
INSERT INTO "Role" ("id", "name", "description", "permissions", "isSystem", "updatedAt") VALUES
  (gen_random_uuid(), 'Quản trị viên', 'Toàn quyền, kể cả tài khoản và nhóm quyền. Không sửa hoặc xoá được.', ARRAY[]::TEXT[], true, CURRENT_TIMESTAMP),
  (gen_random_uuid(), 'Nhân viên', 'Làm mọi việc với đơn, chuyến giao, khách hàng; không huỷ khoản thu, không mở lại chuyến, không quản lý tài khoản.',
   ARRAY['orders.view', 'orders.create', 'orders.update', 'orders.cancel',
         'deliveries.view', 'deliveries.create', 'deliveries.update', 'deliveries.deliver', 'deliveries.cancel',
         'payments.view', 'payments.create', 'money.view',
         'customers.view', 'customers.create', 'customers.update']::TEXT[], false, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "passwordHash" TEXT,
ADD COLUMN     "roleId" UUID,
ADD COLUMN     "username" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- 3. Move existing accounts into groups and give them usernames
UPDATE "User" u SET "roleId" = r."id"
FROM "Role" r
WHERE r."name" = CASE WHEN u."legacyRole" = 'OWNER' THEN 'Quản trị viên' ELSE 'Nhân viên' END;

WITH base AS (
  SELECT "id", "createdAt",
         COALESCE(NULLIF(regexp_replace(lower(split_part(COALESCE("email", ''), '@', 1)), '[^a-z0-9._-]', '', 'g'), ''), 'user') AS b
  FROM "User"
), numbered AS (
  SELECT "id", b, row_number() OVER (PARTITION BY b ORDER BY "createdAt", "id") AS n FROM base
)
UPDATE "User" u SET "username" = CASE WHEN numbered.n = 1 THEN numbered.b ELSE numbered.b || numbered.n END
FROM numbered
WHERE numbered."id" = u."id";

ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL,
ALTER COLUMN "username" SET NOT NULL,
DROP COLUMN "legacyRole";

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
