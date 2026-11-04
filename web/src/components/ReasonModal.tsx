import { Form, Input, Modal } from 'antd';

interface Props {
  open: boolean;
  title: string;
  okText: string;
  danger?: boolean;
  description?: string;
  loading?: boolean;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}

/** Asks for a reason before a cancel / reopen / void. The reason goes into the history. */
export function ReasonModal({ open, title, okText, danger, description, loading, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<{ reason: string }>();
  return (
    <Modal
      open={open}
      title={title}
      okText={okText}
      cancelText="Đóng"
      okButtonProps={{ danger, loading }}
      destroyOnHidden
      onCancel={onCancel}
      onOk={() => form.validateFields().then((v) => onSubmit(v.reason.trim()))}
    >
      {description && <p>{description}</p>}
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item name="reason" label="Lý do" rules={[{ required: true, whitespace: true, message: 'Nhập lý do' }]}>
          <Input.TextArea id="reason" rows={3} maxLength={500} autoFocus />
        </Form.Item>
      </Form>
    </Modal>
  );
}
