import { Button, Card, Flex, Typography } from 'antd';
import { useAuthActions, useMe } from '../api/hooks';
import { ChangePasswordForm } from '../components/ChangePasswordForm';

/** After signing in with a temporary password, nothing else is reachable until a new one is set. */
export function ForcePasswordPage() {
  const { data: me } = useMe();
  const { logout } = useAuthActions();
  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh', padding: 16 }}>
      <Card style={{ width: '100%', maxWidth: 420 }} styles={{ body: { padding: 28 } }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Chọn mật khẩu mới
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Xin chào {me?.fullName}. Bạn đang dùng mật khẩu tạm do quản trị viên cấp. Hãy đặt mật khẩu của riêng bạn để tiếp tục.
        </Typography.Paragraph>
        <ChangePasswordForm submitText="Lưu và vào ứng dụng" />
        <Button type="link" block style={{ marginTop: 8 }} onClick={() => logout.mutate()}>
          Đăng xuất
        </Button>
      </Card>
    </Flex>
  );
}
