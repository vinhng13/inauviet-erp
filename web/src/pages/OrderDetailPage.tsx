import { CarOutlined, DollarOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Dropdown,
  Empty,
  Flex,
  Input,
  Modal,
  Result,
  Row,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
  Timeline,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError, type Schemas } from '../api/client';
import { useOrder, useOrderActions, useOrderActivity, useDeliveryActions, useVoidPayment } from '../api/hooks';
import { useCan } from '../lib/access';
import { DeliverModal } from '../components/DeliverModal';
import { LinesModal } from '../components/LinesModal';
import { OrderSteps } from '../components/OrderSteps';
import { OrderDocsMenu } from '../components/PrintMenu';
import { PaymentModal } from '../components/PaymentModal';
import { ReasonModal } from '../components/ReasonModal';
import { DeliveryStatusTag, OrderStatusTag, PaymentTag } from '../components/Tags';
import { TripModal } from '../components/TripModal';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime, formatQty, formatVnd } from '../lib/format';
import { ACTIVITY_LABEL, ORDER_STATUS, PAYMENT_METHOD, PRODUCTION_STAGE } from '../lib/status';

type Order = Schemas['OrderDetailDto'];
type Trip = Schemas['DeliveryDto'];

export function OrderDetailPage() {
  const { id = '' } = useParams();
  const { data: order, isLoading, error } = useOrder(id);
  if (isLoading) return <Skeleton active />;
  if (error || !order) {
    return <Result status="404" title="Không tìm thấy đơn hàng" subTitle={error instanceof ApiError ? errorMessage(error) : undefined} extra={<Link to="/orders">Về danh sách đơn</Link>} />;
  }
  return <OrderView order={order} />;
}

function OrderView({ order }: { order: Order }) {
  const { message } = App.useApp();
  const can = useCan();
  const actions = useOrderActions(order.id);
  const [modal, setModal] = useState<null | 'lines' | 'trip' | 'payment' | 'cancel' | 'dates'>(null);
  const [tab, setTab] = useState('deliveries');
  const cancelled = order.status === 'CANCELLED';

  const run = async (p: Promise<unknown>, ok: string) => {
    try {
      await p;
      message.success(ok);
      setModal(null);
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  const moreItems = [
    ...(can('orders.update')
      ? [
          { key: 'dates', label: 'Sửa ngày & ghi chú', disabled: cancelled },
          { key: 'lines', label: 'Sửa hàng hoá', disabled: cancelled },
        ]
      : []),
    ...(can('orders.cancel') ? [{ type: 'divider' as const }, { key: 'cancel', label: 'Huỷ đơn', danger: true, disabled: cancelled || order.status === 'COMPLETED' }] : []),
  ];

  return (
    <Flex vertical gap={16} style={{ maxWidth: 1200 }}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Space wrap align="center">
          <Typography.Title level={3} style={{ margin: 0 }}>
            {order.code}
          </Typography.Title>
          <OrderStatusTag status={order.status} />
          <PaymentTag status={order.paymentStatus} />
          {order.isOverdue && <Tag color="red">Quá hạn</Tag>}
        </Space>
        <Space wrap>
          <OrderDocsMenu order={order} />
          {!cancelled && can('deliveries.create') && (
            <Button icon={<CarOutlined />} onClick={() => setModal('trip')} disabled={order.unplannedQty === 0}>
              Thêm chuyến giao
            </Button>
          )}
          {can('payments.create') && (
            <Button icon={<DollarOutlined />} onClick={() => setModal('payment')}>
              Ghi nhận thanh toán
            </Button>
          )}
          {moreItems.length > 0 && (
            <Dropdown menu={{ items: moreItems, onClick: ({ key }) => setModal(key as 'lines' | 'cancel' | 'dates') }}>
              <Button icon={<EditOutlined />}>Khác</Button>
            </Dropdown>
          )}
        </Space>
      </Flex>

      {cancelled && <Alert type="warning" showIcon title={`Đơn đã huỷ ${formatDateTime(order.cancelledAt)}`} description={order.cancelReason} />}

      {order.quote && <QuoteChanges order={order} />}

      <OrderSteps key={order.status} order={order} />

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={can('money.view') ? 14 : 24}>
          <Card title="Thông tin đơn" size="small" style={{ height: '100%' }}>
            <Descriptions
              size="small"
              column={{ xs: 1, sm: 2 }}
              items={[
                {
                  label: 'Khách hàng',
                  children: (
                    <Link to={`/customers/${order.customer.id}`}>
                      {order.customer.name}
                      {order.customer.companyName ? ` · ${order.customer.companyName}` : ''}
                    </Link>
                  ),
                },
                { label: 'Điện thoại', children: <Typography.Text copyable>{order.customer.phone}</Typography.Text> },
                { label: 'Ngày đặt', children: formatDate(order.orderDate) },
                { label: 'Hạn giao', children: <Typography.Text type={order.isOverdue ? 'danger' : undefined}>{formatDate(order.dueDate)}</Typography.Text> },
                { label: 'Ghi chú', children: order.note ?? '—', span: 'filled' },
              ]}
            />
          </Card>
        </Col>
        {can('money.view') && (
        <Col xs={24} lg={10}>
          <Card size="small" title="Tiền" style={{ height: '100%' }}>
            {order.totalVnd === null ? (
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                Đơn chưa có giá. Đã nhận {formatVnd(order.paidVnd)}.
              </Typography.Paragraph>
            ) : (
              <Flex wrap gap="12px 32px">
                <Money label="Tổng" value={order.totalVnd} />
                <Money label="Đã nhận" value={order.paidVnd} />
                <Money label="Còn lại" value={order.balanceVnd} strong={(order.balanceVnd ?? 0) > 0} />
              </Flex>
            )}
          </Card>
        </Col>
        )}
      </Row>

      <Card size="small" styles={{ body: { paddingTop: 0 } }}>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'deliveries', label: `Giao hàng (${order.deliveries.filter((d) => d.status !== 'CANCELLED').length})`, children: <DeliveriesTab order={order} onAddTrip={() => setModal('trip')} /> },
            { key: 'lines', label: `Hàng hoá (${order.lines.length})`, children: <LinesTab order={order} showMoney={can('money.view')} /> },
            ...(can('payments.view')
              ? [{ key: 'payments', label: `Thanh toán (${order.payments.filter((p) => !p.voidedAt).length})`, children: <PaymentsTab order={order} onAdd={() => setModal('payment')} /> }]
              : []),
            { key: 'history', label: 'Lịch sử', children: <HistoryTab orderId={order.id} active={tab === 'history'} /> },
          ]}
        />
      </Card>

      <LinesModal open={modal === 'lines'} order={order} onClose={() => setModal(null)} />
      <TripModal open={modal === 'trip'} order={order} onClose={() => setModal(null)} />
      <PaymentModal open={modal === 'payment'} order={order} onClose={() => setModal(null)} />
      <DatesModal open={modal === 'dates'} order={order} onClose={() => setModal(null)} />
      <ReasonModal
        open={modal === 'cancel'}
        title={`Huỷ đơn ${order.code}?`}
        description="Các chuyến chưa giao cũng sẽ bị huỷ. Khoản đã thu vẫn được giữ trong lịch sử."
        okText="Huỷ đơn"
        danger
        loading={actions.cancel.isPending}
        onCancel={() => setModal(null)}
        onSubmit={(reason) => run(actions.cancel.mutateAsync(reason), 'Đã huỷ đơn')}
      />
    </Flex>
  );
}

function Money({ label, value, strong }: { label: string; value: number | null; strong?: boolean }) {
  return (
    <div>
      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
        {label}
      </Typography.Text>
      <div style={{ fontSize: 18, fontWeight: strong ? 600 : 500, whiteSpace: 'nowrap' }}>{formatVnd(value)}</div>
    </div>
  );
}

function DeliveriesTab({ order, onAddTrip }: { order: Order; onAddTrip: () => void }) {
  const { message } = App.useApp();
  const can = useCan();
  const trips = useDeliveryActions(order.id);
  const [delivering, setDelivering] = useState<Trip | null>(null);
  const [editing, setEditing] = useState<Trip | null>(null);
  const [reason, setReason] = useState<{ trip: Trip; kind: 'cancel' | 'reopen' } | null>(null);
  const cancelled = order.status === 'CANCELLED';

  const unplanned = order.lines.filter((l) => l.unplannedQty > 0);
  return (
    <Flex vertical gap={12}>
      {!cancelled && unplanned.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title={`Chưa lên chuyến: ${unplanned.map((l) => `${formatQty(l.unplannedQty)} ${l.description}`).join(', ')}`}
          action={
            can('deliveries.create') && (
              <Button size="small" icon={<PlusOutlined />} onClick={onAddTrip}>
                Thêm chuyến
              </Button>
            )
          }
        />
      )}
      {order.deliveries.length === 0 && <Empty description="Chưa có chuyến giao nào" />}
      {order.deliveries.map((t) => (
        <Card
          key={t.id}
          size="small"
          type="inner"
          styles={{ header: { flexWrap: 'wrap', gap: 8, paddingBlock: 8 }, title: { whiteSpace: 'normal', overflow: 'visible' } }}
          title={
            <Space wrap>
              <Typography.Text strong>{t.code}</Typography.Text>
              <DeliveryStatusTag status={t.status} overdue={t.isOverdue} />
              <Typography.Text type="secondary">
                {t.status === 'DELIVERED' ? `Đã giao ${formatDateTime(t.deliveredAt)}` : `Dự kiến ${formatDate(t.plannedDate)}`}
              </Typography.Text>
            </Space>
          }
          extra={
            t.status === 'SCHEDULED' && !cancelled ? (
              <Space wrap>
                {can('deliveries.deliver') && (
                  <Button type="primary" size="small" onClick={() => setDelivering(t)}>
                    Giao xong
                  </Button>
                )}
                {can('deliveries.update') && (
                  <Button size="small" onClick={() => setEditing(t)}>
                    Sửa
                  </Button>
                )}
                {can('deliveries.cancel') && (
                  <Button size="small" danger onClick={() => setReason({ trip: t, kind: 'cancel' })}>
                    Huỷ
                  </Button>
                )}
              </Space>
            ) : t.status === 'DELIVERED' && can('deliveries.reopen') && !cancelled && !order.acceptance ? (
              <Button size="small" onClick={() => setReason({ trip: t, kind: 'reopen' })}>
                Mở lại
              </Button>
            ) : null
          }
        >
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={t.lines}
            columns={[
              { title: 'Mặt hàng', dataIndex: 'description' },
              { title: 'Lên chuyến', dataIndex: 'plannedQty', align: 'right', width: 110, render: formatQty },
              {
                title: 'Thực giao',
                dataIndex: 'deliveredQty',
                align: 'right',
                width: 110,
                render: (v: number | null, l) =>
                  v === null ? '—' : v < l.plannedQty ? <Typography.Text type="warning">{formatQty(v)}</Typography.Text> : formatQty(v),
              },
            ]}
          />
          <Flex wrap gap={16} style={{ marginTop: 8, fontSize: 13 }}>
            {t.address && <span>Địa chỉ: {t.address}</span>}
            {t.receiverName && <span>Người nhận: {t.receiverName}</span>}
            {t.valueVnd != null && <span>Giá trị: {formatVnd(t.valueVnd)}</span>}
            {t.collectedVnd > 0 && <span>Đã thu: {formatVnd(t.collectedVnd)}</span>}
            {t.note && <span>Ghi chú: {t.note}</span>}
            {t.cancelReason && <span>Lý do huỷ: {t.cancelReason}</span>}
          </Flex>
        </Card>
      ))}

      {delivering && <DeliverModal open trip={delivering} onClose={() => setDelivering(null)} />}
      {editing && <TripModal open order={order} trip={editing} onClose={() => setEditing(null)} />}
      <ReasonModal
        open={!!reason}
        title={reason?.kind === 'cancel' ? `Huỷ chuyến ${reason.trip.code}?` : `Mở lại chuyến ${reason?.trip.code}?`}
        description={
          reason?.kind === 'cancel'
            ? 'Số lượng của chuyến này sẽ quay về "chưa lên chuyến".'
            : 'Chuyến sẽ quay về "Chờ giao" và số đã giao được trừ khỏi đơn. Khoản thu gắn với chuyến vẫn giữ nguyên.'
        }
        okText={reason?.kind === 'cancel' ? 'Huỷ chuyến' : 'Mở lại'}
        danger={reason?.kind === 'cancel'}
        loading={trips.cancel.isPending || trips.reopen.isPending}
        onCancel={() => setReason(null)}
        onSubmit={async (r) => {
          if (!reason) return;
          try {
            if (reason.kind === 'cancel') await trips.cancel.mutateAsync({ id: reason.trip.id, reason: r });
            else await trips.reopen.mutateAsync({ id: reason.trip.id, reason: r });
            message.success(reason.kind === 'cancel' ? 'Đã huỷ chuyến' : 'Đã mở lại chuyến');
            setReason(null);
          } catch (err) {
            message.error(errorMessage(err));
          }
        }}
      />
    </Flex>
  );
}

function LinesTab({ order, showMoney }: { order: Order; showMoney: boolean }) {
  return (
    <Table<Schemas['OrderLineDto']>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={order.lines}
      scroll={{ x: 760 }}
      columns={[
        { title: 'Mặt hàng', render: (_, l) => <div>{l.description}{l.spec && <div style={{ fontSize: 12, opacity: 0.65 }}>{l.spec}</div>}</div> },
        { title: 'Đặt', dataIndex: 'quantity', align: 'right', width: 80, render: formatQty },
        { title: 'Đã giao', dataIndex: 'deliveredQty', align: 'right', width: 90, render: formatQty },
        { title: 'Chưa lên chuyến', dataIndex: 'unplannedQty', align: 'right', width: 130, render: (v: number) => (v > 0 ? <Typography.Text type="warning">{formatQty(v)}</Typography.Text> : 0) },
        ...(showMoney
          ? [
              { title: 'Đơn giá', dataIndex: 'unitPriceVnd', align: 'right' as const, width: 130, render: formatVnd },
              { title: 'Thành tiền', dataIndex: 'lineTotalVnd', align: 'right' as const, width: 140, render: formatVnd },
            ]
          : []),
      ]}
      summary={() =>
        showMoney && order.totalVnd !== null && (
          <Table.Summary.Row>
            <Table.Summary.Cell index={0} colSpan={5} align="right">
              <Typography.Text strong>Tổng</Typography.Text>
            </Table.Summary.Cell>
            <Table.Summary.Cell index={5} align="right">
              <Typography.Text strong>{formatVnd(order.totalVnd)}</Typography.Text>
            </Table.Summary.Cell>
          </Table.Summary.Row>
        )
      }
    />
  );
}

function PaymentsTab({ order, onAdd }: { order: Order; onAdd: () => void }) {
  const { message } = App.useApp();
  const can = useCan();
  const voidPayment = useVoidPayment(order.id);
  const [target, setTarget] = useState<Schemas['PaymentDto'] | null>(null);
  return (
    <Flex vertical gap={12}>
      {can('payments.create') && (
        <Button icon={<PlusOutlined />} onClick={onAdd} style={{ alignSelf: 'flex-start' }}>
          Ghi nhận thanh toán
        </Button>
      )}
      <Table<Schemas['PaymentDto']>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={order.payments}
        locale={{ emptyText: 'Chưa có khoản thanh toán' }}
        scroll={{ x: 760 }}
        rowClassName={(p) => (p.voidedAt ? 'row-voided' : '')}
        columns={[
          { title: 'Ngày', dataIndex: 'paidOn', width: 110, render: formatDate },
          { title: 'Số tiền', dataIndex: 'amountVnd', align: 'right', width: 140, render: (v, p) => (p.voidedAt ? <Typography.Text delete>{formatVnd(v)}</Typography.Text> : formatVnd(v)) },
          { title: 'Hình thức', dataIndex: 'method', width: 120, render: (m: Schemas['PaymentMethod']) => PAYMENT_METHOD[m] },
          { title: 'Chuyến', dataIndex: 'deliveryCode', width: 140, render: (v, p) => v ?? (p.isDeposit ? <Tag>Cọc</Tag> : '—') },
          { title: 'Người ghi', dataIndex: 'recordedByName', width: 140 },
          { title: 'Ghi chú', render: (_, p) => (p.voidedAt ? <Typography.Text type="secondary">Đã huỷ: {p.voidReason}</Typography.Text> : p.note) },
          {
            title: '',
            width: 80,
            render: (_, p) =>
              can('payments.void') && !p.voidedAt ? (
                <Button size="small" type="link" danger onClick={() => setTarget(p)}>
                  Huỷ
                </Button>
              ) : null,
          },
        ]}
      />
      <ReasonModal
        open={!!target}
        title={`Huỷ khoản ${target ? formatVnd(target.amountVnd) : ''}?`}
        description="Khoản này vẫn hiện trong lịch sử nhưng không còn tính vào số đã nhận."
        okText="Huỷ khoản thu"
        danger
        loading={voidPayment.isPending}
        onCancel={() => setTarget(null)}
        onSubmit={async (reason) => {
          if (!target) return;
          try {
            await voidPayment.mutateAsync({ id: target.id, reason });
            message.success('Đã huỷ khoản thu');
            setTarget(null);
          } catch (err) {
            message.error(errorMessage(err));
          }
        }}
      />
    </Flex>
  );
}

function HistoryTab({ orderId, active }: { orderId: string; active: boolean }) {
  const { data, isLoading } = useOrderActivity(orderId, active);
  if (isLoading) return <Skeleton active />;
  return (
    <Timeline
      style={{ marginTop: 12 }}
      items={(data ?? []).map((a) => ({
        content: (
          <div>
            <Typography.Text strong>{ACTIVITY_LABEL[a.action] ?? a.action}</Typography.Text>{' '}
            {describe(a)}
            <div style={{ fontSize: 12, opacity: 0.65 }}>
              {formatDateTime(a.createdAt)}
              {a.userName ? ` · ${a.userName}` : ''}
            </div>
          </div>
        ),
      }))}
    />
  );
}

/** Step 2: what changed between the quote and the order (no approval needed, but always visible). */
function QuoteChanges({ order }: { order: Order }) {
  const quote = order.quote!;
  const showMoney = useCan()('money.view');
  const link = <Link to={`/quotes/${quote.id}`}>{quote.code}</Link>;
  if (quote.changes.length === 0) {
    return <Alert type="info" showIcon title={<>Từ báo giá {link}. Hàng hoá giữ nguyên như báo giá.</>} />;
  }
  const qty = (c: (typeof quote.changes)[number]) => (c.fromQuantity !== null && c.toQuantity !== null ? `số lượng ${c.fromQuantity} → ${c.toQuantity}` : '');
  return (
    <Alert
      type="warning"
      showIcon
      title={
        <>
          Đã đổi {quote.changes.length} mục so với báo giá {link}
          {showMoney && quote.totalVnd !== undefined ? ` · giá trị ${formatVnd(quote.totalVnd)} → ${formatVnd(order.totalVnd)}` : ''}
        </>
      }
      description={
        <ul style={{ margin: 0, paddingInlineStart: 18 }}>
          {quote.changes.map((c, i) => (
            <li key={i}>
              {c.kind === 'ADDED' && `Thêm: ${c.description} × ${c.toQuantity}`}
              {c.kind === 'REMOVED' && `Bỏ: ${c.description}`}
              {c.kind === 'CHANGED' &&
                [c.fromDescription ? `${c.fromDescription} → ${c.description}` : c.description, qty(c), c.priceChanged ? 'đổi đơn giá' : ''].filter(Boolean).join(' · ')}
            </li>
          ))}
        </ul>
      }
    />
  );
}

function describe(a: Schemas['ActivityEntryDto']): string {
  const d = (a.data ?? {}) as Record<string, unknown>;
  switch (a.action) {
    case 'ORDER_CREATED':
      return `${a.toValue ?? ''}${d.quoteCode ? ` từ báo giá ${d.quoteCode}` : ''}`;
    case 'LINES_CHANGED':
      return Array.isArray(d.changes) ? (d.changes as string[]).join('; ') : '';
    case 'STATUS_CHANGED':
      return `${ORDER_STATUS[a.fromValue as Schemas['OrderStatus']]?.label ?? a.fromValue} → ${ORDER_STATUS[a.toValue as Schemas['OrderStatus']]?.label ?? a.toValue}${d.reason ? ` (${d.reason})` : ''}`;
    case 'DELIVERY_PLANNED':
      return `${a.toValue}${d.plannedDate ? `, ngày ${formatDate(String(d.plannedDate))}` : ''}`;
    case 'DELIVERY_DELIVERED': {
      const short = (d.shortfalls as Array<{ description: string; short: number }> | undefined) ?? [];
      return `${a.toValue}${short.length ? ` — thiếu ${short.map((s) => `${s.short} ${s.description}`).join(', ')}` : ''}`;
    }
    case 'PAYMENT_RECORDED':
      return `${formatVnd(Number(a.toValue))}${d.deliveryCode ? ` trong ${d.deliveryCode}` : d.isDeposit ? ' (cọc)' : ''}`;
    case 'PAYMENT_VOIDED':
      return `${formatVnd(Number(a.fromValue))}${d.reason ? ` (${d.reason})` : ''}`;
    case 'ORDER_CONFIRMED':
      return d.needsDesign ? 'cần thiết kế' : 'khách có file sẵn';
    case 'DESIGN_SENT':
      return `${a.toValue ?? ''}${d.note ? ` · ${d.note}` : ''}`;
    case 'DESIGN_CHANGES':
    case 'DESIGN_APPROVED':
      return `${a.toValue ?? ''}${d.channel ? ` qua ${d.channel}` : ''}${d.note ? ` · ${d.note}` : ''}`;
    case 'DESIGN_REOPENED':
      return `${d.version ? `v${d.version}` : ''}${d.reason ? ` (${d.reason})` : ''}`;
    case 'DESIGN_LOCKED':
      return d.version ? `maket v${d.version}` : '';
    case 'DESIGN_APPROVAL_UPDATED':
      return [d.channel ? `kênh ${d.channel}` : '', d.approvedByName ? `người duyệt ${d.approvedByName}` : '', d.finalized === true ? 'đã hoàn thiện file in' : d.finalized === false ? 'bỏ hoàn thiện' : ''].filter(Boolean).join(', ');
    case 'PRODUCTION_STARTED':
      return `${a.toValue ?? ''}${d.source ? ` · ${d.source}` : ''}`;
    case 'PRODUCTION_STAGE':
      return `${PRODUCTION_STAGE[d.from as Schemas['ProductionStage']] ?? ''} → ${a.toValue ?? ''}`;
    case 'PRODUCTION_UPDATED':
      return [d.dueDate ? `hạn ${formatDate(String(d.dueDate))}` : '', d.priority ? (d.priority === 'URGENT' ? 'gấp' : 'thường') : '', d.note ? String(d.note) : ''].filter(Boolean).join(', ');
    case 'ORDER_ACCEPTED':
      return `${a.toValue ?? ''}${d.note ? ` · ${d.note}` : ''}`;
    case 'DELIVERY_CANCELLED':
    case 'DELIVERY_REOPENED':
    case 'DELIVERY_UPDATED':
      return `${a.toValue ?? ''}${d.reason ? ` (${d.reason})` : ''}`;
    default:
      return a.toValue ?? '';
  }
}

function DatesModal({ open, order, onClose }: { open: boolean; order: Order; onClose: () => void }) {
  const { message } = App.useApp();
  const { update } = useOrderActions(order.id);
  const [due, setDue] = useState<dayjs.Dayjs | null>(order.dueDate ? dayjs(order.dueDate) : null);
  const [note, setNote] = useState(order.note ?? '');
  return (
    <Modal
      open={open}
      title="Sửa hạn giao & ghi chú"
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={update.isPending}
      onCancel={onClose}
      onOk={async () => {
        try {
          await update.mutateAsync({ dueDate: due ? due.format('YYYY-MM-DD') : null, note });
          message.success('Đã lưu');
          onClose();
        } catch (err) {
          message.error(errorMessage(err));
        }
      }}
    >
      <Flex vertical gap={12}>
        <label htmlFor="edit-due">Hạn giao</label>
        <DatePicker id="edit-due" value={due} onChange={setDue} format="DD/MM/YYYY" allowClear />
        <label htmlFor="edit-note">Ghi chú</label>
        <Input.TextArea id="edit-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
      </Flex>
    </Modal>
  );
}

