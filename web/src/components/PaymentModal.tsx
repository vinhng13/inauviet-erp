import { App, Checkbox, DatePicker, Form, Input, InputNumber, Modal, Select } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { Schemas } from '../api/client';
import { useOrderActions } from '../api/hooks';
import { errorMessage } from '../lib/errors';
import { formatDate, formatVnd, vndInputProps } from '../lib/format';
import { PAYMENT_METHOD } from '../lib/status';

interface Values {
  amountVnd: number;
  method: Schemas['PaymentMethod'];
  paidOn: Dayjs;
  isDeposit: boolean;
  deliveryId?: string;
  note?: string;
}

export function PaymentModal({ open, order, onClose }: { open: boolean; order: Schemas['OrderDetailDto']; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Values>();
  const { addPayment } = useOrderActions(order.id);

  async function save() {
    const v = await form.validateFields();
    try {
      await addPayment.mutateAsync({
        amountVnd: v.amountVnd,
        method: v.method,
        paidOn: v.paidOn.format('YYYY-MM-DD'),
        isDeposit: v.isDeposit,
        deliveryId: v.deliveryId,
        note: v.note,
      });
      message.success('Đã ghi nhận thanh toán');
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  const trips = order.deliveries.filter((d) => d.status !== 'CANCELLED');
  return (
    <Modal
      open={open}
      title={`Ghi nhận thanh toán · ${order.code}`}
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={addPayment.isPending}
      onCancel={onClose}
      onOk={save}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={{ method: 'BANK_TRANSFER', paidOn: dayjs(), isDeposit: false, amountVnd: order.balanceVnd && order.balanceVnd > 0 ? order.balanceVnd : undefined }}
      >
        <Form.Item
          name="amountVnd"
          label="Số tiền"
          extra={order.balanceVnd !== null ? `Còn lại: ${formatVnd(order.balanceVnd)}` : undefined}
          rules={[{ required: true, message: 'Nhập số tiền' }, { type: 'number', min: 1, message: 'Số tiền phải lớn hơn 0' }]}
        >
          <InputNumber id="pay-amount" {...vndInputProps} style={{ width: '100%' }} autoFocus />
        </Form.Item>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <Form.Item name="method" label="Hình thức">
            <Select id="pay-method" options={Object.entries(PAYMENT_METHOD).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="paidOn" label="Ngày nhận" rules={[{ required: true }]}>
            <DatePicker id="pay-date" format="DD/MM/YYYY" style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item name="deliveryId" label="Thu trong chuyến (không bắt buộc)">
          <Select
            id="pay-trip"
            allowClear
            placeholder="Không gắn với chuyến nào"
            options={trips.map((d) => ({ value: d.id, label: `${d.code} · ${formatDate(d.plannedDate)}` }))}
          />
        </Form.Item>
        <Form.Item name="isDeposit" valuePropName="checked">
          <Checkbox id="pay-deposit">Đây là tiền cọc</Checkbox>
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input id="pay-note" maxLength={500} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
