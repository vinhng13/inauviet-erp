import {
  AppstoreOutlined,
  BgColorsOutlined,
  DollarOutlined,
  ToolOutlined,
  CarOutlined,
  FileDoneOutlined,
  ShopOutlined,
  FileTextOutlined,
  KeyOutlined,
  LogoutOutlined,
  MenuOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Button, Drawer, Dropdown, Grid, Input, Layout, Menu, Modal, Space, Typography, theme } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuthActions, useMe } from '../api/hooks';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { useCan, type Permission } from '../lib/access';

const { Header, Sider, Content } = Layout;

const NAV: Array<{ key: string; icon: ReactNode; label: string; permission: Permission; group?: string }> = [
  { key: '/board', icon: <AppstoreOutlined />, label: 'Bảng điều phối', permission: 'orders.view' },
  { key: '/quotes', icon: <FileDoneOutlined />, label: 'Báo giá', permission: 'quotes.view' },
  { key: '/orders', icon: <FileTextOutlined />, label: 'Đơn hàng', permission: 'orders.view' },
  { key: '/design', icon: <BgColorsOutlined />, label: 'Thiết kế', permission: 'design.view' },
  { key: '/production', icon: <ToolOutlined />, label: 'Sản xuất', permission: 'production.view' },
  { key: '/deliveries', icon: <CarOutlined />, label: 'Giao hàng', permission: 'deliveries.view' },
  { key: '/payments', icon: <DollarOutlined />, label: 'Thanh toán & công nợ', permission: 'payments.view', group: 'accounting' },
  { key: '/customers', icon: <TeamOutlined />, label: 'Khách hàng', permission: 'customers.view' },
  { key: '/products', icon: <ShopOutlined />, label: 'Sản phẩm', permission: 'products.view' },
  { key: '/accounts', icon: <UserOutlined />, label: 'Tài khoản', permission: 'accounts.view', group: 'admin' },
  { key: '/roles', icon: <SafetyCertificateOutlined />, label: 'Nhóm quyền', permission: 'roles.view', group: 'admin' },
];

export function firstAllowedPath(can: (p: Permission) => boolean): string | null {
  return NAV.find((n) => can(n.permission))?.key ?? null;
}

export function AppLayout() {
  const can = useCan();
  const location = useLocation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const [drawer, setDrawer] = useState(false);
  const { token } = theme.useToken();

  const allowed = NAV.filter((n) => can(n.permission));
  const work = allowed.filter((n) => !n.group);
  const admin = allowed.filter((n) => n.group === 'admin');
  const accounting = allowed.filter((n) => n.group === 'accounting');
  const toItem = (n: (typeof NAV)[number]) => ({ key: n.key, icon: n.icon, label: <Link to={n.key}>{n.label}</Link> });
  const items = [
    ...work.map(toItem),
    ...(accounting.length ? [{ type: 'group' as const, key: 'accounting', label: 'Kế toán', children: accounting.map(toItem) }] : []),
    ...(admin.length ? [{ type: 'group' as const, key: 'admin', label: 'Quản trị', children: admin.map(toItem) }] : []),
  ];
  const selected = allowed.find((i) => location.pathname.startsWith(i.key))?.key ?? '';
  const menu = <Menu mode="inline" selectedKeys={[selected]} items={items} onClick={() => setDrawer(false)} style={{ borderInlineEnd: 0 }} />;
  const compact = !screens.lg;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!compact && (
        <Sider width={220} theme="light" style={{ borderInlineEnd: `1px solid ${token.colorBorderSecondary}` }}>
          <Brand />
          {menu}
        </Sider>
      )}
      <Layout>
        <Header
          style={{
            background: token.colorBgContainer,
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            paddingInline: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          {compact && <Button type="text" icon={<MenuOutlined />} aria-label="Mở menu" onClick={() => setDrawer(true)} />}
          {can('orders.view') && (
            <Input.Search
              id="global-search"
              placeholder="Tìm mã đơn, khách hàng, số điện thoại"
              allowClear
              style={{ maxWidth: 420 }}
              onSearch={(q) => q.trim() && navigate(`/orders?q=${encodeURIComponent(q.trim())}`)}
            />
          )}
          <div style={{ flex: 1 }} />
          <UserMenu />
        </Header>
        <Content style={{ padding: compact ? 12 : 24 }}>
          <Outlet />
        </Content>
      </Layout>
      <Drawer open={drawer} onClose={() => setDrawer(false)} placement="left" size={260} title={<Brand inline />}>
        {menu}
      </Drawer>
    </Layout>
  );
}

function Brand({ inline }: { inline?: boolean }) {
  return (
    <div style={{ padding: inline ? 0 : '18px 20px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <img src="/favicon.svg" width={26} height={26} alt="" />
      <div>
        <Typography.Text strong style={{ fontSize: 15 }}>
          In Âu Việt
        </Typography.Text>
        <div style={{ fontSize: 12, opacity: 0.65, lineHeight: 1.2 }}>ERP · báo giá → nghiệm thu</div>
      </div>
    </div>
  );
}

function UserMenu() {
  const { data: me } = useMe();
  const { logout } = useAuthActions();
  const [changing, setChanging] = useState(false);
  return (
    <>
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            {
              key: 'who',
              disabled: true,
              label: (
                <div style={{ lineHeight: 1.4 }}>
                  <div style={{ fontWeight: 600, color: 'rgba(0,0,0,0.88)' }}>{me?.fullName}</div>
                  <div style={{ fontSize: 12 }}>
                    {me?.username} · {me?.roleName}
                  </div>
                </div>
              ),
            },
            { type: 'divider' },
            { key: 'password', icon: <KeyOutlined />, label: 'Đổi mật khẩu', onClick: () => setChanging(true) },
            { key: 'logout', icon: <LogoutOutlined />, label: 'Đăng xuất', onClick: () => logout.mutate() },
          ],
        }}
      >
        <Button type="text">
          <Space>
            <UserOutlined />
            {me?.fullName ?? '…'}
          </Space>
        </Button>
      </Dropdown>
      <Modal open={changing} title="Đổi mật khẩu" footer={null} onCancel={() => setChanging(false)} destroyOnHidden>
        <ChangePasswordForm onDone={() => setChanging(false)} />
      </Modal>
    </>
  );
}
