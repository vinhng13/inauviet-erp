import { DomainError } from '../common/errors/domain-error';
import { formatDateOnly } from '../common/utils/dates';
import { toSearchText } from '../common/utils/vn-text';
import type { Prisma } from '../generated/prisma/client';
import type { AuthUser } from '../auth/auth.types';
import type { Tx } from '../prisma/prisma.service';
import { fmtCm } from './die-rules';
import type { DieRowDto } from './warehouse.dto';
import type { WhPartnerKind } from '../generated/prisma/client';

export const n = (v: Prisma.Decimal | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
export const nn = (v: Prisma.Decimal | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

type Dim = Prisma.Decimal | number | null;

/** Quy cách: "18 x 50,5", "khổ 160" (chỉ khổ rộng) hoặc "" (không theo khổ) */
export function specLabel(i: { widthCm: Dim; lengthCm: Dim }): string {
  const w = n(i.widthCm);
  const l = n(i.lengthCm);
  if (w && l) return `${fmtCm(w)} x ${fmtCm(l)}`;
  if (w) return `khổ ${fmtCm(w)}`;
  return '';
}

export function itemLabel(m: { name: string; hasSizes: boolean }, i: { widthCm: Dim; lengthCm: Dim }): string {
  const spec = m.hasSizes ? specLabel(i) : '';
  return spec ? `${m.name} · ${spec}` : m.name;
}

/**
 * Thủ kho xác nhận phiếu của kho mình. Quản trị viên xác nhận được mọi kho.
 * Kho chưa có thủ kho: ai có quyền lập phiếu cũng xác nhận được.
 */
export function canConfirmIn(actor: AuthUser, keeperIds: string[], fallbackPermission: 'warehouse.slip' | 'warehouse.dies' = 'warehouse.slip'): boolean {
  if (actor.isAdmin) return true;
  if (keeperIds.length) return keeperIds.includes(actor.id);
  return actor.permissions.has(fallbackPermission);
}

const nameOnly = { select: { name: true } } as const;

/** Tên nơi đi / nơi đến của một phiếu giao nhận */
export const batchEnds = {
  fromWarehouse: nameOnly,
  fromPartner: nameOnly,
  toWarehouse: nameOnly,
  toPartner: nameOnly,
} satisfies Prisma.WhDieBatchInclude;

type BatchEnds = Prisma.WhDieBatchGetPayload<{ include: typeof batchEnds }>;

export function batchFromName(b: Pick<BatchEnds, 'fromWarehouse' | 'fromPartner' | 'isNew'>): string {
  return b.fromWarehouse?.name ?? b.fromPartner?.name ?? (b.isNew ? 'Nơi làm khuôn (chưa ghi)' : '—');
}

export function batchToName(b: Pick<BatchEnds, 'toWarehouse' | 'toPartner'>): string {
  return b.toWarehouse?.name ?? b.toPartner?.name ?? '—';
}

export const dieInclude = {
  holder: { select: { id: true, name: true } },
  location: { select: { id: true, code: true } },
  warehouse: { select: { id: true, name: true } },
  pendingBatch: { select: { id: true, isNew: true, ...batchEnds } },
} satisfies Prisma.WhDieInclude;

export type DieWithPlace = Prisma.WhDieGetPayload<{ include: typeof dieInclude }>;

/** Nơi khuôn đang ở: xưởng, "Kho · kệ", hoặc "A → B" khi đang chuyển / khuôn mới chờ nhận */
export function placeOf(d: {
  status?: string;
  holder: { name: string } | null;
  location: { code: string } | null;
  warehouse: { name: string };
  pendingBatch?: (Pick<BatchEnds, 'fromWarehouse' | 'fromPartner' | 'toWarehouse' | 'toPartner' | 'isNew'>) | null;
}): string {
  if ((d.status === 'TRANSIT' || d.status === 'INCOMING') && d.pendingBatch) return `${batchFromName(d.pendingBatch)} → ${batchToName(d.pendingBatch)}`;
  if (d.holder) return d.holder.name;
  return d.location ? `${d.warehouse.name} · ${d.location.code}` : d.warehouse.name;
}

export function sizeOf(d: { lengthCm: Dim; widthCm: Dim; heightCm: Dim; sizeText: string | null }): string | null {
  const parts = [d.lengthCm, d.widthCm, d.heightCm].filter((v) => v !== null).map((v) => fmtCm(Number(v)));
  if (parts.length >= 2) return parts.join(' x ');
  return d.sizeText;
}

export function dieRow(d: DieWithPlace, today: string): DieRowDto {
  const back = formatDateOnly(d.expectedBackOn);
  return {
    id: d.id,
    code: d.code,
    symbolCode: d.symbolCode,
    kind: d.kind,
    productName: d.productName,
    customerName: d.customerName,
    size: sizeOf(d),
    lengthCm: nn(d.lengthCm),
    widthCm: nn(d.widthCm),
    heightCm: nn(d.heightCm),
    orientation: d.orientation,
    pieces: d.pieces,
    ups: d.ups,
    status: d.status,
    place: placeOf(d),
    warehouseId: d.warehouseId,
    warehouseName: d.warehouse.name,
    holderId: d.holderId,
    locationId: d.locationId,
    pendingBatchId: d.pendingBatchId,
    expectedBackOn: back,
    overdue: !!back && back < today && (d.status === 'IN_USE' || d.status === 'REPAIRING'),
    needsReview: d.needsReview,
    reviewNote: d.reviewNote,
  };
}

export function dieSearchText(d: { code: string; productName: string; customerName?: string | null; sizeText?: string | null; note?: string | null }, size: string | null): string {
  return toSearchText(d.code, d.productName, d.customerName, size, d.sizeText, d.note);
}

const clean = (v?: string | null) => (v ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');

/**
 * Ô chọn danh mục cho gõ tên mới: tìm đối tác theo tên (không phân biệt hoa thường, khoảng trắng); chưa có thì thêm.
 * Đối tác đang ngừng dùng thì bật lại. Trả về id, hoặc `id` truyền vào khi không gõ tên.
 */
export async function partnerIdOrCreate(db: Tx, id: string | null | undefined, name: string | null | undefined, kind: WhPartnerKind = 'OTHER'): Promise<string | null> {
  const n = clean(name);
  if (id || !n) return id ?? null;
  if (n.length > 120) throw DomainError.badRequest('WH_NAME_TOO_LONG', 'Name is too long (max 120)');
  const found = await db.whPartner.findFirst({ where: { name: { equals: n, mode: 'insensitive' } } });
  if (found) {
    if (!found.isActive) await db.whPartner.update({ where: { id: found.id }, data: { isActive: true } });
    return found.id;
  }
  return (await db.whPartner.create({ data: { name: n, kind } })).id;
}

/** Như trên cho kệ trong một kho khuôn: tìm theo mã kệ, chưa có thì thêm */
export async function locationIdOrCreate(db: Tx, warehouseId: string | null | undefined, id: string | null | undefined, code: string | null | undefined): Promise<string | null> {
  const c = clean(code);
  if (id || !c || !warehouseId) return id ?? null;
  if (c.length > 40) throw DomainError.badRequest('WH_NAME_TOO_LONG', 'Shelf code is too long (max 40)');
  const found = await db.whLocation.findFirst({ where: { warehouseId, code: { equals: c, mode: 'insensitive' } } });
  if (found) {
    if (!found.isActive) await db.whLocation.update({ where: { id: found.id }, data: { isActive: true } });
    return found.id;
  }
  return (await db.whLocation.create({ data: { warehouseId, code: c } })).id;
}
