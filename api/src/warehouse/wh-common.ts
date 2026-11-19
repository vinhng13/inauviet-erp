import { DomainError } from '../common/errors/domain-error';
import { formatDateOnly } from '../common/utils/dates';
import { toSearchText } from '../common/utils/vn-text';
import type { Prisma } from '../generated/prisma/client';
import type { AuthUser } from '../auth/auth.types';
import type { Tx } from '../prisma/prisma.service';
import { fmtCm } from './die-rules';
import type { DieRowDto } from './warehouse.dto';

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

/** Phiếu trong tháng đã chốt tồn của kho không lập / xác nhận / huỷ được */
export async function assertMonthOpen(tx: Tx, warehouseId: string, ymd: string): Promise<void> {
  const month = ymd.slice(0, 7);
  if (await tx.whMonthLock.findUnique({ where: { warehouseId_month: { warehouseId, month } } })) {
    throw DomainError.badRequest('WH_MONTH_LOCKED', `Month ${month} is locked for this warehouse`, { month });
  }
}

/**
 * Thủ kho xác nhận phiếu của kho mình. Quản trị viên xác nhận được mọi kho.
 * Kho chưa có thủ kho: ai có quyền lập phiếu cũng xác nhận được.
 */
export function canConfirmIn(actor: AuthUser, keeperIds: string[]): boolean {
  if (actor.isAdmin) return true;
  if (keeperIds.length) return keeperIds.includes(actor.id);
  return actor.permissions.has('warehouse.slip');
}

export const dieInclude = {
  holder: { select: { id: true, name: true } },
  location: { select: { id: true, code: true } },
} satisfies Prisma.WhDieInclude;

export type DieWithPlace = Prisma.WhDieGetPayload<{ include: typeof dieInclude }>;

export function placeOf(d: { holder: { name: string } | null; location: { code: string } | null }): string {
  if (d.holder) return d.holder.name;
  return d.location ? `Kho · ${d.location.code}` : 'Kho Âu Việt';
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
    holderId: d.holderId,
    locationId: d.locationId,
    expectedBackOn: back,
    overdue: !!back && back < today && (d.status === 'IN_USE' || d.status === 'REPAIRING'),
    needsReview: d.needsReview,
    reviewNote: d.reviewNote,
  };
}

export function dieSearchText(d: { code: string; productName: string; customerName?: string | null; sizeText?: string | null; note?: string | null }, size: string | null): string {
  return toSearchText(d.code, d.productName, d.customerName, size, d.sizeText, d.note);
}
