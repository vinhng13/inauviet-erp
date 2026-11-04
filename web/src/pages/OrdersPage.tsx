import { PlusOutlined } from '@ant-design/icons';
import { Button, Flex, Input, Select, Space, Switch, Table, Typography } from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Schemas } from '../api/client';
import { useOrders } from '../api/hooks';
import { OrderDocsDownload } from '../components/PrintMenu';
import { OrderStatusTag, PaymentTag } from '../components/Tags';
import { formatDate, formatQty, formatVnd } from '../lib/format';
import { ORDER_STATUS } from '../lib/status';
import { useCan } from '../lib/access';

/** Filters live in the URL so a filtered list can be bookmarked or sent. */
export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const can = useCan();
  const q = params.get('q') ?? '';
  const status = (params.get('status') as Schemas['OrderStatus'] | null) ?? undefined;
  const page = Number(params.get('page') ?? 1);
  const hasUnplanned = params.get('unplanned') === '1';
  const overdue = params.get('overdue') === '1';
  const { data, isFetching } = useOrders({ q: q || undefined, status, page, pageSize: 20, hasUnplanned: hasUnplanned || undefined, overdue: overdue || undefined });

  const set = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Đơn hàng
        </Typography.Title>
        {can('orders.create') && (
          <Link to="/orders/new">
            <Button type="primary" icon={<PlusOutlined />}>
              Đơn mới
            </Button>
          </Link>
        )}
      </Flex>
      <Flex wrap gap={12} align="center">
        <Input.Search id="orders-search" key={q} defaultValue={q} placeholder="Mã đơn, khách hàng, SĐT, mặt hàng" allowClear onSearch={(v) => set('q', v.trim() || undefined)} style={{ width: 320 }} />
        <Select
          id="orders-status"
          allowClear
          placeholder="Mọi trạng thái"
          value={status}
          onChange={(v) => set('status', v)}
          style={{ width: 180 }}
          options={Object.entries(ORDER_STATUS).map(([value, s]) => ({ value, label: s.label }))}
        />
        <Space>
          <Switch id="orders-unplanned" size="small" checked={hasUnplanned} onChange={(v) => set('unplanned', v ? '1' : undefined)} />
          <label htmlFor="orders-unplanned">Còn hàng chưa lên chuyến</label>
        </Space>
        <Space>
          <Switch id="orders-overdue" size="small" checked={overdue} onChange={(v) => set('overdue', v ? '1' : undefined)} />
          <label htmlFor="orders-overdue">Quá hạn</label>
        </Space>
      </Flex>
      <Table<Schemas['OrderCardDto']>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.items}
        scroll={{ x: 1180 }}
        onRow={(o) => ({ onClick: () => navigate(`/orders/${o.id}`), style: { cursor: 'pointer' } })}
        pagination={{ current: page, pageSize: 20, total: data?.total, showSizeChanger: false, onChange: (p) => set('page', String(p)) }}
        columns={[
          { title: 'Mã đơn', dataIndex: 'code', width: 140, render: (v) => <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>{v}</Typography.Text> },
          { title: 'Khách hàng', render: (_, o) => <div>{o.customerName}<div style={{ fontSize: 12, opacity: 0.65 }}>{o.customerPhone}</div></div> },
          { title: 'Hàng', dataIndex: 'summary', ellipsis: true },
          { title: 'Ngày đặt', dataIndex: 'orderDate', width: 110, render: formatDate },
          { title: 'Hạn', dataIndex: 'dueDate', width: 110, render: (v, o) => <Typography.Text type={o.isOverdue ? 'danger' : undefined}>{formatDate(v)}</Typography.Text> },
          { title: 'Trạng thái', dataIndex: 'status', width: 140, render: (s) => <OrderStatusTag status={s} /> },
          {
            title: 'Giao',
            width: 150,
            render: (_, o) => (
              <div>
                {o.tripsDelivered}/{o.tripsTotal} chuyến
                {o.unplannedQty > 0 && <div style={{ fontSize: 12 }}><Typography.Text type="warning">{formatQty(o.unplannedQty)} chưa lên chuyến</Typography.Text></div>}
              </div>
            ),
          },
          ...(can('money.view')
            ? [
                { title: 'Tổng tiền', dataIndex: 'totalVnd', width: 140, align: 'right' as const, render: formatVnd },
                { title: '', dataIndex: 'paymentStatus', width: 170, render: (s: Schemas['PaymentStatus']) => <PaymentTag status={s} /> },
              ]
            : []),
          { title: '', key: 'docs', width: 48, render: (_, o) => <OrderDocsDownload order={o} /> },
        ]}
      />
    </Flex>
  );
}
