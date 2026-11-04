import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Col, Flex, Form, Input, InputNumber, Row, Select, Typography, type FormInstance } from 'antd';
import type { Schemas } from '../api/client';
import { useProducts } from '../api/hooks';
import { formatVnd, vndInputProps } from '../lib/format';

/** One editable line. `price` is per m² for products priced per m², otherwise per unit. */
export interface LineValue {
  id?: string;
  productId?: string;
  description?: string;
  spec?: string;
  unit?: string;
  widthM?: number;
  heightM?: number;
  quantity?: number;
  price?: number;
}

type Product = Schemas['ProductDto'];

/** Price of one piece of w × h m, same rounding as the server. */
export function piecePrice(widthM: number, heightM: number, pricePerM2: number): number {
  return Math.round((Math.round(widthM * 100) * Math.round(heightM * 100) * pricePerM2) / 10000);
}

export function isAreaLine(line: LineValue, product: Product | undefined): boolean {
  return product ? product.pricingMode === 'AREA' : line.widthM != null && line.heightM != null;
}

/** Amount of a line as the server will compute it; null while incomplete. */
export function lineAmount(line: LineValue | undefined, product: Product | undefined): number | null {
  if (!line?.quantity) return null;
  const price = line.price ?? product?.unitPriceVnd;
  if (price == null) return null;
  if (isAreaLine(line, product)) {
    if (!line.widthM || !line.heightM) return null;
    return piecePrice(line.widthM, line.heightM, price) * line.quantity;
  }
  return price * line.quantity;
}

export function useProductMap() {
  const { data } = useProducts();
  const products = data ?? [];
  return { products, byId: new Map(products.map((p) => [p.id, p])) };
}

interface Props {
  form: FormInstance;
  showMoney: boolean;
  /** Lowest allowed quantity per row (e.g. what is already on delivery trips) */
  minQty?: (line: LineValue) => number;
  /** Whether a row may be deleted */
  canRemove?: (line: LineValue) => boolean;
  idPrefix: string;
}

/**
 * Lines picked from the catalog or typed by hand. Products priced per m² ask for width × height and price each piece
 * from its size; the server recomputes every amount, this screen only previews it.
 */
export function LineItemsEditor({ form, showMoney, minQty, canRemove, idPrefix }: Props) {
  const { products, byId } = useProductMap();
  const lines = (Form.useWatch('lines', form) as LineValue[] | undefined) ?? [];

  const categories = [...new Set(products.map((p) => p.category))];
  const options = (current?: string) =>
    categories.map((c) => ({
      label: c,
      options: products
        .filter((p) => p.category === c && (p.isActive || p.id === current))
        .map((p) => ({ value: p.id, label: p.name, disabled: !p.isActive && p.id !== current })),
    }));

  function pickProduct(index: number, productId: string | undefined) {
    const line: LineValue = form.getFieldValue(['lines', index]) ?? {};
    // The form already holds the new product id; the previous one is in the last rendered values.
    const previousId = lines[index]?.productId;
    const before = previousId ? byId.get(previousId) : undefined;
    const product = productId ? byId.get(productId) : undefined;
    const next: LineValue = { ...line, productId, price: undefined };
    if (product && (!line.description || line.description === before?.name)) next.description = product.name;
    if (product?.pricingMode === 'UNIT') {
      next.unit = product.unit;
      next.widthM = undefined;
      next.heightM = undefined;
    }
    form.setFieldValue(['lines', index], next);
  }

  return (
    <Form.List name="lines">
      {(fields, { add, remove }) => (
        <>
          {fields.map((f, i) => {
            const line = lines[f.name] ?? {};
            const product = line.productId ? byId.get(line.productId) : undefined;
            const area = isAreaLine(line, product);
            const amount = lineAmount(line, product);
            const min = Math.max(1, minQty?.(line) ?? 1);
            const removable = fields.length > 1 && (canRemove?.(line) ?? true);
            const label = (text: string) => (i === 0 ? text : undefined);
            return (
              <Row key={f.key} gutter={8} align="top" style={{ borderBottom: '1px dashed #e5e9ee', marginBottom: 8 }}>
                <Form.Item name={[f.name, 'id']} hidden>
                  <Input />
                </Form.Item>
                <Col xs={24} md={5}>
                  <Form.Item name={[f.name, 'productId']} label={label('Sản phẩm')}>
                    <Select
                      id={`${idPrefix}-${i}-product`}
                      allowClear
                      showSearch={{ optionFilterProp: 'label' }}
                      placeholder="Danh mục / nhập tay"
                      options={options(line.productId)}
                      onChange={(v) => pickProduct(f.name, v)}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={6}>
                  <Form.Item name={[f.name, 'description']} label={label('Tên hạng mục')} rules={[{ required: true, whitespace: true, message: 'Nhập tên' }]} style={{ marginBottom: 4 }}>
                    <Input id={`${idPrefix}-${i}-desc`} maxLength={300} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'spec']}>
                    <Input id={`${idPrefix}-${i}-spec`} size="small" placeholder="Quy cách, gia công (không bắt buộc)" maxLength={1000} />
                  </Form.Item>
                </Col>
                <Col xs={24} md={4}>
                  {area ? (
                    <Form.Item label={label('Kích thước (m)')} required style={{ marginBottom: 0 }}>
                      <Flex gap={4} align="flex-start">
                        <Form.Item name={[f.name, 'widthM']} rules={[{ required: true, message: 'Rộng' }]} style={{ flex: 1 }}>
                          <InputNumber id={`${idPrefix}-${i}-w`} aria-label="Rộng (m)" placeholder="Rộng" min={0.01} max={100} step={0.1} precision={2} decimalSeparator="," style={{ width: '100%' }} />
                        </Form.Item>
                        <span style={{ paddingTop: 5 }}>×</span>
                        <Form.Item name={[f.name, 'heightM']} rules={[{ required: true, message: 'Cao' }]} style={{ flex: 1 }}>
                          <InputNumber id={`${idPrefix}-${i}-h`} aria-label="Cao (m)" placeholder="Cao" min={0.01} max={100} step={0.1} precision={2} decimalSeparator="," style={{ width: '100%' }} />
                        </Form.Item>
                      </Flex>
                    </Form.Item>
                  ) : product ? (
                    <Form.Item label={label('Kích thước (m)')}>
                      <Typography.Text type="secondary">Tính theo {product.unit}</Typography.Text>
                    </Form.Item>
                  ) : (
                    <Form.Item name={[f.name, 'unit']} label={label('Đơn vị tính')}>
                      <Input id={`${idPrefix}-${i}-unit`} placeholder="cái" maxLength={20} />
                    </Form.Item>
                  )}
                </Col>
                <Col xs={8} md={2}>
                  <Form.Item
                    name={[f.name, 'quantity']}
                    label={label('Số lượng')}
                    extra={min > 1 ? `Tối thiểu ${min}` : undefined}
                    rules={[{ required: true, message: 'Nhập SL' }]}
                  >
                    <InputNumber id={`${idPrefix}-${i}-qty`} min={min} precision={0} style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                {showMoney && (
                  <>
                    <Col xs={12} md={3}>
                      <Form.Item
                        name={[f.name, 'price']}
                        label={label('Đơn giá')}
                        extra={area ? 'đ / m²' : undefined}
                        rules={product ? [] : [{ required: true, message: 'Nhập giá' }]}
                      >
                        <InputNumber
                          id={`${idPrefix}-${i}-price`}
                          {...vndInputProps}
                          placeholder={product?.unitPriceVnd != null ? formatVnd(product.unitPriceVnd) : undefined}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={10} md={3} style={{ paddingTop: i === 0 ? 34 : 6, textAlign: 'right' }}>
                      <Typography.Text strong>{formatVnd(amount)}</Typography.Text>
                      {area && line.widthM && line.heightM && line.quantity ? (
                        <div style={{ fontSize: 12, opacity: 0.65 }}>{String(Math.round(line.widthM * line.heightM * line.quantity * 100) / 100).replace('.', ',')} m²</div>
                      ) : null}
                    </Col>
                  </>
                )}
                <Col xs={2} md={1} style={{ paddingTop: i === 0 ? 30 : 0 }}>
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="Xoá dòng"
                    disabled={!removable}
                    title={!removable && fields.length > 1 ? 'Mặt hàng đã có trong chuyến giao' : undefined}
                    onClick={() => remove(f.name)}
                  />
                </Col>
              </Row>
            );
          })}
          <Button icon={<PlusOutlined />} onClick={() => add({ quantity: 1 })}>
            Thêm dòng
          </Button>
        </>
      )}
    </Form.List>
  );
}

/** Sum of the previews; null if a line is incomplete. */
export function linesTotal(lines: LineValue[] | undefined, byId: Map<string, Product>): number | null {
  let total = 0;
  for (const l of lines ?? []) {
    const a = lineAmount(l, l.productId ? byId.get(l.productId) : undefined);
    if (a === null) return null;
    total += a;
  }
  return total;
}
