/**
 * npm run db:seed
 * Creates the default permission groups, makes sure an administrator can sign in, and, when
 * SEED_SAMPLE_DATA=true and the database has no orders yet, the sample customer and order (DH example).
 * Safe to run more than once.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { DeliveryStatus, OrderStatus, PaymentMethod, PricingMode, ProductionStage } from '../src/generated/prisma/enums';
import { DEFAULT_ROLES } from '../src/access/permissions';
import { generateTemporaryPassword, hashPassword } from '../src/auth/password';
import { periodInZone, todayInZone, addDays, parseDateOnly } from '../src/common/utils/dates';
import { toSearchText } from '../src/common/utils/vn-text';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const tz = process.env.APP_TIMEZONE ?? 'Asia/Ho_Chi_Minh';

async function nextCode(prefix: 'KH' | 'DH' | 'LSX' | 'GH'): Promise<string> {
  const period = prefix === 'KH' ? '' : periodInZone(tz);
  const rows = await prisma.$queryRaw<Array<{ lastNo: number }>>`
    INSERT INTO "DocumentSequence" ("prefix", "period", "lastNo") VALUES (${prefix}, ${period}, 1)
    ON CONFLICT ("prefix", "period") DO UPDATE SET "lastNo" = "DocumentSequence"."lastNo" + 1
    RETURNING "lastNo"`;
  const no = String(rows[0].lastNo).padStart(4, '0');
  return period ? `${prefix}-${period}-${no}` : `${prefix}-${no}`;
}

/**
 * Make sure someone can sign in as administrator:
 *  - if an active administrator already has a password, do nothing;
 *  - otherwise give the first administrator (or a new account SEED_ADMIN_USERNAME) the password
 *    SEED_ADMIN_PASSWORD, or a generated one, and print it. It must be changed at first sign-in.
 */
async function ensureAdmin(): Promise<{ id: string }> {
  const adminRole = await prisma.role.findFirstOrThrow({ where: { isSystem: true } });
  const ready = await prisma.user.findFirst({ where: { roleId: adminRole.id, isActive: true, passwordHash: { not: null } }, orderBy: { createdAt: 'asc' } });
  if (ready) {
    console.log(`Admin account: ${ready.username} (already has a password)`);
    return ready;
  }
  const username = (process.env.SEED_ADMIN_USERNAME ?? 'admin').trim().toLowerCase();
  const given = process.env.SEED_ADMIN_PASSWORD?.trim();
  const password = given || generateTemporaryPassword();
  const existing =
    (await prisma.user.findFirst({ where: { roleId: adminRole.id }, orderBy: { createdAt: 'asc' } })) ??
    (await prisma.user.findUnique({ where: { username } }));
  const data = { roleId: adminRole.id, isActive: true, passwordHash: await hashPassword(password), mustChangePassword: true };
  const admin = existing
    ? await prisma.user.update({ where: { id: existing.id }, data })
    : await prisma.user.create({ data: { ...data, username, fullName: process.env.SEED_ADMIN_NAME ?? 'Quản trị viên' } });
  console.log('');
  console.log('  Admin account ready');
  console.log(`    username : ${admin.username}`);
  console.log(`    password : ${given ? '(SEED_ADMIN_PASSWORD from .env)' : password}`);
  console.log('    You will be asked to choose a new password at first sign-in.');
  console.log('');
  return admin;
}

async function main(): Promise<void> {
  for (const r of DEFAULT_ROLES) {
    const exists = await prisma.role.findUnique({ where: { name: r.name } });
    if (!exists) {
      await prisma.role.create({ data: { name: r.name, description: r.description, permissions: r.permissions } });
      console.log(`Permission group created: ${r.name}`);
    }
  }
  const owner = await ensureAdmin();

  // Starter catalog with sample prices (edit them on the "Sản phẩm" screen)
  if (process.env.SEED_SAMPLE_DATA !== 'false' && (await prisma.product.count()) === 0) {
    const area = PricingMode.AREA;
    const unit = PricingMode.UNIT;
    const products: Array<[string, string, PricingMode, string, number]> = [
      ['Decal PP in UV', 'Decal', area, 'm²', 180_000],
      ['Decal sữa cán mờ', 'Decal', area, 'm²', 150_000],
      ['Bạt Hiflex in khổ lớn', 'Bạt', area, 'm²', 65_000],
      ['Bạt xuyên sáng', 'Bạt', area, 'm²', 95_000],
      ['Biển alu chữ nổi mica', 'Biển & hộp đèn', area, 'm²', 1_200_000],
      ['Hộp đèn mica hút nổi', 'Biển & hộp đèn', area, 'm²', 2_200_000],
      ['Standee chữ X 60×160', 'Standee', unit, 'bộ', 250_000],
      ['Standee cuốn 80×200', 'Standee', unit, 'bộ', 550_000],
      ['Card visit C300 cán mờ', 'Ấn phẩm', unit, 'hộp', 60_000],
    ];
    await prisma.product.createMany({
      data: products.map(([name, category, pricingMode, u, price], i) => ({ name, category, pricingMode, unit: u, unitPriceVnd: BigInt(price), sortOrder: i })),
    });
    console.log(`Sample catalog: ${products.length} products`);
  }

  // Sample materials, suppliers, fixed assets and tools for the accounting module (books not started)
  if (process.env.SEED_SAMPLE_DATA !== 'false' && (await prisma.material.count()) === 0) {
    const materials: Array<[string, string, string]> = [
      ['VT-BAT32', 'Bạt Hiflex khổ 3,2 m', 'm²'],
      ['VT-DPP', 'Decal PP in UV', 'm²'],
      ['VT-DSUA', 'Decal sữa', 'm²'],
      ['VT-MUC', 'Mực in UV', 'lít'],
      ['VT-ALU3', 'Tấm alu 3 mm 1,22×2,44', 'tấm'],
      ['VT-MICA3', 'Mica 3 mm 1,22×2,44', 'tấm'],
      ['VT-C300', 'Giấy C300', 'ram'],
    ];
    await prisma.material.createMany({ data: materials.map(([code, name, unit]) => ({ code, name, unit })) });
    const suppliers = ['Cty Vật tư quảng cáo Phú Thịnh', 'Mực in Hoàng Gia', 'Nhôm Alu Đại Phát', 'Giấy Sài Gòn Xanh'];
    if ((await prisma.supplier.count()) === 0) {
      for (const [i, name] of suppliers.entries()) {
        await prisma.supplier.create({ data: { code: `NCC-${String(i + 1).padStart(4, '0')}`, name } });
      }
      await prisma.$executeRaw`INSERT INTO "DocumentSequence" ("prefix", "period", "lastNo") VALUES ('NCC', '', ${suppliers.length})
        ON CONFLICT ("prefix", "period") DO UPDATE SET "lastNo" = GREATEST("DocumentSequence"."lastNo", EXCLUDED."lastNo")`;
    }
    if ((await prisma.fixedAsset.count()) === 0) {
      const assets: Array<[string, 'FIXED_ASSET' | 'TOOL', string, number, string, number, string]> = [
        ['TS-01', 'FIXED_ASSET', 'Máy in UV phẳng 2,5×1,3 m', 150_000_000, '2024-01', 60, '154'],
        ['TS-02', 'FIXED_ASSET', 'Máy in bạt khổ lớn 3,2 m', 90_000_000, '2023-06', 60, '154'],
        ['TS-03', 'FIXED_ASSET', 'Máy cắt CNC chữ nổi', 60_000_000, '2025-03', 48, '154'],
        ['TS-04', 'FIXED_ASSET', 'Xe tải nhỏ giao hàng', 180_000_000, '2024-09', 72, '6421'],
        ['CC-01', 'TOOL', 'Máy cán màng nguội 1,6 m', 18_000_000, '2026-04', 12, '154'],
        ['CC-02', 'TOOL', 'Bộ bàn cắt, dao, thước nhôm', 6_000_000, '2026-08', 6, '154'],
        ['CC-03', 'TOOL', 'Máy tính thiết kế', 24_000_000, '2026-01', 24, '6422'],
      ];
      await prisma.fixedAsset.createMany({
        data: assets.map(([code, kind, name, cost, startMonth, months, expenseAccount]) => ({ code, kind, name, costVnd: BigInt(cost), startMonth, months, expenseAccount, createdById: owner.id })),
      });
    }
    console.log(`Sample accounting data: ${materials.length} materials, ${suppliers.length} suppliers, 7 assets and tools`);
  }

  if (process.env.SEED_SAMPLE_DATA === 'false' || (await prisma.order.count()) > 0) return;

  const phone = '0903123456';
  const customer =
    (await prisma.customer.findUnique({ where: { phone } })) ??
    (await prisma.customer.create({
      data: {
        code: await nextCode('KH'),
        name: 'Anh Minh',
        companyName: 'Công ty ABC',
        phone,
        address: '12 Nguyễn Huệ, Quận 1, TP.HCM',
        searchText: toSearchText('Anh Minh', 'Công ty ABC', phone),
      },
    }));

  const today = todayInZone(tz);
  const order = await prisma.order.create({
    data: {
      code: await nextCode('DH'),
      customerId: customer.id,
      orderDate: parseDateOnly(today),
      dueDate: parseDateOnly(addDays(today, 7)),
      note: 'Đơn mẫu: 2 chuyến giao, đã cọc 3.000.000 đ',
      status: OrderStatus.IN_PRODUCTION,
      confirmedAt: new Date(),
      needsDesign: false,
      productionStartedAt: new Date(),
      productionCode: await nextCode('LSX'),
      productionStage: ProductionStage.PRINTING,
      productionDueDate: parseDateOnly(addDays(today, 3)),
      totalVnd: 12_000_000n,
      paidVnd: 3_000_000n,
      createdById: owner.id,
      lines: {
        create: [
          { description: 'Banner hiflex 2×1 m', spec: 'In UV, đóng khoen 4 góc', quantity: 10, plannedQty: 10, unitPriceVnd: 500_000n, lineTotalVnd: 5_000_000n, sortOrder: 0 },
          { description: 'Decal PP 30×40 cm', spec: 'Cán màng mờ', quantity: 200, plannedQty: 200, unitPriceVnd: 35_000n, lineTotalVnd: 7_000_000n, sortOrder: 1 },
        ],
      },
    },
    include: { lines: { orderBy: { sortOrder: 'asc' } } },
  });
  const [banner, decal] = order.lines;
  for (const [days, lines] of [
    [4, [{ orderLineId: banner.id, plannedQty: 10 }, { orderLineId: decal.id, plannedQty: 100 }]],
    [6, [{ orderLineId: decal.id, plannedQty: 100 }]],
  ] as const) {
    await prisma.delivery.create({
      data: {
        code: await nextCode('GH'),
        orderId: order.id,
        status: DeliveryStatus.SCHEDULED,
        plannedDate: parseDateOnly(addDays(today, days)),
        address: customer.address,
        createdById: owner.id,
        lines: { create: [...lines] },
      },
    });
  }
  await prisma.payment.create({
    data: { orderId: order.id, amountVnd: 3_000_000n, method: PaymentMethod.BANK_TRANSFER, paidOn: parseDateOnly(today), isDeposit: true, recordedById: owner.id },
  });
  await prisma.activityLog.create({
    data: { orderId: order.id, entityType: 'ORDER', entityId: order.id, action: 'ORDER_CREATED', toValue: order.code, userId: owner.id },
  });
  console.log(`Sample order: ${order.code} for ${customer.code} ${customer.companyName}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
