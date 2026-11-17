import { DomainError } from '../common/errors/domain-error';
import { formatDateOnly } from '../common/utils/dates';
import { toSearchText } from '../common/utils/vn-text';
import type { Prisma } from '../generated/prisma/client';
import type { Tx } from '../prisma/prisma.service';
import { fmtCm } from './die-rules';
import type { DieRowDto } from './warehouse.dto';

export const n = (v: Prisma.Decimal | number | null | undefined): number => (v === null || v === undefined ? 0 : Number(v));
export const nn = (v: Prisma.Decimal | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

export function itemLabel(m: { name: string; hasSizes: boolean }, i: { widthCm: Prisma.Decimal | number; lengthCm: Prisma.Decimal | number }): string {
  const w = n(i.widthCm);
  const l = n(i.lengthCm);
  return m.hasSizes && (w || l) ? `${m.name} · ${fmtCm(w)} x ${fmtCm(l)}` : m.name;
}

/** Phiếu trong tháng đã chốt tồn không lập / huỷ được */
export async function assertMonthOpen(tx: Tx, ymd: string): Promise<void> {
  const month = ymd.slice(0, 7);
  if (await tx.whMonthLock.findUnique({ where: { month } })) {
    throw DomainError.badRequest('WH_MONTH_LOCKED', `Month ${month} is locked for warehouse slips`, { month });
  }
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

type Dim = Prisma.Decimal | number | null;
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
