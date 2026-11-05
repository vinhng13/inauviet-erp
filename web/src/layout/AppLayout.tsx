import { AppstoreOutlined, DownOutlined, KeyOutlined, LogoutOutlined, MenuOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Drawer, Dropdown, Grid, Input, Layout, Menu, Modal, Space, Typography, theme } from 'antd';
import { useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuthActions, useMe } from '../api/hooks';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { useCan, type Permission } from '../lib/access';
import { allowedModules, navItemOf, type AppModule } from '../lib/modules';

const { Header, Sider, Content } = Layout;

/** First page of a module this account may open */
export function firstPathOf(module: AppModule, can: (p: Permission) => boolean): string | null {
  return module.nav.find((n) => can(n.permission))?.key ?? null;
}

/** Layout inside a module: its own menu only, a switcher to the other modules the account may use. */
export function AppLayout() {
  const can = useCan();
  const location = useLocation();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const [drawer, setDrawer] = useState(false);
  const { token } = theme.useToken();

  const modules = allowedModules(can);
  const current = navItemOf(location.pathname);
  const module = modules.find((m) => m.key === current?.module.key) ?? modules[0];
  const items = (module?.allowed ?? []).map((n) => ({ key: n.key, icon: n.icon, label: <Link to={n.key}>{n.label}</Link> }));
  const selected = current?.item.key ?? '';
  const menu = <Menu mode="inline" selectedKeys={[selected]} items={items} onClick={() => setDrawer(false)} style={{ borderInlineEnd: 0 }} />;
  const compact = !screens.lg;

  const switcher = module && (
    <div style={{ padding: '0 12px 8px' }}>
      <Dropdown
        trigger={['click']}
        menu={{
          selectedKeys: [module.key],
          items: [
            ...modules.map((m) => ({ key: m.key, icon: m.icon, label: m.name })),
            { type: 'divider' as const },
            { key: 'home', icon: <AppstoreOutlined />, label: 'Màn hình chọn module' },
          ],
          onClick: ({ key }) => {
            setDrawer(false);
            if (key === 'home') return navigate('/');
            const m = modules.find((x) => x.key === key);
            const path = m && firstPathOf(m, can);
            if (path) navigate(path);
          },
        }}
      >
        <Button block style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderColor: module.color, color: module.color }} aria-label="Đổi module">
          <Space size={8}>
            {module.icon}
            <strong>{module.name}</strong>
          </Space>
          <DownOutlined style={{ fontSize: 11 }} />
        </Button>
      </Dropdown>
    </div>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!compact && (
        <Sider width={232} theme="light" style={{ borderInlineEnd: `1px solid ${token.colorBorderSecondary}` }}>
          <Brand />
          {switcher}
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
          {module?.key === 'crm' && can('orders.view') && (
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
      <Drawer open={drawer} onClose={() => setDrawer(false)} placement="left" size={272} title={<Brand inline />}>
        {switcher}
        {menu}
      </Drawer>
    </Layout>
  );
}

export function Brand({ inline }: { inline?: boolean }) {
  return (
    <div style={{ padding: inline ? 0 : '18px 20px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <img src="/favicon.svg" width={26} height={26} alt="" />
      <div>
        <Typography.Text strong style={{ fontSize: 15 }}>
          In Âu Việt
        </Typography.Text>
        <div style={{ fontSize: 12, opacity: 0.65, lineHeight: 1.2 }}>ERP · CRM · Kế toán</div>
      </div>
    </div>
  );
}

export function UserMenu() {
  const { data: me } = useMe();
  const { logout } = useAuthActions();
  const navigate = useNavigate();
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
            { key: 'modules', icon: <AppstoreOutlined />, label: 'Chọn module', onClick: () => navigate('/') },
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
