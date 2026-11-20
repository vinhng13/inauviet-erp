/**
 * npm run kho:giay -- <file.xlsx> [--write]
 * Imports the paper stock sheet ("Tồn giấy…": Mã VT, Loại giấy, Khổ giấy, TỒN) into Kho giấy, the same way as
 * Danh mục kho → Vật tư → Nhập tồn giấy Excel: creates materials and sizes, then a pending adjustment slip that brings
 * each size's stock to the sheet's number (sheet − confirmed stock); a previous import slip still pending is replaced. Without --write it only prints the preview.
 * Default file: data/giay.xlsx (the api/data folder is not committed).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AuthUser } from '../src/auth/auth.types';
import { todayInZone } from '../src/common/utils/dates';
import { PrismaClient } from '../src/generated/prisma/client';
import { NumberingService } from '../src/numbering/numbering.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { PaperImportService } from '../src/warehouse/paper-import.service';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const file = resolve(args.find((a) => !a.startsWith('--')) ?? 'data/giay.xlsx');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const admin = await prisma.user.findFirst({ where: { role: { isSystem: true }, isActive: true }, orderBy: { createdAt: 'asc' }, include: { role: true } });
    if (!admin) throw new Error('No administrator yet: run npm run db:seed first');
    const actor = {
      id: admin.id,
      username: admin.username,
      fullName: admin.fullName,
      roleId: admin.roleId,
      roleName: admin.role.name,
      isAdmin: true,
      permissions: new Set(),
    } as unknown as AuthUser;
    const db = prisma as unknown as PrismaService;
    const service = new PaperImportService(db, new NumberingService(db));
    const r = await service.run(readFileSync(file), !write, actor, todayInZone(process.env.APP_TIMEZONE ?? 'Asia/Ho_Chi_Minh'));

    console.log(`\nFile: ${file} (sheet "${r.sheet}")`);
    console.log(write ? 'ĐÃ NHẬP vào cơ sở dữ liệu' : 'XEM TRƯỚC (chưa ghi gì). Thêm --write để nhập.');
    console.log(`  Dòng giấy (loại × khổ): ${r.rows}   Vật tư mới: ${r.materialsCreated}   Quy cách mới: ${r.specsCreated}`);
    console.log(`  Có số tồn: ${r.counted} quy cách, tổng ${r.totalQty} tờ   Cần điều chỉnh: ${r.adjusted}   Đã đúng: ${r.unchanged}`);
    if (r.replacedSlips.length) console.log(`  ${write ? 'Đã thay' : 'Sẽ thay'} phiếu theo bảng trước còn chờ: ${r.replacedSlips.join(', ')}`);
    for (const i of r.items.filter((x) => x.delta)) console.log(`    ${i.name} ${i.size}: ${i.onHand} → ${i.qty} (${i.delta! > 0 ? '+' : ''}${i.delta})`);
    if (r.slipCode) console.log(`  Đã lập phiếu ${r.slipCode} (chờ xác nhận): thủ kho Kho giấy vào Kho → Tồn kho & phiếu → Chờ xác nhận, xem lại và bấm Xác nhận.`);
    console.log(`  Điểm cần xem: ${r.issues.length}`);
    for (const i of r.issues) console.log(`    ${i.row ? `dòng ${i.row} ` : ''}${i.code ?? ''}: ${i.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
