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
/** Ghi chú đầu phiếu điều chỉnh do lần nhập bảng tạo ra (để lần nhập sau nhận ra và thay thế khi còn chờ) */
const NOTE_PREFIX = 'Theo bảng';
/** "79 x 109" / "khổ 320" / "" (không theo khổ) */
const sizeText = (w: number, l: number) => (!w ? '' : l ? `${fmtCm(w)} x ${fmtCm(l)}` : `khổ ${fmtCm(w)}`);
const label = (name: string, w: number, l: number) => (w ? `${name} ${sizeText(w, l).replace(' x ', ' × ')}` : name);

/** Nhóm vật tư theo Mã VT trong bảng (mã vẫn giữ nguyên ở cột Mã của vật tư) */
function groupOf(code: string): string {
  if (/^dc$/i.test(code)) return 'Đề can';
  if (/^gn$/i.test(code)) return 'Giấy ngoại';
  if (/^c\d+$/i.test(code)) return 'Couche';
  return code || 'Khác';
}

interface Row {
  row: number;
  /** Mã VT đúng như trong bảng */
  code: string;
  group: string;
  name: string;
  /** Đơn vị cơ sở khi phải tạo vật tư mới (cột ĐVT; trống = tờ) */
  unit: string;
  w: number;
  l: number;
  qty: number | null;
  note: string;
}

/**
 * Nhập tồn vật tư từ Excel vào một kho do người dùng chọn (mặc định Kho giấy). Đọc được bảng "THEO DÕI GIẤY TỒN"
 * (Mã VT, Loại giấy, Khổ giấy, TỒN) và bảng vật tư chung (Tên vật tư, Nhóm, Khổ / Quy cách, ĐVT, TỒN).
 * Vật tư tìm theo tên trong danh mục chung (không đổi đơn vị của vật tư đã có); chưa có thì tạo với ĐVT trong file
 * (trống = tờ). Rồi lập một phiếu điều chỉnh (chờ xác nhận) ở kho đã chọn, đưa tồn từng
 * quy cách về đúng số trong bảng: dòng = số trong bảng − tồn đã xác nhận. Lần đầu là phiếu "Tồn đầu". Chạy lại với bảng mới:
 * phiếu theo bảng trước còn chờ thì bị thay thế; đã xác nhận rồi thì phiếu mới chỉ ghi phần chênh. Dòng chưa có số tồn
 * (chưa đếm) chỉ tạo quy cách, không đổi tồn; quy cách có tồn trên phần mềm mà không có trong bảng thì giữ nguyên.
 */
@Injectable()
export class PaperImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  async run(buf: Buffer | undefined, dryRun: boolean, actor: AuthUser, today: string, warehouse?: string): Promise<PaperImportReportDto> {
    if (!buf?.length) throw DomainError.badRequest('FILE_REQUIRED', 'Choose the Excel file');
    let sheets: Map<string, Cell[][]>;
    try {
      sheets = readXlsx(buf);
    } catch {
      throw DomainError.badRequest('WH_IMPORT_BAD_FILE', 'The file is not a readable .xlsx workbook');
    }
    // Sheet có dòng tiêu đề "Loại giấy" hoặc "Tên vật tư"; ưu tiên sheet tên "Tồn…"
    const isNameHead = (s: string) => s === 'loai giay' || s === 'ten vat tu' || s === 'vat tu' || s === 'ten';
    const names = [...sheets.keys()].sort((a, b) => Number(fold(b).startsWith('ton')) - Number(fold(a).startsWith('ton')));
    let sheetName = '';
    let headerRow = -1;
    for (const n of names) {
      const i = sheets.get(n)!.findIndex((r) => r.some((c) => isNameHead(fold(str(c)))));
      if (i >= 0) {
        sheetName = n;
        headerRow = i;
        break;
      }
    }
    if (headerRow < 0) throw DomainError.badRequest('WH_IMPORT_NO_HEADER', 'Header row "Tên vật tư" / "Loại giấy" not found', { sheet: 'Tồn' });
    const rows = sheets.get(sheetName)!;
    const head = rows[headerRow] ?? [];
    const above = rows[headerRow - 1] ?? [];
    const col = (test: (s: string) => boolean): number => {
      const width = Math.max(head.length, above.length);
      for (let i = 0; i < width; i++) if (test(fold(str(head[i])))) return i;
      for (let i = 0; i < width; i++) if (test(fold(str(above[i])))) return i;
      return -1;
    };
    const cCode = col((s) => s === 'ma vt' || s === 'ma' || s === 'ma vat tu');
    const cGroup = col((s) => s === 'nhom' || s === 'nhom vat tu');
    const cName = col(isNameHead);
    const cSize = col((s) => s.startsWith('kho giay') || s === 'kho' || s === 'quy cach' || s.startsWith('kho /') || s.startsWith('kho/'));
    const cUnit = col((s) => s === 'dvt' || s === 'don vi' || s === 'don vi tinh');
    const cQty = col((s) => s === 'ton' || s === 'ton kho');
    const cNote = col((s) => s.startsWith('ghi chu'));
    if (cQty < 0) throw DomainError.badRequest('WH_IMPORT_NO_HEADER', 'Column "TỒN" is required', { sheet: sheetName });

    const issues: ImportIssueDto[] = [];
    const planned = new Map<string, Row>();
    for (let i = headerRow + 1; i < rows.length; i++) {
      const r = rows[i] ?? [];
      const name = str(r[cName]);
      if (!name) continue;
      const row = i + 1;
      const sizeRaw = cSize >= 0 ? str(r[cSize]).replace(/\s*cm$/i, '').replace(/^khổ\s*/i, '') : '';
      const roll = sizeRaw.match(/^(\d+(?:[.,]\d+)?)$/);
      const size: [number, number] | null = !sizeRaw ? [0, 0] : roll ? [Number(roll[1].replace(',', '.')), 0] : parseSheetSize(sizeRaw);
      if (!size) {
        issues.push({ row, code: name, message: `Khổ "${str(r[cSize])}" không đọc được, bỏ qua dòng` });
        continue;
      }
      const qtyCell = r[cQty];
      const qty = typeof qtyCell === 'number' ? qtyCell : str(qtyCell) && !Number.isNaN(Number(str(qtyCell).replace(',', '.'))) ? Number(str(qtyCell).replace(',', '.')) : null;
      const note = cNote >= 0 ? str(r[cNote]) : '';
      if (qty === null)
        issues.push({ row, code: label(name, size[0], size[1]), message: `Chưa có số tồn${note ? ` (${note})` : ''}: tạo quy cách, không ghi tồn` });
      const code = cCode >= 0 ? str(r[cCode]) : '';
      const group = (cGroup >= 0 ? str(r[cGroup]) : '') || groupOf(code);
      const unit = (cUnit >= 0 ? str(r[cUnit]) : '') || 'tờ';
      const key = `${fold(group)}|${fold(name)}|${size[0]}x${size[1]}`;
      const prev = planned.get(key);
      if (prev) {
        issues.push({ row, code: name, message: `Trùng vật tư và quy cách với dòng ${prev.row}: cộng dồn số tồn` });
        prev.qty = prev.qty === null && qty === null ? null : r3((prev.qty ?? 0) + (qty ?? 0));
        continue;
      }
      planned.set(key, { row, code, group, name, unit, w: size[0], l: size[1], qty, note });
    }
    const list = [...planned.values()];
    if (!list.length) throw DomainError.badRequest('WH_IMPORT_EMPTY', 'No material rows found');

    const key = warehouse?.trim() || 'GIAY';
    const isId = /^[0-9a-f-]{36}$/i.test(key);
    const kho = await this.prisma.whWarehouse.findUnique({ where: isId ? { id: key } : { code: key } });
    if (!kho || !kho.isActive) throw DomainError.badRequest('WH_WAREHOUSE_NOT_FOUND', `Warehouse ${key} not found`);
    const existing = await this.prisma.whMaterial.findMany({ include: { specs: true } });
    const findMat = (p: Row) => {
      const same = existing.filter((m) => fold(m.name) === fold(p.name));
      // Trùng tên: ưu tiên cùng nhóm (bản nhập trước có thể đã để nhóm = Mã VT), không thì vật tư cùng tên duy nhất
      return (
        same.find((m) => fold(m.group) === fold(p.group)) ??
        (p.code ? same.find((m) => fold(m.group) === fold(p.code)) : undefined) ??
        (same.length === 1 ? same[0] : undefined)
      );
    };
    const findSpec = (m: (typeof existing)[number] | undefined, p: Row) => m?.specs.find((s) => Number(s.widthCm) === p.w && Number(s.lengthCm) === p.l);
    const newMaterials = new Set(list.filter((p) => !findMat(p)).map((p) => `${fold(p.group)}|${fold(p.name)}`));
    const newSpecs = list.filter((p) => !findSpec(findMat(p), p)).length;

    const report: PaperImportReportDto = {
      sheet: sheetName,
      warehouseId: kho.id,
      warehouseName: kho.name,
      rows: list.length,
      materialsCreated: newMaterials.size,
      specsCreated: newSpecs,
      counted: list.filter((p) => p.qty !== null).length,
      adjusted: 0,
      unchanged: 0,
      replacedSlips: [],
      slipCode: null,
      totalQty: r3(list.reduce((a, p) => a + (p.qty ?? 0), 0)),
      items: list.map((p) => ({
        row: p.row,
        code: p.code || null,
        group: p.group,
        name: p.name,
        size: sizeText(p.w, p.l),
        qty: p.qty,
        note: p.note || null,
        onHand: null,
        delta: null,
      })),
      issues,
    };

    // Phiếu "theo bảng" của lần nhập trước còn chờ xác nhận: lần nhập này thay thế (huỷ phiếu cũ, lập phiếu mới theo số mới)
    const oldSlips = await this.prisma.whSlip.findMany({
      where: { warehouseId: kho.id, kind: 'ADJUST', status: 'PENDING', voidedAt: null, note: { startsWith: NOTE_PREFIX } },
      select: { id: true, code: true },
    });
    report.replacedSlips = oldSlips.map((x) => x.code);
    // Tồn đã xác nhận hiện tại của từng quy cách trong kho giấy
    const stocks = await this.prisma.whStock.findMany({ where: { warehouseId: kho.id }, include: { spec: { include: { material: true } } } });
    const onHandOf = (p: Row) => {
      const m = findMat(p);
      const sp = findSpec(m, p);
      const st = sp && stocks.find((x) => x.specId === sp.id);
      return st ? Number(st.qty) : 0;
    };
    // Phiếu khác (nhập / xuất / chuyển) đang chờ xác nhận ở kho giấy: số trong bảng là số thực tế, cần xem lại các phiếu này
    const otherPending = await this.prisma.whSlipLine.findMany({
      where: { slip: { warehouseId: kho.id, status: 'PENDING', voidedAt: null, id: { notIn: oldSlips.map((x) => x.id) } } },
      select: { specId: true, slip: { select: { code: true } } },
    });
    const sheetKeys = new Set<string>();
    list.forEach((p, i) => {
      const item = report.items[i]!;
      const sp = findSpec(findMat(p), p);
      if (sp) sheetKeys.add(sp.id);
      item.onHand = onHandOf(p);
      if (p.qty === null) return;
      item.delta = r3(p.qty - item.onHand);
      if (item.delta === 0) report.unchanged++;
      else report.adjusted++;
      const pend = sp ? [...new Set(otherPending.filter((l) => l.specId === sp.id).map((l) => l.slip.code))] : [];
      if (pend.length)
        issues.push({
          row: p.row,
          code: label(p.name, p.w, p.l),
          message: `Đang có phiếu chờ xác nhận ${pend.join(', ')}: tồn sẽ lệch bảng nếu xác nhận phiếu đó, nên xem lại`,
        });
    });
    for (const st of stocks) {
      if (sheetKeys.has(st.specId) || Number(st.qty) === 0) continue;
      issues.push({
        row: null,
        code: label(st.spec.material.name, Number(st.spec.widthCm), Number(st.spec.lengthCm)),
        message: `Có tồn ${Number(st.qty)} trên phần mềm nhưng không có trong bảng: giữ nguyên`,
      });
    }
    if (dryRun) return report;

    await this.prisma.$transaction(
      async (tx) => {
        const specOf = new Map<Row, string>();
        const matIds = new Map<string, string>();
        for (const p of list) {
          const mk = `${fold(p.group)}|${fold(p.name)}`;
          const found = findMat(p);
          let materialId = matIds.get(mk) ?? found?.id;
          if (!materialId) {
            materialId = (await tx.whMaterial.create({ data: { code: p.code || null, group: p.group, name: p.name, unit: p.unit, hasSizes: p.w > 0 } })).id;
          } else if (found && found.id === materialId && (found.group !== p.group || (p.code && found.code !== p.code))) {
            // Mã vật tư = Mã VT trong bảng; nhóm theo mã (sửa lại vật tư do bản nhập trước tạo)
            await tx.whMaterial.update({ where: { id: materialId }, data: { group: p.group, ...(p.code ? { code: p.code } : {}) } });
            found.group = p.group;
            if (p.code) found.code = p.code;
          }
          matIds.set(mk, materialId);
          await tx.whWarehouseMaterial.upsert({ where: { warehouseId_materialId: { warehouseId: kho.id, materialId } }, create: { warehouseId: kho.id, materialId }, update: {} });
          const spec = await tx.whSpec.upsert({
            where: { materialId_widthCm_lengthCm: { materialId, widthCm: p.w, lengthCm: p.l } },
            create: { materialId, widthCm: p.w, lengthCm: p.l },
            update: { isActive: true },
          });
          await tx.whStock.upsert({
            where: { warehouseId_specId: { warehouseId: kho.id, specId: spec.id } },
            create: { warehouseId: kho.id, specId: spec.id },
            update: { isActive: true },
          });
          specOf.set(p, spec.id);
        }
        if (oldSlips.length) {
          const cancelled = await tx.whSlip.updateMany({
            where: { id: { in: oldSlips.map((x) => x.id) }, status: 'PENDING' },
            data: { status: 'CANCELLED', rejectReason: 'Thay bằng lần nhập tồn vật tư mới' },
          });
          if (cancelled.count !== oldSlips.length) throw DomainError.conflict('WH_IMPORT_RACE', 'A previous import slip changed while importing; try again');
        }
        // Dòng điều chỉnh = số trong bảng − tồn đã xác nhận (đọc lại trong giao dịch)
        const current = new Map((await tx.whStock.findMany({ where: { warehouseId: kho.id, specId: { in: [...specOf.values()] } } })).map((x) => [x.specId, Number(x.qty)]));
        const lines = list
          .filter((p) => p.qty !== null)
          .map((p) => ({ specId: specOf.get(p)!, qty: r3(p.qty! - (current.get(specOf.get(p)!) ?? 0)) }))
          .filter((l) => l.qty !== 0);
        if (!lines.length) return;
        // Chưa quy cách nào có phiếu đã xác nhận ở kho này: đây là tồn đầu; còn lại là điều chỉnh
        const anyConfirmed = await tx.whSlipLine.count({
          where: { specId: { in: lines.map((l) => l.specId) }, slip: { warehouseId: kho.id, status: 'CONFIRMED', voidedAt: null } },
        });
        const date = dateField(today, 'today');
        const slip = await tx.whSlip.create({
          data: {
            code: await this.numbering.nextWarehouse(tx, 'DC', kho.code, date),
            warehouseId: kho.id,
            kind: 'ADJUST',
            status: 'PENDING',
            date,
            purpose: anyConfirmed ? 'Điều chỉnh theo bảng tồn vật tư' : 'Tồn đầu',
            note: `${NOTE_PREFIX} "${sheetName}": đưa tồn về đúng số trong bảng. Thủ kho xem lại rồi xác nhận.`,
            createdById: actor.id,
            lines: { create: lines },
          },
        });
        report.slipCode = slip.code;
      },
      { timeout: 60_000 },
    );
    return report;
  }
}
