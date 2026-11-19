import { AppstoreOutlined, MenuOutlined } from '@ant-design/icons';
import { ChevronsUpDown, CircleHelp, KeyRound, LayoutGrid, LogOut, Moon, Sun } from 'lucide-react';
import { Badge, Button, Drawer, Dropdown, Grid, Input, Layout, Menu, Modal, Space, Tooltip, Typography, theme } from 'antd';
import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { useChatStream, useUnreadConversations } from '../api/chat';
import { useAuthActions, useMe } from '../api/hooks';
import { ChangePasswordForm } from '../components/ChangePasswordForm';
import { useCan, type Permission } from '../lib/access';
import { allowedModules, navItemOf, type AppModule } from '../lib/modules';
import { useThemeMode } from '../lib/theme';

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

  const chat = can('conversations.view');
  useChatStream(chat);
  const unread = useUnreadConversations(chat).data?.conversations ?? 0;
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, '');
    document.title = unread ? `(${unread}) ${base}` : base;
  }, [unread]);

  const modules = allowedModules(can);
  const current = navItemOf(location.pathname);
  const module = modules.find((m) => m.key === current?.module.key) ?? modules[0];
  const items = (module?.allowed ?? []).map((n) => ({
    key: n.key,
    icon: n.icon,
    label: (
      <Link to={n.key}>
        {n.label}
        {n.key === '/conversations' && unread > 0 && <Badge count={unread} size="small" style={{ marginInlineStart: 8 }} />}
      </Link>
    ),
  }));
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
            ...modules.map((m) => ({
              key: m.key,
              icon: m.icon,
              label: m.name,
            })),
            { type: 'divider' as const },
            {
              key: 'home',
              icon: <AppstoreOutlined />,
              label: 'Màn hình chọn module',
            },
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
        <button type="button" className="user-chip module-switch" aria-label="Đổi module">
          <span className="module-tile sm" style={{ color: module.color, background: `color-mix(in srgb, ${module.color} 12%, transparent)` }}>
            {module.icon}
          </span>
          <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13 }}>{module.name}</span>
          <ChevronsUpDown size={14} style={{ opacity: 0.5, flex: 'none' }} />
        </button>
      </Dropdown>
    </div>
  );

  const search = module?.key === 'crm' && can('orders.view') && (
    <Input.Search
      id="global-search"
      placeholder="Tìm mã đơn, khách hàng, số điện thoại"
      allowClear
      style={{ maxWidth: 420 }}
      onSearch={(q) => q.trim() && navigate(`/orders?q=${encodeURIComponent(q.trim())}`)}
    />
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!compact && (
        <Sider
          width={232}
          theme="light"
          style={{
            borderInlineEnd: `1px solid ${token.colorBorder}`,
            position: 'sticky',
            top: 0,
            height: '100vh',
            alignSelf: 'flex-start',
          }}
        >
          {/* Không có thanh trên cùng: hướng dẫn và tài khoản nằm ở đáy menu trái */}
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Brand />
            {switcher}
            {search && <div style={{ padding: '0 12px 8px' }}>{search}</div>}
            <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingTop: 6 }}>
              <div className="nav-section">{module?.name}</div>
              {menu}
            </div>
            <div style={{ borderTop: `1px solid ${token.colorBorder}`, padding: 10 }}>
              <UserMenu vertical />
            </div>
          </div>
        </Sider>
      )}
      <Layout>
        {compact && (
          <Header
            style={{
              background: token.colorBgContainer,
              borderBottom: `1px solid ${token.colorBorder}`,
              paddingInline: 16,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              position: 'sticky',
              top: 0,
              zIndex: 100,
            }}
          >
            <Button type="text" icon={<MenuOutlined />} aria-label="Mở menu" onClick={() => setDrawer(true)} />
            {search}
            <div style={{ flex: 1 }} />
            <UserMenu />
          </Header>
        )}
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
    <div
      style={{
        padding: inline ? 0 : '18px 20px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <img src="/favicon.svg" width={30} height={30} alt="" style={{ borderRadius: 8 }} />
      <div>
        <Typography.Text strong style={{ fontSize: 15, letterSpacing: '-0.01em' }}>
          In Âu Việt
        </Typography.Text>
        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', opacity: 0.55, lineHeight: 1.3 }}>ERP · CRM · Kế toán</div>
      </div>
    </div>
  );
}

/** Chapter of the static user guide (web/public/huong-dan) for the page being viewed */
function guideHref(path: string): string {
  const kho: Record<string, string> = {
    '/warehouse/dies': 'kho-khuon',
    '/warehouse/batches': 'kho-giao-nhan',
    '/warehouse/die-journal': 'kho-nhat-ky',
    '/warehouse/stock': 'kho-ton',
    '/warehouse/reports': 'kho-bao-cao',
  };
  const chapter = path.startsWith('/warehouse')
    ? (kho[path] ?? 'kho-hieu')
    : path.startsWith('/accounting')
      ? 'kt-hieu'
      : path.startsWith('/accounts') || path.startsWith('/roles')
        ? 'tai-khoan'
        : path.startsWith('/channels')
          ? 'ket-noi-kenh'
          : path === '/'
            ? 'gioi-thieu'
            : '';
  return `/huong-dan/index.html${chapter ? `#${chapter}` : ''}`;
}

/** Chữ viết tắt từ họ tên (2 chữ cuối) cho ô đại diện */
const initials = (name?: string) =>
  (name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?';

/** Hướng dẫn, sáng / tối và tài khoản. `vertical`: xếp ở đáy menu trái (chip tài khoản có chữ viết tắt) */
export function UserMenu({ vertical }: { vertical?: boolean }) {
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const compact = !Grid.useBreakpoint().md;
  const { logout } = useAuthActions();
  const navigate = useNavigate();
  const { mode, toggle } = useThemeMode();
  const [changing, setChanging] = useState(false);
  const help = (
    <Button type="text" icon={<CircleHelp size={16} strokeWidth={1.75} />} href={guideHref(pathname)} target="_blank" rel="noopener" aria-label="Hướng dẫn sử dụng">
      {(vertical || !compact) && 'Hướng dẫn'}
    </Button>
  );
  const themeBtn = (
    <Tooltip title={mode === 'dark' ? 'Giao diện sáng' : 'Giao diện tối'}>
      <Button
        type="text"
        icon={mode === 'dark' ? <Sun size={16} strokeWidth={1.75} /> : <Moon size={16} strokeWidth={1.75} />}
        onClick={toggle}
        aria-label={mode === 'dark' ? 'Chuyển giao diện sáng' : 'Chuyển giao diện tối'}
      />
    </Tooltip>
  );
  const items = [
    { key: 'modules', icon: <LayoutGrid size={14} />, label: 'Chọn module', onClick: () => navigate('/') },
    { key: 'password', icon: <KeyRound size={14} />, label: 'Đổi mật khẩu', onClick: () => setChanging(true) },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogOut size={14} />, label: 'Đăng xuất', danger: true, onClick: () => logout.mutate() },
  ];
  return (
    <div style={vertical ? { display: 'flex', flexDirection: 'column', gap: 8 } : { display: 'flex', alignItems: 'center', gap: 4 }}>
      {vertical ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {help}
          {themeBtn}
        </div>
      ) : (
        <>
          {help}
          {themeBtn}
        </>
      )}
      <Dropdown trigger={['click']} placement={vertical ? 'topLeft' : 'bottomRight'} menu={{ items }}>
        {vertical ? (
          <button type="button" className="user-chip" aria-label="Tài khoản">
            <span className="avatar-initials">{initials(me?.fullName)}</span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.fullName ?? '…'}</span>
              <span style={{ display: 'block', fontSize: 11.5, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.roleName}</span>
            </span>
            <ChevronsUpDown size={14} style={{ opacity: 0.5, flex: 'none' }} />
          </button>
        ) : (
          <Button type="text" aria-label="Tài khoản">
            <Space size={8}>
              <span className="avatar-initials" style={{ width: 26, height: 26, fontSize: 11, borderRadius: 7 }}>
                {initials(me?.fullName)}
              </span>
              {!compact && (me?.fullName ?? '…')}
            </Space>
          </Button>
        )}
      </Dropdown>
      <Modal open={changing} title="Đổi mật khẩu" footer={null} onCancel={() => setChanging(false)} destroyOnHidden>
        <ChangePasswordForm onDone={() => setChanging(false)} />
      </Modal>
    </div>
  );
}
