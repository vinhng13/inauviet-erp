import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, DatePicker, Flex, Form, Input, InputNumber, Row, Select, Space, Switch, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useNavigate } from 'react-router';
import type { Schemas } from '../api/client';
import { useCreateOrder } from '../api/hooks';
import { CustomerSelect } from '../components/CustomerSelect';
import { QuantityCheck } from '../components/QuantityCheck';
import { errorMessage } from '../lib/errors';
import { formatVnd, vndInputProps } from '../lib/format';
import { PAYMENT_METHOD } from '../lib/status';
import { useCan } from '../lib/access';

interface LineValues {
  description?: string;
  spec?: string;
  quantity?: number;
  unitPriceVnd?: number | null;
}

interface TripValues {
  plannedDate?: Dayjs;
  address?: string;
  qty?: Record<number, number | null>;
}

interface Values {
  customerId: string;
  orderDate: Dayjs;
  dueDate?: Dayjs;
  note?: string;
  lines: LineValues[];
  trips: TripValues[];
  hasDeposit: boolean;
  depositAmount?: number;
  depositMethod: Schemas['PaymentMethod'];
}

/** New order: customer, lines, a delivery plan (one or more trips) and an optional deposit, saved in one call. */
export function NewOrderPage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<Values>();
  const createOrder = useCreateOrder();
  const can = useCan();
  const showMoney = can('money.view');
  const lines = Form.useWatch('lines', form) ?? [];
  const trips = Form.useWatch('trips', form) ?? [];
  const hasDeposit = Form.useWatch('hasDeposit', form);

  const total = lines.reduce((s, l) => (l?.unitPriceVnd && l.quantity ? s + l.unitPriceVnd * l.quantity : s), 0);
  const priced = lines.some((l) => l?.unitPriceVnd);
  const qtyRows = lines.map((l, i) => ({
    key: String(i),
    description: l?.description || `Mặt hàng ${i + 1}`,
    ordered: l?.quantity ?? 0,
    planned: trips.reduce((s, t) => s + (t?.qty?.[i] ?? 0), 0),
  }));

  async function submit(v: Values) {
    const body: Schemas['CreateOrderDto'] = {
      customerId: v.customerId,
      orderDate: v.orderDate.format('YYYY-MM-DD'),
      dueDate: v.dueDate?.format('YYYY-MM-DD'),
      note: v.note,
      lines: v.lines.map((l) => ({ description: l.description!, spec: l.spec, quantity: l.quantity!, unitPriceVnd: l.unitPriceVnd ?? undefined })),
      deliveries: (v.trips ?? [])
        .map((t) => ({
          plannedDate: t.plannedDate!.format('YYYY-MM-DD'),
          address: t.address,
          lines: Object.entries(t.qty ?? {})
            .filter(([, q]) => q && q > 0)
            .map(([i, q]) => ({ lineIndex: Number(i), plannedQty: q! })),
        }))
        .filter((t) => t.lines.length > 0),
      deposit: v.hasDeposit && v.depositAmount ? { amountVnd: v.depositAmount, method: v.depositMethod } : undefined,
    };
    try {
      const order = await createOrder.mutateAsync(body);
      message.success(`Đã tạo đơn ${order.code}`);
      navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  return (
    <Form<Values>
      form={form}
      layout="vertical"
      onFinish={submit}
      initialValues={{ orderDate: dayjs(), lines: [{}], trips: [], hasDeposit: false, depositMethod: 'BANK_TRANSFER' }}
      style={{ maxWidth: 1040 }}
    >
      <Flex vertical gap={16}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Đơn hàng mới
        </Typography.Title>

        <Card title="Khách hàng">
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item name="customerId" label="Khách hàng" rules={[{ required: true, message: 'Chọn khách hàng' }]}>
                <CustomerSelect
                  onChange={(id, c) => {
                    form.setFieldValue('customerId', id);
                    const t = form.getFieldValue('trips') as TripValues[];
                    if (c?.address) form.setFieldValue('trips', t.map((trip) => ({ ...trip, address: trip.address || c.address })));
                  }}
                />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="orderDate" label="Ngày đặt" rules={[{ required: true }]}>
                <DatePicker id="orderDate" format="DD/MM/YYYY" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={12} md={6}>
              <Form.Item name="dueDate" label="Hạn giao">
                <DatePicker id="dueDate" format="DD/MM/YYYY" style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="note" label="Ghi chú" style={{ marginBottom: 0 }}>
            <Input.TextArea id="note" rows={2} maxLength={2000} />
          </Form.Item>
        </Card>

        <Card title="Hàng hoá" extra={showMoney && priced && <Typography.Text strong>Tổng: {formatVnd(total)}</Typography.Text>}>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <Flex vertical gap={8}>
                {fields.map((f, i) => (
                  <Row key={f.key} gutter={8} align="top">
                    <Col xs={24} md={showMoney ? 8 : 12}>
                      <Form.Item name={[f.name, 'description']} label={i === 0 ? 'Mặt hàng' : undefined} rules={[{ required: true, whitespace: true, message: 'Nhập mặt hàng' }]}>
                        <Input id={`line-${i}-desc`} placeholder="Banner hiflex 2×1 m" maxLength={300} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={showMoney ? 6 : 8}>
                      <Form.Item name={[f.name, 'spec']} label={i === 0 ? 'Quy cách' : undefined}>
                        <Input id={`line-${i}-spec`} placeholder="Chất liệu, gia công" maxLength={1000} />
                      </Form.Item>
                    </Col>
                    <Col xs={showMoney ? 8 : 21} md={3}>
                      <Form.Item name={[f.name, 'quantity']} label={i === 0 ? 'Số lượng' : undefined} rules={[{ required: true, message: 'Nhập SL' }]}>
                        <InputNumber id={`line-${i}-qty`} min={1} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                    {showMoney && (
                      <Col xs={13} md={6}>
                        <Form.Item name={[f.name, 'unitPriceVnd']} label={i === 0 ? 'Đơn giá (không bắt buộc)' : undefined}>
                          <InputNumber id={`line-${i}-price`} {...vndInputProps} style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                    )}
                    <Col xs={3} md={1} style={{ paddingTop: i === 0 ? 30 : 0 }}>
                      <Button type="text" danger icon={<DeleteOutlined />} aria-label="Xoá dòng" disabled={fields.length === 1} onClick={() => remove(f.name)} />
                    </Col>
                  </Row>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => add({})} style={{ alignSelf: 'flex-start' }}>
                  Thêm mặt hàng
                </Button>
              </Flex>
            )}
          </Form.List>
        </Card>

        <Card title="Kế hoạch giao hàng" extra={<Typography.Text type="secondary">Có thể thêm sau</Typography.Text>}>
          <Form.List name="trips">
            {(fields, { add, remove }) => (
              <Flex vertical gap={12}>
                {fields.map((f, ti) => (
                  <Card key={f.key} size="small" type="inner" title={`Chuyến ${ti + 1}`} extra={<Button type="link" danger onClick={() => remove(f.name)}>Bỏ chuyến</Button>}>
                    <Row gutter={12}>
                      <Col xs={24} sm={8}>
                        <Form.Item name={[f.name, 'plannedDate']} label="Ngày giao" rules={[{ required: true, message: 'Chọn ngày' }]}>
                          <DatePicker id={`trip-${ti}-date`} format="DD/MM/YYYY" style={{ width: '100%' }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} sm={16}>
                        <Form.Item name={[f.name, 'address']} label="Địa chỉ">
                          <Input id={`trip-${ti}-address`} maxLength={500} />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={12}>
                      {lines.map((l, li) => (
                        <Col key={li} xs={24} sm={12} md={8}>
                          <Form.Item name={[f.name, 'qty', li]} label={l?.description || `Mặt hàng ${li + 1}`}>
                            <InputNumber id={`trip-${ti}-qty-${li}`} min={0} precision={0} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                      ))}
                    </Row>
                  </Card>
                ))}
                <Space wrap>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => {
                      // Pre-fill what is not yet planned, so a one-trip order is one click.
                      const qty: Record<number, number> = {};
                      qtyRows.forEach((r, i) => {
                        const left = r.ordered - r.planned;
                        if (left > 0) qty[i] = left;
                      });
                      add({ plannedDate: dayjs().add(1, 'day'), qty, address: trips[0]?.address });
                    }}
                  >
                    Thêm chuyến giao
                  </Button>
                </Space>
                {fields.length > 0 && <QuantityCheck rows={qtyRows} />}
              </Flex>
            )}
          </Form.List>
        </Card>

        {can('payments.create') && (
        <Card title="Tiền cọc">
          <Space align="center" style={{ marginBottom: hasDeposit ? 16 : 0 }}>
            <Form.Item name="hasDeposit" valuePropName="checked" noStyle>
              <Switch id="hasDeposit" />
            </Form.Item>
            <label htmlFor="hasDeposit">Khách đã cọc</label>
          </Space>
          {hasDeposit && (
            <Row gutter={12}>
              <Col xs={24} sm={12}>
                <Form.Item name="depositAmount" label="Số tiền cọc" rules={[{ required: true, message: 'Nhập số tiền' }]}>
                  <InputNumber id="depositAmount" {...vndInputProps} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
              <Col xs={24} sm={12}>
                <Form.Item name="depositMethod" label="Hình thức">
                  <Select id="depositMethod" options={Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label }))} />
                </Form.Item>
              </Col>
            </Row>
          )}
        </Card>
        )}

        <Flex gap={8} justify="flex-end">
          <Button onClick={() => navigate(-1)}>Huỷ</Button>
          <Button type="primary" htmlType="submit" loading={createOrder.isPending}>
            Tạo đơn
          </Button>
        </Flex>
      </Flex>
    </Form>
  );
}
