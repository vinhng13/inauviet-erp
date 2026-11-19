import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { dateField } from '../common/utils/input';
import { NumberingService } from '../numbering/numbering.service';
import { PrismaService } from '../prisma/prisma.service';
import { fmtCm, parseSheetSize } from './die-rules';
import type { ImportIssueDto, PaperImportReportDto } from './warehouse.dto';
import { readXlsx, type Cell } from './xlsx-reader';

const str = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c).trim().replace(/\s+/g, ' '));
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Mã VT trong bảng → nhóm vật tư */
function groupOf(code: string): string {
  const c = code.trim();
  if (/^dc$/i.test(c)) return 'Đề can';
  if (/^gn$/i.test(c)) return 'Giấy ngoại';
  if (/^c\d+$/i.test(c)) return 'Couche';
  if (/^op$/i.test(c)) return 'Op';
  return c || 'Giấy';
}

interface Row {
  row: number;
  group: string;
  name: string;
  w: number;
  l: number;
  qty: number | null;
  note: string;
}

/**
 * Nhập bảng tồn giấy đang theo dõi trên Excel / Google Sheets (sheet "Tồn giấy…": Mã VT, Loại giấy, Khổ giấy, TỒN).
 * Tạo vật tư (đơn vị tờ), quy cách theo khổ, gắn vào Kho giấy, rồi lập một phiếu điều chỉnh "Tồn đầu" (chờ xác nhận)
 * với số tồn trong bảng; thủ kho xác nhận mới thành tồn. Chạy lại không tạo trùng; quy cách đã có phiếu thì giữ tồn hiện tại.
 */
@Injectable()
export class PaperImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async run(buf: Buffer | undefined, dryRun: boolean, actor: AuthUser, today: string, warehouseCode = 'GIAY'): Promise<PaperImportReportDto> {
    if (!buf?.length) throw DomainError.badRequest('FILE_REQUIRED', 'Choose the Excel file');
    let sheets: Map<string, Cell[][]>;
    try {
      sheets = readXlsx(buf);
    } catch {
      throw DomainError.badRequest('WH_IMPORT_BAD_FILE', 'The file is not a readable .xlsx workbook');
    }
    // Sheet có dòng tiêu đề "Loại giấy"; ưu tiên sheet tên "Tồn giấy…"
    const names = [...sheets.keys()].sort((a, b) => Number(fold(b).startsWith('ton giay')) - Number(fold(a).startsWith('ton giay')));
    let sheetName = '';
    let headerRow = -1;
    for (const n of names) {
      const i = sheets.get(n)!.findIndex((r) => r.some((c) => fold(str(c)) === 'loai giay'));
      if (i >= 0) {
        sheetName = n;
        headerRow = i;
        break;
      }
    }
    if (headerRow < 0) throw DomainError.badRequest('WH_IMPORT_NO_HEADER', 'Header row "Loại giấy" not found', { sheet: 'Tồn giấy' });
    const rows = sheets.get(sheetName)!;
    const head = rows[headerRow] ?? [];
    const above = rows[headerRow - 1] ?? [];
    const col = (test: (s: string) => boolean): number => {
      const width = Math.max(head.length, above.length);
      for (let i = 0; i < width; i++) if (test(fold(str(head[i])))) return i;
      for (let i = 0; i < width; i++) if (test(fold(str(above[i])))) return i;
      return -1;
    };
    const cGroup = col((s) => s === 'ma vt' || s === 'ma');
    const cName = col((s) => s === 'loai giay');
    const cSize = col((s) => s.startsWith('kho giay') || s === 'kho');
    const cQty = col((s) => s === 'ton' || s === 'ton kho');
    const cNote = col((s) => s.startsWith('ghi chu'));
    if (cSize < 0 || cQty < 0) throw DomainError.badRequest('WH_IMPORT_NO_HEADER', 'Columns "Khổ giấy" and "TỒN" are required', { sheet: sheetName });

    const issues: ImportIssueDto[] = [];
    const planned = new Map<string, Row>();
    for (let i = headerRow + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const name = str(r[cName]);
      if (!name) continue;
      const row = i + 1;
      const sizeRaw = str(r[cSize]).replace(/\s*cm$/i, '');
      const size = parseSheetSize(sizeRaw);
      if (!size) {
        issues.push({ row, code: name, message: `Khổ "${str(r[cSize])}" không đọc được, bỏ qua dòng` });
        continue;
      }
      const qtyCell = r[cQty];
      const qty = typeof qtyCell === 'number' ? qtyCell : str(qtyCell) && !Number.isNaN(Number(str(qtyCell).replace(',', '.'))) ? Number(str(qtyCell).replace(',', '.')) : null;
      const note = cNote >= 0 ? str(r[cNote]) : '';
      if (qty === null) issues.push({ row, code: `${name} ${fmtCm(size[0])} × ${fmtCm(size[1])}`, message: `Chưa có số tồn${note ? ` (${note})` : ''}: tạo quy cách, không ghi tồn` });
      const group = groupOf(cGroup >= 0 ? str(r[cGroup]) : '');
      const key = `${fold(group)}|${fold(name)}|${size[0]}x${size[1]}`;
      const prev = planned.get(key);
      if (prev) {
        issues.push({ row, code: name, message: `Trùng loại giấy và khổ với dòng ${prev.row}: cộng dồn số tồn` });
        prev.qty = prev.qty === null && qty === null ? null : r3((prev.qty ?? 0) + (qty ?? 0));
        continue;
      }
      planned.set(key, { row, group, name, w: size[0], l: size[1], qty, note });
    }
    const list = [...planned.values()];
    if (!list.length) throw DomainError.badRequest('WH_IMPORT_EMPTY', 'No paper rows found');

    const kho = await this.prisma.whWarehouse.findUnique({ where: { code: warehouseCode } });
    if (!kho || kho.kind !== 'STOCK') throw DomainError.badRequest('WH_WAREHOUSE_NOT_FOUND', `Warehouse ${warehouseCode} not found`);
    const existing = await this.prisma.whMaterial.findMany({ include: { specs: true } });
    const findMat = (p: Row) => existing.find((m) => fold(m.group) === fold(p.group) && fold(m.name) === fold(p.name));
    const findSpec = (m: (typeof existing)[number] | undefined, p: Row) => m?.specs.find((s) => Number(s.widthCm) === p.w && Number(s.lengthCm) === p.l);
    const newMaterials = new Set(list.filter((p) => !findMat(p)).map((p) => `${fold(p.group)}|${fold(p.name)}`));
    const newSpecs = list.filter((p) => !findSpec(findMat(p), p)).length;

    const report: PaperImportReportDto = {
      sheet: sheetName,
      rows: list.length,
      materialsCreated: newMaterials.size,
      specsCreated: newSpecs,
      counted: 0,
      keptExisting: 0,
      slipCode: null,
      totalQty: 0,
      items: list.map((p) => ({ row: p.row, group: p.group, name: p.name, size: `${fmtCm(p.w)} x ${fmtCm(p.l)}`, qty: p.qty, note: p.note || null })),
      issues,
    };
    if (dryRun) {
      report.counted = list.filter((p) => p.qty !== null).length;
      report.totalQty = r3(list.reduce((a, p) => a + (p.qty ?? 0), 0));
      return report;
    }

    await this.prisma.$transaction(
      async (tx) => {
        const specOf = new Map<Row, string>();
        const matIds = new Map<string, string>();
        for (const p of list) {
          const mk = `${fold(p.group)}|${fold(p.name)}`;
          let materialId = matIds.get(mk) ?? findMat(p)?.id;
          if (!materialId) {
            materialId = (await tx.whMaterial.create({ data: { group: p.group, name: p.name, unit: 'tờ', hasSizes: true } })).id;
          }
          matIds.set(mk, materialId);
          await tx.whWarehouseMaterial.upsert({ where: { warehouseId_materialId: { warehouseId: kho.id, materialId } }, create: { warehouseId: kho.id, materialId }, update: {} });
          const spec = await tx.whSpec.upsert({
            where: { materialId_widthCm_lengthCm: { materialId, widthCm: p.w, lengthCm: p.l } },
            create: { materialId, widthCm: p.w, lengthCm: p.l },
            update: { isActive: true },
          });
          await tx.whStock.upsert({ where: { warehouseId_specId: { warehouseId: kho.id, specId: spec.id } }, create: { warehouseId: kho.id, specId: spec.id }, update: { isActive: true } });
          specOf.set(p, spec.id);
        }
        // Quy cách đã có phiếu (đã xác nhận hoặc đang chờ) ở kho này: giữ tồn trên phần mềm, không ghi đè bằng số trong bảng
        const used = new Set(
          (
            await tx.whSlipLine.findMany({
              where: { specId: { in: [...specOf.values()] }, slip: { warehouseId: kho.id, status: { in: ['PENDING', 'CONFIRMED'] }, voidedAt: null } },
              select: { specId: true },
              distinct: ['specId'],
            })
          ).map((l) => l.specId),
        );
        const counted = new Map<string, number>();
        for (const p of list) {
          if (p.qty === null) continue;
          const specId = specOf.get(p)!;
          if (used.has(specId)) {
            report.keptExisting++;
            issues.push({ row: p.row, code: `${p.name} ${fmtCm(p.w)} × ${fmtCm(p.l)}`, message: 'Quy cách đã có phiếu trên phần mềm: giữ tồn hiện tại, không ghi số trong bảng' });
            continue;
          }
          counted.set(specId, p.qty);
        }
        const lines = [...counted].filter(([, q]) => q > 0).map(([specId, qty]) => ({ specId, qty }));
        if (!lines.length) return;
        const date = dateField(today, 'today');
        const slip = await tx.whSlip.create({
          data: {
            code: await this.numbering.nextWarehouse(tx, 'DC', kho.code, date),
            warehouseId: kho.id,
            kind: 'ADJUST',
            status: 'PENDING',
            date,
            purpose: 'Tồn đầu',
            note: `Theo bảng "${sheetName}". Thủ kho xem lại rồi xác nhận.`,
            createdById: actor.id,
            lines: { create: lines },
          },
        });
        report.slipCode = slip.code;
        report.counted = counted.size;
        report.totalQty = r3([...counted.values()].reduce((a, v) => a + v, 0));
      },
      { timeout: 60_000 },
    );
    return report;
  }
}
