import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Flex, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { useAuthActions } from '../api/hooks';
import { errorMessage } from '../lib/errors';

/** Shown instead of the app whenever nobody is signed in. */
export function LoginPage() {
  const { login } = useAuthActions();
  const [error, setError] = useState<string | null>(null);

  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', padding: 16, background: 'var(--ant-color-bg-layout, #f5f5f5)' }}>
      <Card style={{ width: '100%', maxWidth: 380 }} styles={{ body: { padding: 28 } }}>
        <Flex vertical gap={20}>
          <Flex align="center" gap={12}>
            <img src="/favicon.svg" width={36} height={36} alt="" />
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                In Âu Việt
              </Typography.Title>
              <Typography.Text type="secondary">ERP · báo giá, đơn hàng, giao hàng</Typography.Text>
            </div>
          </Flex>
          {error && <Alert type="error" showIcon title={error} />}
          <Form
            layout="vertical"
            requiredMark={false}
            onValuesChange={() => setError(null)}
            onFinish={async (v: { username: string; password: string }) => {
              try {
                await login.mutateAsync({ username: v.username.trim(), password: v.password });
              } catch (err) {
                setError(errorMessage(err));
              }
            }}
          >
            <Form.Item name="username" label="Tên đăng nhập" rules={[{ required: true, whitespace: true, message: 'Nhập tên đăng nhập' }]}>
              <Input id="login-username" prefix={<UserOutlined />} autoComplete="username" autoCapitalize="none" autoFocus size="large" />
            </Form.Item>
            <Form.Item name="password" label="Mật khẩu" rules={[{ required: true, message: 'Nhập mật khẩu' }]}>
              <Input.Password id="login-password" prefix={<LockOutlined />} autoComplete="current-password" size="large" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={login.isPending}>
              Đăng nhập
            </Button>
          </Form>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Quên mật khẩu? Nhờ quản trị viên đặt lại trong mục Tài khoản.
          </Typography.Text>
        </Flex>
      </Card>
    </Flex>
  );
}
