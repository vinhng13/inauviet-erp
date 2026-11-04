import { Tag } from 'antd';
import type { Schemas } from '../api/client';
import { DELIVERY_STATUS, ORDER_STATUS, PAYMENT_STATUS } from '../lib/status';

export function OrderStatusTag({ status }: { status: Schemas['OrderStatus'] }) {
  const s = ORDER_STATUS[status];
  return <Tag color={s.color}>{s.label}</Tag>;
}

export function DeliveryStatusTag({ status, overdue }: { status: Schemas['DeliveryStatus']; overdue?: boolean }) {
  if (overdue) return <Tag color="red">Trễ lịch</Tag>;
  const s = DELIVERY_STATUS[status];
  return <Tag color={s.color}>{s.label}</Tag>;
}

export function PaymentTag({ status }: { status: Schemas['PaymentStatus'] }) {
  const s = PAYMENT_STATUS[status];
  return s ? <Tag color={s.color}>{s.label}</Tag> : null;
}
