import { Alert, App, Button, Form, Input } from 'antd';
import { useState } from 'react';
import { useAuthActions } from '../api/hooks';
import { errorMessage } from '../lib/errors';

interface Values {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

/** Used for the forced change after a temporary password, and from the user menu. */
export function ChangePasswordForm({ onDone, submitText = 'Đổi mật khẩu' }: { onDone?: () => void; submitText?: string }) {
  const { message } = App.useApp();
  const { changePassword } = useAuthActions();
  const [error, setError] = useState<string | null>(null);
  const [form] = Form.useForm<Values>();

  return (
    <Form<Values>
      form={form}
      layout="vertical"
      requiredMark={false}
      onValuesChange={() => setError(null)}
      onFinish={async (v) => {
        try {
          await changePassword.mutateAsync({ currentPassword: v.currentPassword, newPassword: v.newPassword });
          message.success('Đã đổi mật khẩu. Các thiết bị khác đã được đăng xuất.');
          form.resetFields();
          onDone?.();
        } catch (err) {
          setError(errorMessage(err));
        }
      }}
    >
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 16 }} />}
      <Form.Item name="currentPassword" label="Mật khẩu hiện tại" rules={[{ required: true, message: 'Nhập mật khẩu hiện tại' }]}>
        <Input.Password id="pw-current" autoComplete="current-password" autoFocus />
      </Form.Item>
      <Form.Item
        name="newPassword"
        label="Mật khẩu mới"
        extra="Ít nhất 8 ký tự, không chứa tên đăng nhập. Nên dùng một câu ngắn dễ nhớ."
        rules={[{ required: true, message: 'Nhập mật khẩu mới' }, { min: 8, message: 'Ít nhất 8 ký tự' }]}
      >
        <Input.Password id="pw-new" autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        name="confirm"
        label="Nhập lại mật khẩu mới"
        dependencies={['newPassword']}
        rules={[
          { required: true, message: 'Nhập lại mật khẩu mới' },
          ({ getFieldValue }) => ({
            validator: (_, v) => (!v || v === getFieldValue('newPassword') ? Promise.resolve() : Promise.reject(new Error('Hai mật khẩu chưa khớp'))),
          }),
        ]}
      >
        <Input.Password id="pw-confirm" autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={changePassword.isPending}>
        {submitText}
      </Button>
    </Form>
  );
}
