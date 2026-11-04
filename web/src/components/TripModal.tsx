import { DatePicker, Form, Input, InputNumber, Modal, Table, Typography, App } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect } from 'react';
import type { Schemas } from '../api/client';
import { useDeliveryActions, useOrderActions } from '../api/hooks';
import { errorMessage } from '../lib/errors';
import { formatQty } from '../lib/format';

interface Props {
  open: boolean;
  order: Schemas['OrderDetailDto'];
  /** Edit this scheduled trip; omit to add a new one */
  trip?: Schemas['DeliveryDto'];
  onClose: () => void;
}

interface Values {
  plannedDate: Dayjs;
  address?: string;
  note?: string;
  qty: Record<string, number | null>;
}

/** Add or edit a delivery trip on an existing order. Pre-fills what is not yet planned. */
export function TripModal({ open, order, trip, onClose }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const { addTrip } = useOrderActions(order.id);
  const { update } = useDeliveryActions(order.id);
  const saving = addTrip.isPending || update.isPending;

  // When editing, this trip's own quantities are available again.
  const available = (line: Schemas['OrderLineDto']) => {
    const own = trip?.lines.find((l) => l.orderLineId === line.id)?.plannedQty ?? 0;
    return line.unplannedQty + own;
  };

  useEffect(() => {
    if (!open) return;
    const qty: Record<string, number | null> = {};
    for (const line of order.lines) {
      qty[line.id] = trip ? (trip.lines.find((l) => l.orderLineId === line.id)?.plannedQty ?? null) : available(line) || null;
    }
    form.setFieldsValue({
      plannedDate: trip ? dayjs(trip.plannedDate) : dayjs().add(1, 'day'),
      address: trip?.address ?? order.customer.address ?? undefined,
      note: trip?.note ?? undefined,
      qty,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, trip?.id]);

  async function save() {
    const v = await form.validateFields();
    const lines = Object.entries(v.qty)
      .filter(([, q]) => q && q > 0)
      .map(([orderLineId, plannedQty]) => ({ orderLineId, plannedQty: plannedQty! }));
    if (lines.length === 0) {
      message.warning('Nhập số lượng cho ít nhất một mặt hàng');
      return;
    }
    const body = { plannedDate: v.plannedDate.format('YYYY-MM-DD'), address: v.address, note: v.note, lines };
    try {
      if (trip) await update.mutateAsync({ id: trip.id, body });
      else await addTrip.mutateAsync(body);
      message.success(trip ? `Đã sửa chuyến ${trip.code}` : 'Đã thêm chuyến giao');
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  return (
    <Modal
      open={open}
      width={720}
      title={trip ? `Sửa chuyến ${trip.code}` : `Thêm chuyến giao cho ${order.code}`}
      okText="Lưu chuyến"
      cancelText="Đóng"
      confirmLoading={saving}
      onCancel={onClose}
      onOk={save}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item name="plannedDate" label="Ngày giao dự kiến" rules={[{ required: true, message: 'Chọn ngày' }]}>
          <DatePicker id="trip-date" format="DD/MM/YYYY" style={{ width: 200 }} />
        </Form.Item>
        <Form.Item name="address" label="Địa chỉ giao">
          <Input id="trip-address" maxLength={500} />
        </Form.Item>
        <Table
          size="small"
          pagination={false}
          rowKey="id"
          dataSource={order.lines}
          columns={[
            { title: 'Mặt hàng', dataIndex: 'description' },
            { title: 'Còn có thể lên chuyến', align: 'right', width: 170, render: (_, l) => formatQty(available(l)) },
            {
              title: 'Số lượng chuyến này',
              width: 170,
              render: (_, l) => (
                <Form.Item name={['qty', l.id]} noStyle>
                  <InputNumber id={`trip-qty-${l.id}`} min={0} max={available(l)} precision={0} style={{ width: '100%' }} />
                </Form.Item>
              ),
            },
          ]}
        />
        <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
          Để trống hoặc 0 nếu mặt hàng không đi chuyến này.
        </Typography.Paragraph>
        <Form.Item name="note" label="Ghi chú cho tài xế">
          <Input.TextArea id="trip-note" rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
