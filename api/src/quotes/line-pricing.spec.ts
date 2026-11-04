import { PricingMode } from '../generated/prisma/enums';
import { DomainError } from '../common/errors/domain-error';
import { orderLineDescription, piecePrice, priceLine, type ProductInfo } from './line-pricing';

const decal: ProductInfo = { id: 'p1', name: 'Decal PP in UV', pricingMode: PricingMode.AREA, unit: 'm²', unitPriceVnd: 180000n };
const standee: ProductInfo = { id: 'p2', name: 'Standee chữ X', pricingMode: PricingMode.UNIT, unit: 'bộ', unitPriceVnd: 250000n };

describe('line pricing', () => {
  it('prices an AREA line per piece from its size', () => {
    const l = priceLine({ productId: 'p1', widthM: 1.2, heightM: 0.8, quantity: 4 }, decal, 0);
    expect(l).toMatchObject({ unit: 'tấm', widthM: 1.2, heightM: 0.8, areaPriceVnd: 180000n, unitPriceVnd: 172800n, lineTotalVnd: 691200n, description: 'Decal PP in UV' });
  });

  it('rounds one piece to the nearest đồng', () => {
    expect(piecePrice(33n, 33n, 65000n)).toBe(7079n); // 0,33 × 0,33 × 65.000 = 7.078,5
  });

  it('lets the price per m² be overridden', () => {
    const l = priceLine({ productId: 'p1', widthM: 2, heightM: 1, quantity: 1, unitPriceVnd: 150000 }, decal, 0);
    expect(l.unitPriceVnd).toBe(300000n);
  });

  it('requires a size for AREA products', () => {
    expect(() => priceLine({ productId: 'p1', widthM: 0, heightM: 1, quantity: 1 }, decal, 2)).toThrow(DomainError);
    try { priceLine({ productId: 'p1', quantity: 1 }, decal, 2); } catch (e) { expect((e as DomainError).code).toBe('LINE_SIZE_REQUIRED'); }
  });

  it('prices UNIT products per unit and ignores sizes', () => {
    const l = priceLine({ productId: 'p2', widthM: 3, heightM: 3, quantity: 2 }, standee, 0);
    expect(l).toMatchObject({ unit: 'bộ', widthM: null, unitPriceVnd: 250000n, lineTotalVnd: 500000n });
  });

  it('needs description and price on free-text lines', () => {
    expect(priceLine({ description: ' Lắp đặt ', quantity: 1, unitPriceVnd: 500000 }, undefined, 0)).toMatchObject({ description: 'Lắp đặt', unit: 'cái', lineTotalVnd: 500000n });
    expect(() => priceLine({ quantity: 1, unitPriceVnd: 1 }, undefined, 0)).toThrow(DomainError);
    expect(() => priceLine({ description: 'X', quantity: 1 }, undefined, 0)).toThrow(DomainError);
  });

  it('adds the size to the order line name', () => {
    expect(orderLineDescription({ description: 'Decal', widthM: 1.2, heightM: 0.8 })).toBe('Decal 1,2×0,8 m');
    expect(orderLineDescription({ description: 'Standee', widthM: null, heightM: null })).toBe('Standee');
  });
});
