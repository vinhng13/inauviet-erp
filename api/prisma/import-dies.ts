/**
 * npm run kho:import -- <file.xlsx> [--write]
 * Imports the warehouse's Excel die list (sheet DANH_SACH_KHUON, history from NHAP_LIEU) into the Kho module,
 * the same way as Danh mục kho → Nhập bảng khuôn Excel. Without --write it only prints the preview.
 * Codes already in the database are skipped, so running it again adds nothing.
 * Default file: data/khuon.xlsx (the api/data folder is not committed).
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AuthUser } from '../src/auth/auth.types';
import { todayInZone } from '../src/common/utils/dates';
import { PrismaClient } from '../src/generated/prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { DieImportService } from '../src/warehouse/import.service';

const STATUS: Record<string, string> = { READY: 'Sẵn sàng', IN_USE: 'Đang bế', CHECKING: 'Chờ kiểm' };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const file = resolve(args.find((a) => !a.startsWith('--')) ?? 'data/khuon.xlsx');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const admin = await prisma.user.findFirst({ where: { role: { isSystem: true }, isActive: true }, orderBy: { createdAt: 'asc' }, include: { role: true } });
    if (!admin) throw new Error('No administrator yet: run npm run db:seed first');
    const actor = { id: admin.id, username: admin.username, fullName: admin.fullName, roleId: admin.roleId, roleName: admin.role.name, isAdmin: true, permissions: new Set() } as unknown as AuthUser;
    const service = new DieImportService(prisma as unknown as PrismaService);
    const r = await service.run(readFileSync(file), !write, actor, todayInZone(process.env.APP_TIMEZONE ?? 'Asia/Ho_Chi_Minh'));

    console.log(`\nFile: ${file}`);
    console.log(write ? 'ĐÃ NHẬP vào cơ sở dữ liệu' : 'XEM TRƯỚC (chưa ghi gì). Thêm --write để nhập.');
    console.log(`  Khuôn mới: ${r.dies}   Mã đã có, bỏ qua: ${r.skippedExisting}   Dòng lịch sử: ${r.history}`);
    console.log(`  Theo trạng thái: ${Object.entries(r.byStatus).map(([s, n]) => `${STATUS[s] ?? s} ${n}`).join(', ') || '—'}`);
    console.log(`  Kho ngoài ${write ? 'đã' : 'sẽ'} tạo: ${r.warehousesCreated.join(', ') || '—'}`);
    console.log(`  Vị trí ${write ? 'đã' : 'sẽ'} tạo: ${r.locationsCreated.join(', ') || '—'}`);
    console.log(`  Điểm cần xem: ${r.issues.length}${r.issues.length ? ' (khuôn cần xác nhận hiện ở bộ lọc "Cần xác nhận" trong menu Khuôn)' : ''}`);
    for (const i of r.issues.slice(0, 15)) console.log(`    dòng ${i.row} ${i.code ?? ''}: ${i.message}`);
    if (r.issues.length > 15) console.log(`    … và ${r.issues.length - 15} điểm nữa`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
