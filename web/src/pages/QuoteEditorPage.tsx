import { App, Button, Card, Col, Flex, Form, Input, InputNumber, Result, Row, Space, Spin, Typography } from 'antd';
import { useEffect } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { Schemas } from '../api/client';
import { useQuote, useQuoteMutations } from '../api/hooks';
import { CustomerSelect } from '../components/CustomerSelect';
import { LineItemsEditor, linesTotal, useProductMap, type LineValue } from '../components/LineItemsEditor';
import { useCan } from '../lib/access';
import { errorMessage } from '../lib/errors';
import { formatVnd } from '../lib/format';

interface FormValues {
  customerId: string;
  title?: string;
  validDays: number;
  note?: string;
  lines: LineValue[];
}

/** Turn editor rows into the API shape: `price` is per m² for catalog products priced per m², otherwise per unit. */
export function toQuoteLines(lines: LineValue[]): Schemas['QuoteLineInputDto'][] {
  return lines.map((l) => ({
    productId: l.productId ?? null,
    description: l.description?.trim(),
    spec: l.spec?.trim() || undefined,
    unit: l.productId ? undefined : l.unit?.trim() || undefined,
    widthM: l.widthM ?? null,
    heightM: l.heightM ?? null,
    quantity: l.quantity ?? 1,
    unitPriceVnd: l.price ?? null,
  }));
}

/** New quote (/quotes/new, optionally ?customerId=) or edit an open one (/quotes/:id/edit). */
export function QuoteEditorPage() {
  const { id } = useParams();
  const { data: quote, isLoading } = useQuote(id ?? '', !!id);
  if (id && isLoading) return <Spin />;
  if (id && quote && (quote.status === 'WON' || quote.status === 'LOST')) {
    return <Result status="info" title={`${quote.code} không sửa được`} subTitle={quote.status === 'WON' ? 'Báo giá đã chốt thành đơn. Sửa hàng hoá ở đơn hàng.' : 'Mở lại báo giá trước khi sửa.'} extra={<Link to={`/quotes/${quote.id}`}>Về báo giá</Link>} />;
  }
  return <QuoteForm quote={quote ?? null} />;
}

function QuoteForm({ quote }: { quote: Schemas['QuoteDto'] | null }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<FormValues>();
  const { create, update } = useQuoteMutations();
  const showMoney = useCan()('money.view');
  const { byId } = useProductMap();
  const lines = Form.useWatch('lines', form) as LineValue[] | undefined;
  const total = linesTotal(lines, byId);
  const customerFromUrl = new URLSearchParams(window.location.search).get('customerId') ?? undefined;

  useEffect(() => {
    if (!quote) return;
    form.setFieldsValue({
      customerId: quote.customer.id,
      title: quote.title ?? undefined,
      validDays: quote.validDays,
      note: quote.note ?? undefined,
      lines: quote.lines.map((l) => ({
        productId: l.productId ?? undefined,
        description: l.description,
        spec: l.spec ?? undefined,
        unit: l.unit,
        widthM: l.widthM ?? undefined,
        heightM: l.heightM ?? undefined,
        quantity: l.quantity,
        price: (l.widthM !== null ? l.areaPriceVnd : l.unitPriceVnd) ?? undefined,
      })),
    });
  }, [quote, form]);

  async function save() {
    const v = await form.validateFields();
    const body: Schemas['SaveQuoteDto'] = { customerId: v.customerId, title: v.title?.trim() || undefined, validDays: v.validDays, note: v.note?.trim() || undefined, lines: toQuoteLines(v.lines) };
    try {
      const saved = quote ? await update.mutateAsync({ id: quote.id, body }) : await create.mutateAsync(body);
      message.success(quote ? 'Đã lưu báo giá' : `Đã lập báo giá ${saved.code}`);
      navigate(`/quotes/${saved.id}`);
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        {quote ? `Sửa báo giá ${quote.code}` : 'Lập báo giá'}
      </Typography.Title>
      <Form form={form} layout="vertical" initialValues={{ validDays: 7, customerId: customerFromUrl, lines: [{ quantity: 1 }] }}>
        <Flex vertical gap={16}>
          <Card size="small" title="Khách hàng">
            <Row gutter={16}>
              <Col xs={24} md={10}>
                <Form.Item name="customerId" label="Khách hàng" rules={[{ required: true, message: 'Chọn khách hàng' }]}>
                  <CustomerSelect />
                </Form.Item>
              </Col>
              <Col xs={24} md={10}>
                <Form.Item name="title" label="Nội dung báo giá">
                  <Input id="quote-title" placeholder="VD: Biển hiệu mặt tiền + decal kính" maxLength={300} />
                </Form.Item>
              </Col>
              <Col xs={12} md={4}>
                <Form.Item name="validDays" label="Hiệu lực (ngày)" rules={[{ required: true, message: 'Nhập số ngày' }]}>
                  <InputNumber id="quote-valid" min={1} max={365} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              </Col>
            </Row>
          </Card>
          <Card size="small" title="Hạng mục" extra={<Typography.Text type="secondary">Giá chưa gồm VAT</Typography.Text>}>
            <LineItemsEditor form={form} showMoney={showMoney} idPrefix="quote-line" />
            {showMoney && (
              <Flex justify="flex-end" style={{ marginTop: 12 }}>
                <Typography.Title level={4} style={{ margin: 0 }}>
                  Tổng cộng: {formatVnd(total)}
                </Typography.Title>
              </Flex>
            )}
          </Card>
          <Card size="small">
            <Form.Item name="note" label="Ghi chú in trên báo giá" style={{ marginBottom: 0 }}>
              <Input.TextArea id="quote-note" rows={2} maxLength={2000} placeholder="VD: Đã gồm lắp đặt nội thành" />
            </Form.Item>
          </Card>
          <Space>
            <Button type="primary" onClick={save} loading={create.isPending || update.isPending}>
              {quote ? 'Lưu báo giá' : 'Lập báo giá'}
            </Button>
            <Button onClick={() => navigate(quote ? `/quotes/${quote.id}` : '/quotes')}>Huỷ</Button>
          </Space>
        </Flex>
      </Form>
    </Flex>
  );
}
