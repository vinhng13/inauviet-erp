import { PrinterOutlined } from '@ant-design/icons';
import { Button, Flex, Input, Space, Table, Tabs, Typography } from 'antd';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Schemas } from '../api/client';
import { useDeliveries, useOrders } from '../api/hooks';
import { AcceptOrderModal, printDoc } from '../components/OrderSteps';
import { DocsDownload } from '../components/PrintMenu';
import { DeliverModal } from '../components/DeliverModal';
import { DeliveryStatusTag } from '../components/Tags';
import { formatDate, formatDateTime, formatQty, formatVnd, todayIso } from '../lib/format';
import dayjs from 'dayjs';
import { useCan } from '../lib/access';

type View = 'today' | 'upcoming' | 'overdue' | 'delivered' | 'accept' | 'accepted';
type Row = Schemas['DeliveryListItemDto'];

/** The driver's day: what goes out today, what's coming, what's late, what's done. */
export function DeliveriesPage() {
  const [params, setParams] = useSearchParams();
  const view = (params.get('view') as View | null) ?? 'today';
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [delivering, setDelivering] = useState<Row | null>(null);
  const today = todayIso();
  const can = useCan();

  const query =
    view === 'today'
      ? { status: 'SCHEDULED' as const, from: today, to: today }
      : view === 'upcoming'
        ? { status: 'SCHEDULED' as const, from: dayjs().add(1, 'day').format('YYYY-MM-DD') }
        : view === 'overdue'
          ? { overdue: true }
          : { status: 'DELIVERED' as const };
  const orderView = view === 'accept' || view === 'accepted';
  const { data, isFetching } = useDeliveries({ ...query, q: q || undefined, page, pageSize: 30 });

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Lịch giao hàng
      </Typography.Title>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Tabs
          activeKey={view}
          onChange={(v) => {
            setPage(1);
            setParams({ view: v });
          }}
          items={[
            { key: 'today', label: 'Hôm nay' },
            { key: 'upcoming', label: 'Sắp tới' },
            { key: 'overdue', label: 'Trễ lịch' },
            { key: 'delivered', label: 'Đã giao' },
            { key: 'accept', label: 'Chờ nghiệm thu' },
            { key: 'accepted', label: 'Đã nghiệm thu' },
          ]}
          style={{ marginBottom: -16 }}
        />
        <Input.Search id="deliveries-search" placeholder="Mã chuyến, mã đơn, khách hàng" allowClear onSearch={(v) => { setQ(v.trim()); setPage(1); }} style={{ width: 280 }} />
      </Flex>
      {orderView ? (
        <AcceptanceList view={view as 'accept' | 'accepted'} q={q} />
      ) : (
      <Table<Row>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.items}
        scroll={{ x: 960 }}
        locale={{ emptyText: view === 'today' ? 'Hôm nay không có chuyến nào' : 'Không có chuyến nào' }}
        pagination={{ current: page, pageSize: 30, total: data?.total, showSizeChanger: false, onChange: setPage }}
        columns={[
          { title: 'Chuyến', dataIndex: 'code', width: 140, render: (v) => <Typography.Text strong>{v}</Typography.Text> },
          { title: view === 'delivered' ? 'Đã giao' : 'Ngày dự kiến', width: 140, render: (_, d) => (d.status === 'DELIVERED' ? formatDateTime(d.deliveredAt) : formatDate(d.plannedDate)) },
          { title: 'Đơn', dataIndex: 'orderCode', width: 140, render: (v, d) => <Link to={`/orders/${d.orderId}`}>{v}</Link> },
          { title: 'Khách hàng', render: (_, d) => <div>{d.customerName}<div style={{ fontSize: 12, opacity: 0.65 }}>{d.customerPhone}</div></div> },
          { title: 'Hàng', render: (_, d) => d.lines.map((l) => `${formatQty(l.deliveredQty ?? l.plannedQty)} ${l.description}`).join(', ') },
          { title: 'Địa chỉ', dataIndex: 'address', ellipsis: true },
          ...(can('money.view') ? [{ title: 'Giá trị', dataIndex: 'valueVnd', width: 130, align: 'right' as const, render: formatVnd }] : []),
          { title: 'Trạng thái', width: 110, render: (_, d) => <DeliveryStatusTag status={d.status} overdue={d.isOverdue} /> },
          {
            title: '',
            width: 110,
            fixed: 'right',
            render: (_, d) =>
              d.status === 'SCHEDULED' && d.orderStatus !== 'CANCELLED' && can('deliveries.deliver') ? (
                <Button type="primary" size="small" onClick={() => setDelivering(d)}>
                  Giao xong
                </Button>
              ) : null,
          },
        ]}
      />
      )}
      {delivering && <DeliverModal open trip={delivering} onClose={() => setDelivering(null)} />}
    </Flex>
  );
}

/** Step 6, last part: orders delivered in full waiting for the signed acceptance report, and the ones already signed. */
function AcceptanceList({ view, q }: { view: 'accept' | 'accepted'; q: string }) {
  const can = useCan();
  const [target, setTarget] = useState<Schemas['OrderCardDto'] | null>(null);
  const { data, isFetching } = useOrders({ status: view === 'accept' ? 'DELIVERING' : 'COMPLETED', q: q || undefined, pageSize: 100 });
  const rows = (data?.items ?? []).filter((o) => view === 'accepted' || o.fullyDelivered);
  return (
    <>
      <Table<Schemas['OrderCardDto']>
        rowKey="id"
        loading={isFetching}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 800 }}
        locale={{ emptyText: view === 'accept' ? 'Không có đơn nào chờ ký nghiệm thu' : 'Chưa có đơn nào' }}
        columns={[
          { title: 'Đơn', dataIndex: 'code', width: 140, render: (v: string, o) => <Link to={`/orders/${o.id}`}>{v}</Link> },
          { title: 'Khách hàng', key: 'c', render: (_, o) => <>{o.customerName}<div style={{ fontSize: 12, opacity: 0.65 }}>{o.customerPhone}</div></> },
          { title: 'Hàng', dataIndex: 'summary', ellipsis: true },
          { title: 'Chuyến', key: 't', width: 110, render: (_, o) => `${o.tripsDelivered}/${o.tripsTotal} đã giao` },
          ...(view === 'accepted' ? [{ title: 'Nghiệm thu', dataIndex: 'completedAt', width: 160, render: (v: string | null) => formatDateTime(v) }] : []),
          {
            title: '',
            key: 'a',
            width: 230,
            render: (_, o) => (
              <Space size={4}>
                <Button size="small" icon={<PrinterOutlined />} onClick={() => printDoc('acceptance', o.id)}>
                  In biên bản
                </Button>
                <DocsDownload docs={[{ kind: 'acceptance', sourceId: o.id, label: 'Biên bản nghiệm thu' }]} code={o.code} />
                {view === 'accept' && can('deliveries.accept') && (
                  <Button size="small" type="primary" onClick={() => setTarget(o)}>
                    Khách đã ký
                  </Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      {target && <AcceptOrderModal orderId={target.id} code={target.code} names={[target.customerName]} onClose={() => setTarget(null)} />}
    </>
  );
}
