import { PricingMode } from '../generated/prisma/enums';
import { DomainError } from '../common/errors/domain-error';

/** What the client sends for one quote or order line. */
export interface LineInput {
  productId?: string | null;
  description?: string | null;
  spec?: string | null;
  unit?: string | null;
  widthM?: number | null;
  heightM?: number | null;
  quantity: number;
  /** AREA lines: price per m² (defaults to the catalog price). Other lines: price per unit. */
  unitPriceVnd?: number | null;
}

export interface ProductInfo {
  id: string;
  name: string;
  pricingMode: PricingMode;
  unit: string;
  unitPriceVnd: bigint;
}

export interface PricedLine {
  productId: string | null;
  description: string;
  spec: string | null;
  unit: string;
  widthM: number | null;
  heightM: number | null;
  /** price per m², AREA lines only */
  areaPriceVnd: bigint | null;
  quantity: number;
  /** price of one piece / unit */
  unitPriceVnd: bigint;
  lineTotalVnd: bigint;
}

export const AREA_UNIT = 'tấm';
const MAX_SIDE_M = 100;

/** Size in centimetres, so prices are computed with integers only. */
function toCm(value: number | null | undefined, field: string, index: number): bigint {
  if (value === null || value === undefined || !Number.isFinite(value) || value <= 0 || value > MAX_SIDE_M) {
    throw DomainError.badRequest('LINE_SIZE_REQUIRED', `Line ${index + 1}: ${field} must be between 0 and ${MAX_SIDE_M} m`, { index });
  }
  return BigInt(Math.round(value * 100));
}

/** One piece of w × h m at a price per m², rounded to the nearest đồng. */
export function piecePrice(widthCm: bigint, heightCm: bigint, areaPriceVnd: bigint): bigint {
  return (widthCm * heightCm * areaPriceVnd + 5000n) / 10000n;
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/**
 * Turn client input into a stored line. Catalog lines take name, unit and list price from the product
 * unless the client overrides them; AREA products price each piece from its size.
 */
export function priceLine(input: LineInput, product: ProductInfo | undefined, index: number): PricedLine {
  const spec = clean(input.spec);
  if (product?.pricingMode === PricingMode.AREA) {
    const w = toCm(input.widthM, 'width', index);
    const h = toCm(input.heightM, 'height', index);
    const areaPriceVnd = input.unitPriceVnd !== null && input.unitPriceVnd !== undefined ? BigInt(input.unitPriceVnd) : product.unitPriceVnd;
    const unitPriceVnd = piecePrice(w, h, areaPriceVnd);
    return {
      productId: product.id,
      description: clean(input.description) ?? product.name,
      spec,
      unit: AREA_UNIT,
      widthM: Number(w) / 100,
      heightM: Number(h) / 100,
      areaPriceVnd,
      quantity: input.quantity,
      unitPriceVnd,
      lineTotalVnd: unitPriceVnd * BigInt(input.quantity),
    };
  }
  if (product) {
    const unitPriceVnd = input.unitPriceVnd !== null && input.unitPriceVnd !== undefined ? BigInt(input.unitPriceVnd) : product.unitPriceVnd;
    return {
      productId: product.id,
      description: clean(input.description) ?? product.name,
      spec,
      unit: product.unit,
      widthM: null,
      heightM: null,
      areaPriceVnd: null,
      quantity: input.quantity,
      unitPriceVnd,
      lineTotalVnd: unitPriceVnd * BigInt(input.quantity),
    };
  }
  const description = clean(input.description);
  if (!description) throw DomainError.badRequest('LINE_DESCRIPTION_REQUIRED', `Line ${index + 1}: enter a description or pick a product`, { index });
  if (input.unitPriceVnd === null || input.unitPriceVnd === undefined) {
    throw DomainError.badRequest('LINE_PRICE_REQUIRED', `Line ${index + 1}: enter a price`, { index });
  }
  const unitPriceVnd = BigInt(input.unitPriceVnd);
  return {
    productId: null,
    description,
    spec,
    unit: clean(input.unit) ?? 'cái',
    widthM: null,
    heightM: null,
    areaPriceVnd: null,
    quantity: input.quantity,
    unitPriceVnd,
    lineTotalVnd: unitPriceVnd * BigInt(input.quantity),
  };
}

/** "Decal PP in UV 1,2×0,8 m": the name the workshop and delivery screens see on the order. */
export function orderLineDescription(line: Pick<PricedLine, 'description' | 'widthM' | 'heightM'>): string {
  if (line.widthM === null || line.heightM === null) return line.description;
  const f = (n: number) => String(n).replace('.', ',');
  return `${line.description} ${f(line.widthM)}×${f(line.heightM)} m`;
}
