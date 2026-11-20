import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { dateField } from '../common/utils/input';
import type { WhDieStatus } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { parseDieNotes, parseSize } from './die-rules';
import type { ImportIssueDto, ImportReportDto } from './warehouse.dto';
import { dieSearchText, sizeOf } from './wh-common';
import { excelDate, readXlsx, type Cell } from './xlsx-reader';

const LIST_SHEET = 'DANH_SACH_KHUON';
const LOG_SHEET = 'NHAP_LIEU';
/** "Âu Việt" and "Khác" are not partners: home, or unknown */
const HOME = new Set(['âu việt', 'au viet']);
const UNKNOWN = new Set(['khác', 'khac', '']);
const MIN_MAKER_ROWS = 3;

const str = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c).trim().replace(/\s+/g, ' '));

interface Planned {
  row: number;
  code: string;
  symbolCode: string;
  seq: number;
  productName: string;
  size: ReturnType<typeof parseSize>;
  notes: ReturnType<typeof parseDieNotes>;
  maker: string | null;
  holder: string | null;
  shelf: string | null;
  status: WhDieStatus;
  lastDate: string | null;
  expectedBackOn: string | null;
  review: string[];
}

/**
 * Nhập bảng khuôn Excel đang dùng ở kho. Sheet DANH_SACH_KHUON là hồ sơ hiện tại của từng khuôn;
 * các dòng giao dịch ở NHAP_LIEU được giữ làm lịch sử. Chạy lại không tạo trùng (mã đã có thì bỏ qua).
 */
@Injectable()
export class DieImportService {
  constructor(private readonly prisma: PrismaService) {}

  async run(buf: Buffer | undefined, dryRun: boolean, actor: AuthUser, today: string): Promise<ImportReportDto> {
    if (!buf?.length) throw DomainError.badRequest('FILE_REQUIRED', 'Choose the Excel file');
    let sheets: Map<string, Cell[][]>;
    try {
      sheets = readXlsx(buf);
    } catch {
      throw DomainError.badRequest('WH_IMPORT_BAD_FILE', 'The file is not a readable .xlsx workbook');
    }
    const list = sheets.get(LIST_SHEET);
    if (!list) throw DomainError.badRequest('WH_IMPORT_NO_SHEET', `Sheet ${LIST_SHEET} not found`, { sheet: LIST_SHEET });
    const headerRow = list.findIndex((r) => str(r[0]).toLowerCase() === 'mã khuôn');
    if (headerRow < 0) throw DomainError.badRequest('WH_IMPORT_NO_HEADER', 'Header row "Mã khuôn" not found', { sheet: LIST_SHEET });

    const issues: ImportIssueDto[] = [];
    const planned: Planned[] = [];
    const seen = new Set<string>();
    for (let i = headerRow + 1; i < list.length; i++) {
      const r = list[i] ?? [];
      const code = str(r[0]).toUpperCase();
      if (!code) continue;
      const row = i + 1;
      const m = code.match(/^([A-Z]{2,5})-(\d{1,5})$/);
      if (!m) {
        issues.push({ code, row, message: 'Mã khuôn không đúng dạng KÝHIỆU-số, bỏ qua' });
        continue;
      }
      if (seen.has(code)) {
        issues.push({ code, row, message: 'Mã khuôn lặp lại trong file, bỏ qua dòng sau' });
        continue;
      }
      seen.add(code);
      const review: string[] = [];
      const stateText = str(r[7]).toUpperCase();
      const placeRaw = str(r[6]);
      const place = placeRaw.toLowerCase();
      const shelf = str(r[11]) || null;
      const lastDate = excelDate(r[8] ?? null);
      const expected = excelDate(r[9] ?? null);
      if (str(r[8]) && !lastDate) review.push(`Ngày phát sinh không đọc được: "${str(r[8])}"`);
      let holder: string | null = null;
      let status: WhDieStatus = 'READY';
      if (place && !HOME.has(place) && !UNKNOWN.has(place)) holder = placeRaw;
      if (stateText === 'ĐANG SẢN XUẤT') {
        if (holder) status = 'IN_USE';
        else review.push('Đang sản xuất nhưng không rõ xưởng');
      } else if (stateText === 'TRONG KHO') {
        if (holder) review.push(`Trong kho nhưng ghi nơi bế "${placeRaw}"`);
        holder = null;
      } else {
        review.push(`Trạng thái Excel: "${str(r[7]) || 'trống'}"${placeRaw ? `, nơi bế "${placeRaw}"` : ''}`);
        holder = null;
      }
      if (UNKNOWN.has(place) && placeRaw) review.push(`Nơi bế ghi "${placeRaw}"`);
      if (status === 'IN_USE' && lastDate && lastDate < shiftDays(today, -45)) {
        review.push('Ra xưởng đã lâu: xưởng còn bế hay chỉ giữ khuôn?');
      }
      const sizeRaw = str(r[3]);
      const size = parseSize(sizeRaw);
      if (sizeRaw && size.sizeText && size.lengthCm === null) issues.push({ code, row, message: `Kích thước "${sizeRaw}" giữ dạng chữ (không tìm theo số được)` });
      const maker = str(r[5]);
      planned.push({
        row,
        code,
        symbolCode: m[1],
        seq: Number(m[2]),
        productName: str(r[2]) || '(chưa có tên)',
        size,
        notes: parseDieNotes(str(r[4]), str(r[12])),
        maker: maker && !HOME.has(maker.toLowerCase()) && !UNKNOWN.has(maker.toLowerCase()) ? maker : null,
        holder,
        shelf: holder ? null : shelf,
        status,
        lastDate,
        expectedBackOn: status === 'IN_USE' ? expected : null,
        review,
      });
    }

    // "Nơi ra khuôn" là chữ gõ tay: chỉ tên lặp lại từ MIN_MAKER_ROWS dòng mới thành đối tác, còn lại giữ làm ghi chú
    const makerRows = new Map<string, number>();
    for (const p of planned) if (p.maker) makerRows.set(p.maker.toLowerCase(), (makerRows.get(p.maker.toLowerCase()) ?? 0) + 1);
    for (const p of planned) {
      if (!p.maker || (makerRows.get(p.maker.toLowerCase()) ?? 0) >= MIN_MAKER_ROWS) continue;
      p.notes = { ...p.notes, note: [p.notes.note, `Nơi ra khuôn: ${p.maker}`].filter(Boolean).join('; ') };
      p.review.push(`Nơi ra khuôn "${p.maker}" chưa rõ là đơn vị nào`);
      p.maker = null;
    }

    // Kích thước trùng: cùng ký hiệu, cùng cả ba chiều
    const bySize = new Map<string, string[]>();
    for (const p of planned) {
      if (p.size.lengthCm === null) continue;
      const key = `${p.symbolCode}|${p.size.lengthCm}|${p.size.widthCm}|${p.size.heightCm ?? ''}`;
      bySize.set(key, [...(bySize.get(key) ?? []), p.code]);
    }
    for (const codes of bySize.values()) {
      if (codes.length < 2) continue;
      for (const code of codes) {
        const p = planned.find((x) => x.code === code)!;
        p.review.push(`Cùng kích thước với ${codes.filter((c) => c !== code).join(', ')}`);
      }
    }

    // Lịch sử giao dịch (không phải dòng tạo khuôn)
    const history: Array<{ row: number; code: string; date: string | null; text: string }> = [];
    const log = sheets.get(LOG_SHEET);
    if (log) {
      const h = log.findIndex((r) => str(r[1]).toLowerCase() === 'thao tác');
      const codesWithCreate = new Set<string>();
      for (let i = h + 1; h >= 0 && i < log.length; i++) {
        const r = log[i] ?? [];
        const action = str(r[1]).toUpperCase();
        if (!action) continue;
        const code = (str(r[5]) || str(r[4])).toUpperCase();
        if (action === 'TẠO KHUÔN') {
          if (code) codesWithCreate.add(code);
          continue;
        }
        if (!code) {
          issues.push({ code: null, row: i + 1, message: `Dòng ${action} không có mã khuôn ("${str(r[6])}"), bỏ qua` });
          continue;
        }
        const date = excelDate(r[0] ?? null);
        const parts = [
          action.charAt(0) + action.slice(1).toLowerCase(),
          str(r[10]) && `nơi bế ${str(r[10])}`,
          excelDate(r[12] ?? null) && `hẹn lấy ${excelDate(r[12] ?? null)}`,
          str(r[8]),
          str(r[15]),
        ].filter(Boolean);
        history.push({ row: i + 1, code, date, text: parts.join(' · ') });
      }
      for (const p of planned) {
        if (h >= 0 && !codesWithCreate.has(p.code)) p.review.push('Không có dòng TẠO KHUÔN trong NHAP_LIEU (mã sinh từ dòng xuất khuôn)');
      }
    }

    const existing = new Set((await this.prisma.whDie.findMany({ where: { code: { in: planned.map((p) => p.code) } }, select: { code: true } })).map((d) => d.code));
    const todo = planned.filter((p) => !existing.has(p.code));
    // Kho khuôn: khuôn ở kho mặc định (kho đầu tiên); "ở đâu" trùng tên một kho khuôn (vd Xuân Đỉnh) thì vào kho đó
    const dieKhos = await this.prisma.whWarehouse.findMany({ where: { kind: 'DIE', isActive: true }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    if (!dieKhos.length) throw DomainError.badRequest('WH_NO_DIE_WAREHOUSE', 'Create a die warehouse first');
    const khoByName = new Map<string, string>();
    for (const k of dieKhos) {
      khoByName.set(k.name.toLowerCase(), k.id);
      khoByName.set(k.name.replace(/^kho\s+(khuôn\s+)?/i, '').toLowerCase(), k.id);
    }
    const homeKho = dieKhos[0];
    const partnerNames = (await this.prisma.whPartner.findMany({ select: { name: true } })).map((p) => p.name.toLowerCase());
    const locationCodes = (await this.prisma.whLocation.findMany({ where: { warehouseId: homeKho.id }, select: { code: true } })).map((l) => l.code.toLowerCase());
    const partnersCreated = uniq([...todo.map((p) => p.maker), ...todo.map((p) => p.holder)]).filter((n) => !partnerNames.includes(n.toLowerCase()) && !khoByName.has(n.toLowerCase()));
    const locationsCreated = uniq(todo.map((p) => p.shelf)).filter((c) => !locationCodes.includes(c.toLowerCase()));
    const byStatus: Record<string, number> = {};
    for (const p of todo) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
    const todoCodes = new Set(todo.map((p) => p.code));
    const historyTodo = history.filter((x) => todoCodes.has(x.code));
    for (const x of history) {
      if (!seen.has(x.code)) issues.push({ code: x.code, row: x.row, message: 'Giao dịch của mã không có trong danh sách khuôn, bỏ qua' });
    }
    for (const p of todo) if (p.review.length) issues.push({ code: p.code, row: p.row, message: `Cần xác nhận: ${p.review.join('; ')}` });

    const report: ImportReportDto = {
      dryRun,
      dies: todo.length,
      skippedExisting: planned.length - todo.length,
      history: historyTodo.length,
      partnersCreated,
      locationsCreated,
      byStatus,
      issues: issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0)),
    };
    if (dryRun || !todo.length) return report;

    await this.prisma.$transaction(
      async (tx) => {
        const partners = new Map<string, string>();
        for (const p of await tx.whPartner.findMany()) partners.set(p.name.toLowerCase(), p.id);
        const makers = new Set(todo.map((p) => p.maker).filter(Boolean));
        for (const name of partnersCreated) {
          const p = await tx.whPartner.create({ data: { name, kind: makers.has(name) ? 'DIE_MAKER' : 'DIE_SHOP' } });
          partners.set(name.toLowerCase(), p.id);
        }
        const locations = new Map<string, string>();
        for (const l of await tx.whLocation.findMany({ where: { warehouseId: homeKho.id } })) locations.set(l.code.toLowerCase(), l.id);
        for (const code of locationsCreated) {
          const l = await tx.whLocation.create({ data: { code, warehouseId: homeKho.id } });
          locations.set(code.toLowerCase(), l.id);
        }
        const symbols = new Map((await tx.whDieSymbol.findMany()).map((s) => [s.code, s.lastNo]));
        for (const p of todo) {
          if (!symbols.has(p.symbolCode)) {
            await tx.whDieSymbol.create({ data: { code: p.symbolCode, name: p.symbolCode } });
            symbols.set(p.symbolCode, 0);
          }
        }
        const imported = dateField(today, 'today');
        for (const p of todo) {
          const atKho = p.holder ? khoByName.get(p.holder.toLowerCase()) : undefined;
          const holderId = p.holder && !atKho ? partners.get(p.holder.toLowerCase())! : null;
          const locationId = p.shelf && !atKho ? locations.get(p.shelf.toLowerCase())! : null;
          const warehouseId = atKho ?? homeKho.id;
          const status = atKho && p.status === 'IN_USE' ? 'READY' : p.status;
          const fields = {
            productName: p.productName,
            lengthCm: p.size.lengthCm,
            widthCm: p.size.widthCm,
            heightCm: p.size.heightCm,
            sizeText: p.size.sizeText,
            orientation: p.notes.orientation,
            pieces: p.notes.pieces,
            ups: p.notes.ups,
            note: p.notes.note,
          };
          const die = await tx.whDie.create({
            data: {
              code: p.code,
              symbolCode: p.symbolCode,
              seq: p.seq,
              ...fields,
              makerId: p.maker ? partners.get(p.maker.toLowerCase())! : null,
              status,
              warehouseId,
              holderId,
              locationId,
              expectedBackOn: p.expectedBackOn ? dateField(p.expectedBackOn, 'expectedBackOn') : null,
              needsReview: p.review.length > 0,
              reviewNote: p.review.length ? p.review.join('; ') : null,
              searchText: dieSearchText({ code: p.code, ...fields }, sizeOf(p.size)),
            },
          });
          await tx.whDieMove.create({
            data: {
              dieId: die.id,
              action: 'IMPORT',
              date: p.lastDate ? dateField(p.lastDate, 'date') : imported,
              toStatus: status,
              place: atKho ? dieKhos.find((k) => k.id === atKho)!.name : (p.holder ?? (p.shelf ? `${homeKho.name} · ${p.shelf}` : homeKho.name)),
              partnerId: holderId,
              locationId,
              expectedBackOn: p.expectedBackOn ? dateField(p.expectedBackOn, 'expectedBackOn') : null,
              note: `Nhập từ bảng khuôn Excel (dòng ${p.row})`,
              userId: actor.id,
            },
          });
          for (const x of historyTodo.filter((h) => h.code === p.code)) {
            await tx.whDieMove.create({
              data: {
                dieId: die.id,
                action: 'IMPORT',
                date: x.date ? dateField(x.date, 'date') : imported,
                note: `Excel NHAP_LIEU dòng ${x.row}: ${x.text}`,
                userId: actor.id,
              },
            });
          }
        }
        // Mã mới cấp tiếp sau số lớn nhất đã có
        const maxSeq = new Map<string, number>();
        for (const d of await tx.whDie.groupBy({ by: ['symbolCode'], _max: { seq: true } })) maxSeq.set(d.symbolCode, d._max.seq ?? 0);
        for (const [code, max] of maxSeq) {
          await tx.whDieSymbol.updateMany({ where: { code, lastNo: { lt: max } }, data: { lastNo: max } });
        }
      },
      { timeout: 120_000 },
    );
    return report;
  }
}

function uniq(values: Array<string | null>): string[] {
  const out = new Map<string, string>();
  for (const v of values) if (v && !out.has(v.toLowerCase())) out.set(v.toLowerCase(), v);
  return [...out.values()];
}

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
