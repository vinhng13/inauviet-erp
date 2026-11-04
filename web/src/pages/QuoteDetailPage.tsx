import { CheckCircleOutlined, DownloadOutlined, EditOutlined, FilePdfOutlined, SendOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Col, DatePicker, Descriptions, Flex, Form, Input, Modal, Result, Row, Skeleton, Space, Table, Tag, Timeline, Tooltip, Typography } from 'antd';
import type dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ApiError, type Schemas } from '../api/client';
import { useQuote, useQuoteActivity, useQuoteMutations } from '../api/hooks';
import { printDoc } from '../components/OrderSteps';
import { useDownload } from '../components/PrintMenu';
import { downloadDoc } from '../lib/download';
import { ReasonModal } from '../components/ReasonModal';
import { useCan } from '../lib/access';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime, formatVnd } from '../lib/format';
import { ACTIVITY_LABEL, QUOTE_STATUS } from '../lib/status';

type Quote = Schemas['QuoteDto'];
type Line = Schemas['QuoteLineDto'];
const dec = (n: number | null) => (n === null ? '' : String(n).replace('.', ','));

export function QuoteDetailPage() {
  const { id = '' } = useParams();
  const { data: quote, isLoading, error } = useQuote(id);
  if (isLoading) return <Skeleton active />;
  if (!quote) {
    return <Result status="404" title="Không tìm thấy báo giá" subTitle={error instanceof ApiError ? errorMessage(error) : undefined} extra={<Link to="/quotes">Về danh sách báo giá</Link>} />;
  }
  return <QuoteView quote={quote} />;
}

function QuoteView({ quote }: { quote: Quote }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const can = useCan();
  const showMoney = can('money.view');
  const m = useQuoteMutations();
 const [modal, setModal] = useState<null | 'lose' | 'close'>(null);
  const dl = useDownload();
  const open = quote.status === 'DRAFT' || quote.status === 'SENT';

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      message.success(ok);
      setModal(null);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Flex vertical gap={16} style={{ maxWidth: 1200 }}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Space wrap align="center">
          <Typography.Title level={3} style={{ margin: 0 }}>
            {quote.code}
          </Typography.Title>
          <Tag color={QUOTE_STATUS[quote.status].color}>{QUOTE_STATUS[quote.status].label}</Tag>
          {quote.isExpired && <Tag color="orange">Hết hiệu lực</Tag>}
        </Space>
        <Space wrap>
          {showMoney && (
            <Space.Compact>
              <Tooltip title="Mở PDF để in (mẫu tạm, sẽ thay bằng biểu mẫu của công ty)">
                <Button icon={<FilePdfOutlined />} onClick={() => printDoc('quote', quote.id)}>
                  In báo giá
                </Button>
              </Tooltip>
              <Tooltip title="Tải file PDF">
                <Button icon={<DownloadOutlined />} loading={dl.busy} aria-label="Tải PDF báo giá" onClick={() => dl.run(() => downloadDoc('quote', quote.id))} />
              </Tooltip>
            </Space.Compact>
          )}
          {open && can('quotes.update') && (
            <Link to={`/quotes/${quote.id}/edit`}>
              <Button icon={<EditOutlined />}>Sửa</Button>
            </Link>
          )}
          {quote.status === 'DRAFT' && can('quotes.update') && (
            <Button icon={<SendOutlined />} loading={m.send.isPending} onClick={() => run(m.send.mutateAsync(quote.id), 'Đã đánh dấu đã gửi khách')}>
              Đã gửi khách
            </Button>
          )}
          {open && can('quotes.update') && (
            <Button danger onClick={() => setModal('lose')}>
              Khách không lấy
            </Button>
          )}
          {quote.status === 'LOST' && can('quotes.update') && (
            <Button loading={m.reopen.isPending} onClick={() => run(m.reopen.mutateAsync(quote.id), 'Đã mở lại báo giá')}>
              Mở lại báo giá
            </Button>
          )}
          {open && can('quotes.close') && (
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => setModal('close')}>
              Khách chốt → tạo đơn
            </Button>
          )}
        </Space>
      </Flex>

      {quote.status === 'WON' && quote.order && (
        <Alert
          type="success"
          showIcon
          title={
            <>
              Đã chốt thành đơn <Link to={`/orders/${quote.order.id}`}>{quote.order.code}</Link> lúc {formatDateTime(quote.wonAt)}. Mọi thay đổi sản phẩm, số lượng sau khi chốt được ghi ở đơn hàng.
            </>
          }
        />
      )}
      {quote.status === 'LOST' && <Alert type="warning" showIcon title={`Khách không lấy (${formatDateTime(quote.lostAt)})`} description={quote.lostReason} />}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Card size="small" title="Thông tin báo giá" style={{ height: '100%' }}>
            <Descriptions
              size="small"
              column={{ xs: 1, sm: 2 }}
              items={[
                { key: 'c', label: 'Khách hàng', children: <Link to={`/customers/${quote.customer.id}`}>{quote.customer.name}</Link> },
                { key: 'p', label: 'Điện thoại', children: quote.customer.phone },
                { key: 't', label: 'Nội dung', children: quote.title ?? '—', span: 'filled' as const },
                { key: 'd', label: 'Ngày lập', children: formatDate(quote.quoteDate) },
                { key: 'v', label: 'Hiệu lực', children: `${quote.validDays} ngày, đến ${formatDate(quote.validUntil)}` },
                { key: 's', label: 'Gửi khách', children: quote.sentAt ? formatDateTime(quote.sentAt) : 'Chưa gửi' },
                { key: 'u', label: 'Người lập', children: quote.createdByName },
                ...(quote.note ? [{ key: 'n', label: 'Ghi chú', children: quote.note, span: 'filled' as const }] : []),
              ]}
            />
          </Card>
        </Col>
        {showMoney && (
          <Col xs={24} lg={8}>
            <Card size="small" title="Giá trị" style={{ height: '100%' }}>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {formatVnd(quote.totalVnd)}
              </Typography.Title>
              <Typography.Text type="secondary">Giá chưa gồm VAT · {quote.lines.length} hạng mục</Typography.Text>
            </Card>
          </Col>
        )}
      </Row>

      <Card size="small" title="Hạng mục">
        <Table<Line>
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={quote.lines}
          scroll={{ x: 760 }}
          columns={[
            { title: '#', key: 'i', width: 40, render: (_, __, i) => i + 1 },
            { title: 'Hạng mục', dataIndex: 'description', render: (v: string, l) => (<>{v}{l.spec && <div style={{ fontSize: 12, opacity: 0.65 }}>{l.spec}</div>}</>) },
            { title: 'Kích thước', key: 'size', width: 120, render: (_, l) => (l.widthM !== null ? `${dec(l.widthM)} × ${dec(l.heightM)} m` : '—') },
            { title: 'SL', key: 'q', width: 90, render: (_, l) => `${l.quantity} ${l.unit}` },
            { title: 'Diện tích', dataIndex: 'areaM2', width: 100, render: (v: number | null) => (v !== null ? `${dec(v)} m²` : '—') },
            ...(showMoney
              ? [
                  { title: 'Đơn giá', key: 'price', width: 150, align: 'right' as const, render: (_: unknown, l: Line) => (l.areaPriceVnd != null ? `${formatVnd(l.areaPriceVnd)}/m²` : `${formatVnd(l.unitPriceVnd)}/${l.unit}`) },
                  { title: 'Thành tiền', dataIndex: 'lineTotalVnd', width: 140, align: 'right' as const, render: (v: number) => <strong>{formatVnd(v)}</strong> },
                ]
              : []),
          ]}
          summary={() =>
            showMoney ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0} colSpan={6}>
                  <strong>Tổng cộng</strong>
                </Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right">
                  <strong>{formatVnd(quote.totalVnd)}</strong>
                </Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
      </Card>

      <Card size="small" title="Lịch sử">
        <History quoteId={quote.id} />
      </Card>

      <ReasonModal
        open={modal === 'lose'}
        title={`Khách không lấy ${quote.code}?`}
        okText="Xác nhận"
        danger
        description="Báo giá chuyển sang “Khách không lấy”. Có thể mở lại khi khách quay lại."
        loading={m.lose.isPending}
        onCancel={() => setModal(null)}
        onSubmit={(reason) => run(m.lose.mutateAsync({ id: quote.id, reason }), 'Đã ghi nhận khách không lấy')}
      />
      <CloseModal
        open={modal === 'close'}
        quote={quote}
        loading={m.close.isPending}
        onCancel={() => setModal(null)}
        onSubmit={async (body) => {
          try {
            const r = await m.close.mutateAsync({ id: quote.id, body });
            message.success(`Đã tạo đơn ${r.orderCode}. Kiểm tra lại hàng hoá với khách ở đơn hàng.`);
            navigate(`/orders/${r.orderId}`);
          } catch (err) {
            message.error(errorMessage(err));
          }
        }}
      />
    </Flex>
  );
}

function CloseModal({ open, quote, loading, onCancel, onSubmit }: { open: boolean; quote: Quote; loading: boolean; onCancel: () => void; onSubmit: (body: Schemas['CloseQuoteDto']) => void }) {
  const [form] = Form.useForm<{ dueDate?: dayjs.Dayjs; note?: string }>();
  return (
    <Modal
      open={open}
      title={`Khách chốt ${quote.code}`}
      okText="Tạo đơn hàng"
      cancelText="Đóng"
      confirmLoading={loading}
      destroyOnHidden
      onCancel={onCancel}
      onOk={() => form.validateFields().then((v) => onSubmit({ dueDate: v.dueDate?.format('YYYY-MM-DD'), note: v.note?.trim() || undefined }))}
    >
      <p>Đơn hàng được tạo với đúng các hạng mục của báo giá. Sau đó vẫn đổi được sản phẩm, số lượng ở đơn; mọi thay đổi đều được ghi lại so với báo giá.</p>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="dueDate" label="Hạn giao">
          <DatePicker id="close-due" format="DD/MM/YYYY" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú đơn" extra="Để trống: dùng ghi chú của báo giá">
          <Input.TextArea id="close-note" rows={2} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function History({ quoteId }: { quoteId: string }) {
  const { data, isLoading } = useQuoteActivity(quoteId);
  if (isLoading) return <Skeleton active />;
  return (
    <Timeline
      style={{ marginTop: 12 }}
      items={(data ?? []).map((a) => {
        const d = (a.data ?? {}) as Record<string, unknown>;
        const status = (v: string | null) => (v ? (QUOTE_STATUS[v as Schemas['QuoteStatus']]?.label ?? v) : '');
        const text =
          a.action === 'STATUS_CHANGED'
            ? `${status(a.fromValue)} → ${status(a.toValue)}${d.orderCode ? ` · đơn ${d.orderCode}` : ''}${d.reason ? ` (${d.reason})` : ''}`
            : (a.toValue ?? '');
        return {
          content: (
            <div>
              <Typography.Text strong>{a.action === 'STATUS_CHANGED' ? 'Đổi trạng thái' : (ACTIVITY_LABEL[a.action] ?? a.action)}</Typography.Text> {text}
              <div style={{ fontSize: 12, opacity: 0.65 }}>
                {formatDateTime(a.createdAt)}
                {a.userName ? ` · ${a.userName}` : ''}
              </div>
            </div>
          ),
        };
      })}
    />
  );
}
