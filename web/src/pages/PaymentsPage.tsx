import { DollarOutlined } from '@ant-design/icons';
import { Button, Card, Col, DatePicker, Flex, Input, Row, Segmented, Select, Space, Statistic, Switch, Table, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Schemas } from '../api/client';
import { useOrder, usePayments, useReceivables } from '../api/hooks';
import { DocsDownload } from '../components/PrintMenu';
import { PaymentModal } from '../components/PaymentModal';
import { OrderStatusTag } from '../components/Tags';
import { useCan } from '../lib/access';
import { formatDate, formatDateTime, formatVnd } from '../lib/format';
import { PAYMENT_METHOD } from '../lib/status';

type View = 'debt' | 'receipts';

/** "Thanh toán & công nợ": who still owes money, and every receipt. Payments are optional at any step. */
export function PaymentsPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View | null) ?? 'debt';
  const [q, setQ] = useState('');
  const rec = useReceivables({ q: q || undefined });
  const month = useMonthReceipts();

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Thanh toán & công nợ
      </Typography.Title>
      <Row gutter={[12, 12]}>
        <Kpi title="Đã thu tháng này" value={month.data?.sumVnd} note={`${month.data?.total ?? 0} khoản thu`} />
        <Kpi title="Công nợ đơn đã giao" value={rec.data?.deliveredBalanceVnd} note="cần thu ngay" />
        <Kpi title="Còn phải thu đơn chưa giao" value={rec.data?.upcomingBalanceVnd} note="thu khi giao hàng" />
        <Kpi title="Tiền cọc đang giữ" value={rec.data?.depositsHeldVnd} note="của đơn chưa giao" />
      </Row>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Segmented<View>
          value={view}
          onChange={(v) => setParams({ view: v })}
          options={[
            { value: 'debt', label: `Công nợ (${rec.data?.items.length ?? 0})` },
            { value: 'receipts', label: 'Khoản thu' },
          ]}
        />
        <Input.Search id="payments-search" placeholder="Mã đơn, khách hàng, SĐT" allowClear onSearch={(v) => setQ(v.trim())} style={{ width: 280 }} />
      </Flex>
      {view === 'debt' ? <DebtTable data={rec.data} loading={rec.isFetching} /> : <Receipts q={q} />}
    </Flex>
  );
}

function useMonthReceipts() {
  const from = dayjs().startOf('month').format('YYYY-MM-DD');
  return usePayments({ from, pageSize: 1 });
}

function Kpi({ title, value, note }: { title: string; value: number | undefined; note: string }) {
  return (
    <Col xs={12} md={6}>
      <Card size="small">
        <Statistic title={title} value={value === undefined ? '…' : formatVnd(value)} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {note}
        </Typography.Text>
      </Card>
    </Col>
  );
}

function DebtTable({ data, loading }: { data: Schemas['ReceivableListDto'] | undefined; loading: boolean }) {
  const can = useCan();
  const [paying, setPaying] = useState<string | null>(null);
  const [deliveredOnly, setDeliveredOnly] = useState(false);
  const rows = (data?.items ?? []).filter((r) => !deliveredOnly || r.delivered);
  return (
    <>
      <Space>
        <Switch id="debt-delivered" size="small" checked={deliveredOnly} onChange={setDeliveredOnly} />
        <label htmlFor="debt-delivered">Chỉ đơn đã giao hàng</label>
      </Space>
      <Table<Schemas['ReceivableDto']>
        rowKey="orderId"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 30, hideOnSinglePage: true }}
        scroll={{ x: 960 }}
        locale={{ emptyText: 'Không có đơn nào còn nợ' }}
        columns={[
          { title: 'Đơn', dataIndex: 'orderCode', width: 150, render: (v: string, r) => <Link to={`/orders/${r.orderId}`} style={{ whiteSpace: 'nowrap' }}>{v}</Link> },
          { title: 'Khách hàng', key: 'c', render: (_, r) => <><Link to={`/customers/${r.customerId}`}>{r.customerName}</Link><div style={{ fontSize: 12, opacity: 0.65 }}>{r.customerPhone}</div></> },
          { title: 'Ngày đặt', dataIndex: 'orderDate', width: 120, render: formatDate },
          {
            title: 'Tình trạng',
            key: 's',
            width: 200,
            render: (_, r) => (
              <Space size={4} wrap>
                <OrderStatusTag status={r.orderStatus} />
                {r.delivered ? <Tag color="red">Đã giao · cần thu</Tag> : <Tag>Chưa giao</Tag>}
              </Space>
            ),
          },
          { title: 'Tổng', dataIndex: 'totalVnd', width: 130, align: 'right', render: formatVnd },
          { title: 'Đã thu', dataIndex: 'paidVnd', width: 130, align: 'right', render: formatVnd },
          { title: 'Còn lại', dataIndex: 'balanceVnd', width: 140, align: 'right', render: (v: number) => <strong>{formatVnd(v)}</strong> },
          {
            title: '',
            key: 'a',
            width: 120,
            fixed: 'right',
            render: (_, r) => (
              <Space size={4}>
                {can('payments.create') && (
                  <Button size="small" icon={<DollarOutlined />} onClick={() => setPaying(r.orderId)}>
                    Thu
                  </Button>
                )}
                <DocsDownload docs={[{ kind: 'invoice', sourceId: r.orderId, label: 'Hoá đơn bán hàng' }]} code={r.orderCode} />
              </Space>
            ),
          },
        ]}
      />
      {paying && <PayOrder orderId={paying} onClose={() => setPaying(null)} />}
    </>
  );
}

/** Loads the order, then opens the usual payment dialog for it. */
function PayOrder({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { data } = useOrder(orderId);
  return data ? <PaymentModal open order={data} onClose={onClose} /> : null;
}

function Receipts({ q }: { q: string }) {
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>([dayjs().startOf('month'), dayjs()]);
  const [method, setMethod] = useState<Schemas['PaymentMethod'] | undefined>();
  const [voided, setVoided] = useState(false);
  const [page, setPage] = useState(1);
  const { data, isFetching } = usePayments({
    q: q || undefined,
    from: range?.[0].format('YYYY-MM-DD'),
    to: range?.[1].format('YYYY-MM-DD'),
    method,
    includeVoided: voided || undefined,
    page,
    pageSize: 30,
  });
  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={12} align="center">
        <DatePicker.RangePicker id="receipts-range" format="DD/MM/YYYY" value={range} onChange={(v) => { setRange(v as [Dayjs, Dayjs] | null); setPage(1); }} allowEmpty={[true, true]} />
        <Select
          id="receipts-method"
          allowClear
          placeholder="Mọi hình thức"
          style={{ width: 170 }}
          value={method}
          onChange={(v) => { setMethod(v); setPage(1); }}
          options={Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label }))}
        />
        <Space>
          <Switch id="receipts-voided" size="small" checked={voided} onChange={setVoided} />
          <label htmlFor="receipts-voided">Hiện khoản đã huỷ</label>
        </Space>
        <Typography.Text>
          Tổng: <strong>{formatVnd(data?.sumVnd ?? 0)}</strong> · {data?.total ?? 0} khoản
        </Typography.Text>
      </Flex>
      <Table<Schemas['PaymentListItemDto']>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.items}
        scroll={{ x: 900 }}
        rowClassName={(p) => (p.voidedAt ? 'row-voided' : '')}
        pagination={{ current: page, pageSize: 30, total: data?.total, showSizeChanger: false, onChange: setPage }}
        locale={{ emptyText: 'Không có khoản thu nào' }}
        columns={[
          { title: 'Ngày', dataIndex: 'paidOn', width: 120, render: formatDate },
          { title: 'Đơn', dataIndex: 'orderCode', width: 150, render: (v: string, p) => <Link to={`/orders/${p.orderId}`} style={{ whiteSpace: 'nowrap' }}>{v}</Link> },
          { title: 'Khách hàng', dataIndex: 'customerName' },
          { title: 'Số tiền', dataIndex: 'amountVnd', width: 140, align: 'right', render: (v: number, p) => (p.voidedAt ? <Typography.Text delete>{formatVnd(v)}</Typography.Text> : <strong>{formatVnd(v)}</strong>) },
          { title: 'Hình thức', dataIndex: 'method', width: 120, render: (m: Schemas['PaymentMethod']) => PAYMENT_METHOD[m] },
          { title: 'Loại', key: 'k', width: 140, render: (_, p) => (p.isDeposit ? <Tag>Cọc</Tag> : p.deliveryCode ? `Thu khi giao ${p.deliveryCode}` : 'Thu tiền') },
          { title: 'Người ghi', key: 'by', width: 170, render: (_, p) => <>{p.recordedByName}<div style={{ fontSize: 12, opacity: 0.65 }}>{formatDateTime(p.createdAt)}</div></> },
          { title: 'Ghi chú', key: 'n', render: (_, p) => (p.voidedAt ? <Typography.Text type="secondary">Đã huỷ: {p.voidReason}</Typography.Text> : p.note) },
        ]}
      />
    </Flex>
  );
}
