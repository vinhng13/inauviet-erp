import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { Badge, Button, Card, Col, Empty, Flex, Input, Row, Segmented, Space, Statistic, Switch, Tag, Typography, theme } from 'antd';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Schemas } from '../api/client';
import { useBoard } from '../api/hooks';
import { PaymentTag } from '../components/Tags';
import { formatQty, formatShortDate, formatVnd } from '../lib/format';
import { ORDER_STATUS, PRODUCTION_STAGE, QUOTE_STATUS, STEPS } from '../lib/status';
import { useCan } from '../lib/access';

type Due = 'all' | 'week' | 'overdue';

/** Home page: the 6 steps as columns (open quotes, then orders by status). Refreshes on open, on tab focus, and with the button. */
export function BoardPage() {
  const [q, setQ] = useState('');
  const [due, setDue] = useState<Due>('all');
  const [hasUnplanned, setHasUnplanned] = useState(false);
  const { data, isFetching, refetch, dataUpdatedAt } = useBoard({
    q: q || undefined,
    due: due === 'all' ? undefined : due,
    hasUnplanned: hasUnplanned || undefined,
  });
  const { token } = theme.useToken();
  const can = useCan();
  const showMoney = can('money.view');
  const [money, setMoney] = useState<MoneyFilter>('all');
  const byStatus = new Map((data?.columns ?? []).map((c) => [c.status, c.orders]));
  const allCards = (data?.columns ?? []).flatMap((c) => c.orders);
  const keep = (c: OrderCardData) => !showMoney || money === 'all' || moneyKey(c) === money;
  const orderColumn = (n: number, statuses: Schemas['OrderStatus'][]) => {
    const orders = statuses.flatMap((st) => byStatus.get(st) ?? []).filter(keep);
    const step = STEPS[n - 1];
    return { key: String(n), n, label: step.label, title: step.title, color: ORDER_STATUS[statuses[0]].color, count: orders.length, cards: orders.map((o) => <OrderCard key={o.id} order={o} showMoney={showMoney} />) };
  };
  const quotes = data?.quotes?.items ?? [];
  const columns = [
    ...(data?.quotes !== null && can('quotes.view') && money === 'all'
      ? [{ key: '1', n: 1, label: STEPS[0].label, title: STEPS[0].title, color: 'default', count: quotes.length, cards: quotes.map((q) => <QuoteCard key={q.id} quote={q} showMoney={showMoney} />) }]
      : []),
    orderColumn(2, ['CONFIRMED']),
    orderColumn(3, ['DESIGNING']),
    orderColumn(4, ['DESIGN_FINALIZING']),
    orderColumn(5, ['IN_PRODUCTION']),
    orderColumn(6, ['DELIVERING', 'COMPLETED']),
  ];

  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Bảng điều phối
        </Typography.Title>
        <Space wrap>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Cập nhật {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '…'}
          </Typography.Text>
          <Button icon={<ReloadOutlined spin={isFetching} />} onClick={() => refetch()}>
            Làm mới
          </Button>
          {can('quotes.create') && (
            <Link to="/quotes/new">
              <Button type="primary" icon={<PlusOutlined />}>
                Báo giá mới
              </Button>
            </Link>
          )}
          {can('orders.create') && (
            <Link to="/orders/new">
              <Button icon={<PlusOutlined />}>Đơn không qua báo giá</Button>
            </Link>
          )}
        </Space>
      </Flex>

      <Flex wrap gap={12} align="center">
        <Input.Search id="board-search" placeholder="Mã đơn, khách hàng, SĐT" allowClear onSearch={setQ} style={{ width: 280 }} />
        <Segmented<Due>
          value={due}
          onChange={setDue}
          options={[
            { value: 'all', label: 'Tất cả' },
            { value: 'week', label: 'Hạn trong 7 ngày' },
            { value: 'overdue', label: 'Quá hạn' },
          ]}
        />
        <Space>
          <Switch id="board-unplanned" size="small" checked={hasUnplanned} onChange={setHasUnplanned} />
          <label htmlFor="board-unplanned">Còn hàng chưa lên chuyến</label>
        </Space>
      </Flex>

      <Kpis data={data} showMoney={showMoney} />

      {showMoney && (
        <Segmented<MoneyFilter>
          value={money}
          onChange={setMoney}
          options={MONEY_FILTERS.map((f) => ({ value: f.key, label: `${f.label} (${allCards.filter((c) => f.key === 'all' || moneyKey(c) === f.key).length})` }))}
        />
      )}

      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${columns.length}, minmax(190px, 1fr))`, gap: 10, minWidth: columns.length * 196 }}>
          {columns.map((col) => (
            <div key={col.key} style={{ background: token.colorFillQuaternary, borderRadius: token.borderRadiusLG, padding: 10, minHeight: 200 }}>
              <Flex justify="space-between" align="center" style={{ padding: '2px 4px 2px' }}>
                <Space size={6}>
                  <Badge color={tagColor(token, col.color)} />
                  <Typography.Text strong>
                    {col.n}. {col.label}
                  </Typography.Text>
                </Space>
                <Typography.Text type="secondary">{col.count}</Typography.Text>
              </Flex>
              <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '0 4px 10px' }}>
                {col.title}
              </Typography.Paragraph>
              <Flex vertical gap={8}>
                {col.cards}
                {col.count === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={col.n === 1 ? 'Không có báo giá' : 'Không có đơn'} />}
              </Flex>
              {col.n === 6 && data && (
                <Typography.Paragraph type="secondary" style={{ fontSize: 12, margin: '8px 4px 0' }}>
                  Kèm đơn hoàn tất trong {data.completedDays} ngày gần đây
                </Typography.Paragraph>
              )}
            </div>
          ))}
        </div>
      </div>
    </Flex>
  );
}

type OrderCardData = Schemas['OrderCardDto'];
type MoneyFilter = 'all' | 'none' | 'dep' | 'debt' | 'paid';
const MONEY_FILTERS: Array<{ key: MoneyFilter; label: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'none', label: 'Chưa cọc' },
  { key: 'dep', label: 'Đã cọc' },
  { key: 'debt', label: 'Còn nợ' },
  { key: 'paid', label: 'Đã thanh toán' },
];

/** Same money states as the prototype: debt only counts once something was delivered. */
function moneyKey(c: OrderCardData): Exclude<MoneyFilter, 'all'> {
  const total = c.totalVnd ?? 0;
  if (total > 0 && c.paidVnd >= total) return 'paid';
  if (c.tripsDelivered > 0 && total > c.paidVnd) return 'debt';
  if (c.paidVnd > 0) return 'dep';
  return 'none';
}

function Kpis({ data, showMoney }: { data: Schemas['BoardDto'] | undefined; showMoney: boolean }) {
  const cols = new Map((data?.columns ?? []).map((c) => [c.status, c]));
  const count = (s: Schemas['OrderStatus']) => cols.get(s)?.count ?? 0;
  const running = (['CONFIRMED', 'DESIGNING', 'DESIGN_FINALIZING', 'IN_PRODUCTION', 'DELIVERING'] as const).reduce((n, s) => n + count(s), 0);
  const production = cols.get('IN_PRODUCTION')?.orders ?? [];
  const delivering = [...(cols.get('DELIVERING')?.orders ?? []), ...(cols.get('COMPLETED')?.orders ?? [])];
  const debt = delivering.filter((c) => c.tripsDelivered > 0 && (c.totalVnd ?? 0) > c.paidVnd);
  const items = [
    ...(data?.quotes ? [{ label: 'Báo giá đang mở', value: String(data.quotes.count), note: `${data.quotes.sentCount} đã gửi khách, chờ chốt` }] : []),
    { label: 'Đơn đang chạy', value: String(running), note: `${count('DESIGNING') + count('DESIGN_FINALIZING')} đơn đang ở khâu thiết kế` },
    { label: 'Đang sản xuất', value: String(count('IN_PRODUCTION')), note: `${production.filter((c) => c.productionPriority === 'URGENT').length} lệnh gấp` },
    showMoney
      ? { label: 'Công nợ đơn đã giao', value: formatVnd(debt.reduce((s, c) => s + (c.totalVnd ?? 0) - c.paidVnd, 0)), note: `${debt.length} đơn còn nợ` }
      : { label: 'Chờ nghiệm thu', value: String((cols.get('DELIVERING')?.orders ?? []).filter((c) => c.fullyDelivered).length), note: 'đơn đã giao đủ, chờ khách ký' },
  ];
  return (
    <Row gutter={[12, 12]}>
      {items.map((k) => (
        <Col key={k.label} xs={12} md={6}>
          <Card size="small">
            <Statistic title={k.label} value={k.value} />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {k.note}
            </Typography.Text>
          </Card>
        </Col>
      ))}
    </Row>
  );
}

/** One line about where the order is inside its step. */
function stepNote(o: OrderCardData): string {
  switch (o.status) {
    case 'CONFIRMED':
      return 'Đang xác nhận hàng hoá với khách';
    case 'DESIGNING': {
      const who = o.designerName ? `TK ${o.designerName} · ` : 'Chưa giao thiết kế · ';
      if (!o.lastDesignVersion) return `${who}chưa gửi maket`;
      const fb = o.lastDesignFeedback === 'PENDING' ? 'chờ phản hồi' : o.lastDesignFeedback === 'CHANGES_REQUESTED' ? 'cần sửa' : 'khách đồng ý';
      return `${who}maket v${o.lastDesignVersion} · ${fb}`;
    }
    case 'DESIGN_FINALIZING':
      return `Duyệt v${o.approvedVersion ?? '?'}${o.approvalChannel ? ` qua ${o.approvalChannel}` : ''} · ${o.designFinalized ? 'đã hoàn thiện' : 'đang hoàn thiện'}`;
    case 'IN_PRODUCTION':
      return `Xưởng: ${o.productionStage ? PRODUCTION_STAGE[o.productionStage] : '—'}${o.productionDueDate ? ` · hạn ${formatShortDate(o.productionDueDate)}` : ''}`;
    case 'DELIVERING':
      return o.fullyDelivered ? 'Đã giao đủ · chờ ký nghiệm thu' : o.tripsDelivered ? `${o.tripsDelivered} chuyến đã giao · còn hàng` : 'Chờ giao';
    case 'COMPLETED':
      return `Hoàn tất ${o.completedAt ? formatShortDate(o.completedAt.slice(0, 10)) : ''}`;
    default:
      return '';
  }
}

function OrderCard({ order: o, showMoney }: { order: OrderCardData; showMoney: boolean }) {
  const navigate = useNavigate();
  const done = o.status === 'COMPLETED';
  return (
    <Card size="small" hoverable onClick={() => navigate(`/orders/${o.id}`)} styles={{ body: { padding: 12, opacity: done ? 0.7 : 1 } }}>
      <Flex wrap justify="space-between" align="baseline" gap="0 8px">
        <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {o.code}
        </Typography.Text>
        {o.dueDate && !done && (
          <Typography.Text type={o.isOverdue ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
            {o.isOverdue ? 'Quá hạn ' : 'Hạn '}
            {formatShortDate(o.dueDate)}
          </Typography.Text>
        )}
      </Flex>
      <div style={{ marginTop: 2 }}>{o.customerName}</div>
      <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
        {o.summary}
      </Typography.Text>
      <div style={{ fontSize: 12, marginTop: 6 }}>{stepNote(o)}</div>
      <Flex wrap gap={4} style={{ marginTop: 8 }} align="center">
        {done && <Tag color="green">Hoàn tất</Tag>}
        {o.needsDesign === false && !done && <Tag>File sẵn</Tag>}
        {o.productionPriority === 'URGENT' && o.status === 'IN_PRODUCTION' && <Tag color="red">Gấp</Tag>}
        {o.status === 'DELIVERING' && o.tripsTotal > 0 && (
          <Tag>
            Giao {o.tripsDelivered}/{o.tripsTotal}
            {o.nextPlannedDate ? ` · tới ${formatShortDate(o.nextPlannedDate)}` : ''}
          </Tag>
        )}
        {o.unplannedQty > 0 && ['IN_PRODUCTION', 'DELIVERING'].includes(o.status) && <Tag color="orange">{formatQty(o.unplannedQty)} chưa lên chuyến</Tag>}
        {showMoney && <PaymentTag status={o.paymentStatus} />}
      </Flex>
    </Card>
  );
}

function QuoteCard({ quote: q, showMoney }: { quote: Schemas['QuoteListItemDto']; showMoney: boolean }) {
  const navigate = useNavigate();
  return (
    <Card size="small" hoverable onClick={() => navigate(`/quotes/${q.id}`)} styles={{ body: { padding: 12 } }}>
      <Flex justify="space-between" align="baseline" gap={8}>
        <Typography.Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {q.code}
        </Typography.Text>
        {q.isExpired && <Typography.Text type="warning" style={{ fontSize: 12 }}>Hết hiệu lực</Typography.Text>}
      </Flex>
      <div style={{ marginTop: 2 }}>{q.customer.name}</div>
      {q.title && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }} ellipsis>
          {q.title}
        </Typography.Text>
      )}
      <div style={{ fontSize: 12, marginTop: 6 }}>{q.status === 'SENT' ? `Đã gửi khách · ${formatShortDate(q.quoteDate)}` : 'Nháp · chưa gửi khách'}</div>
      <Flex wrap gap={4} style={{ marginTop: 8 }}>
        <Tag color={QUOTE_STATUS[q.status].color}>{QUOTE_STATUS[q.status].label}</Tag>
        {showMoney && <Tag>{formatVnd(q.totalVnd)}</Tag>}
      </Flex>
    </Card>
  );
}

function tagColor(token: ReturnType<typeof theme.useToken>['token'], name: string): string {
  const map: Record<string, string> = { blue: token.colorPrimary, gold: token.colorWarning, cyan: token.colorInfo, green: token.colorSuccess, purple: '#722ed1', magenta: '#c41d7f' };
  return map[name] ?? token.colorTextQuaternary;
}
