import { Alert, App, DatePicker, Form, Input, InputNumber, Modal, Select, Switch, Table } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect } from 'react';
import type { Schemas } from '../api/client';
import { useDeliveryActions } from '../api/hooks';
import { errorMessage } from '../lib/errors';
import { formatQty, formatVnd, vndInputProps } from '../lib/format';
import { PAYMENT_METHOD } from '../lib/status';
import { useCan } from '../lib/access';

interface Props {
  open: boolean;
  trip: Schemas['DeliveryDto'] & { orderCode?: string; customerName?: string };
  onClose: () => void;
}

interface Values {
  deliveredAt: Dayjs;
  receiverName?: string;
  qty: Record<string, number>;
  collect: boolean;
  amountVnd?: number;
  method: Schemas['PaymentMethod'];
}

/** Mark a trip as delivered. Lower a quantity for a short delivery; optionally record money collected. */
export function DeliverModal({ open, trip, onClose }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const { deliver } = useDeliveryActions(trip.orderId);
  const can = useCan();
  const qty = Form.useWatch('qty', form) ?? {};
  const collect = Form.useWatch('collect', form);

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      deliveredAt: dayjs(),
      receiverName: undefined,
      qty: Object.fromEntries(trip.lines.map((l) => [l.orderLineId, l.plannedQty])),
      collect: false,
      amountVnd: trip.valueVnd ?? undefined,
      method: 'CASH',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trip.id]);

  const shortfalls = trip.lines
    .map((l) => ({ ...l, short: l.plannedQty - (qty[l.orderLineId] ?? l.plannedQty) }))
    .filter((l) => l.short > 0);

  async function save() {
    const v = await form.validateFields();
    try {
      await deliver.mutateAsync({
        id: trip.id,
        body: {
          deliveredAt: v.deliveredAt.toISOString(),
          receiverName: v.receiverName,
          lines: trip.lines.map((l) => ({ orderLineId: l.orderLineId, deliveredQty: v.qty[l.orderLineId] ?? 0 })),
          payment: v.collect && v.amountVnd ? { amountVnd: v.amountVnd, method: v.method } : undefined,
        },
      });
      message.success(`Đã ghi nhận giao ${trip.code}`);
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  return (
    <Modal
      open={open}
      width={680}
      title={`Giao xong ${trip.code}${trip.orderCode ? ` · ${trip.orderCode}` : ''}`}
      okText="Xác nhận đã giao"
      cancelText="Đóng"
      confirmLoading={deliver.isPending}
      onCancel={onClose}
      onOk={save}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Table
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={trip.lines}
          columns={[
            { title: 'Mặt hàng', dataIndex: 'description' },
            { title: 'Lên chuyến', dataIndex: 'plannedQty', align: 'right', width: 110, render: formatQty },
            {
              title: 'Thực giao',
              width: 140,
              render: (_, l) => (
                <Form.Item name={['qty', l.orderLineId]} noStyle>
                  <InputNumber id={`deliver-qty-${l.orderLineId}`} min={0} max={l.plannedQty} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              ),
            },
          ]}
        />
        {shortfalls.length > 0 && (
          <Alert
            style={{ marginTop: 12 }}
            type="warning"
            showIcon
            title={shortfalls.map((s) => `${formatQty(s.short)} ${s.description}`).join(', ') + ' sẽ quay về "chưa lên chuyến".'}
          />
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginTop: 16 }}>
          <Form.Item name="deliveredAt" label="Thời gian giao" rules={[{ required: true }]}>
            <DatePicker id="deliver-at" showTime={{ format: 'HH:mm' }} format="HH:mm DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="receiverName" label="Người nhận">
            <Input id="deliver-receiver" maxLength={200} />
          </Form.Item>
        </div>
        {can('payments.create') && (
          <Form.Item name="collect" label="Thu tiền trong chuyến này" valuePropName="checked">
            <Switch id="deliver-collect" />
          </Form.Item>
        )}
        {collect && can('payments.create') && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
            <Form.Item
              name="amountVnd"
              label="Số tiền thu"
              extra={trip.valueVnd != null ? `Giá trị hàng chuyến này: ${formatVnd(trip.valueVnd)}` : undefined}
              rules={[{ required: true, message: 'Nhập số tiền' }, { type: 'number', min: 1, message: 'Số tiền phải lớn hơn 0' }]}
            >
              <InputNumber id="deliver-amount" {...vndInputProps} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="method" label="Hình thức">
              <Select id="deliver-method" options={Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
          </div>
        )}
      </Form>
    </Modal>
  );
}
