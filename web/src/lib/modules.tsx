import {
  ApiOutlined,
  AppstoreOutlined,
  BankOutlined,
  BarChartOutlined,
  BgColorsOutlined,
  BookOutlined,
  CalculatorOutlined,
  CalendarOutlined,
  CarOutlined,
  ContainerOutlined,
  DatabaseOutlined,
  AuditOutlined,
  BlockOutlined,
  InboxOutlined,
  DeploymentUnitOutlined,
  ProfileOutlined,
  DashboardOutlined,
  DollarOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  MessageOutlined,
  PercentageOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  ShopOutlined,
  SwapOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { Permission } from './access';

export type ModuleKey = 'crm' | 'accounting' | 'warehouse' | 'admin';

export interface NavItem {
  key: string;
  icon: ReactNode;
  label: string;
  permission: Permission;
}

export interface AppModule {
  key: ModuleKey;
  name: string;
  description: string;
  icon: ReactNode;
  color: string;
  nav: NavItem[];
}

/** The modules. After sign-in people choose one; each module shows only its own menu. */
export const MODULES: AppModule[] = [
  {
    key: 'crm',
    name: 'CRM',
    description: 'Hội thoại Facebook, báo giá, đơn hàng, thiết kế, sản xuất, giao hàng và khách hàng',
    icon: <AppstoreOutlined />,
    color: '#0a6f9c',
    nav: [
      { key: '/board', icon: <AppstoreOutlined />, label: 'Bảng điều phối', permission: 'orders.view' },
      { key: '/conversations', icon: <MessageOutlined />, label: 'Hội thoại', permission: 'conversations.view' },
      { key: '/quotes', icon: <FileDoneOutlined />, label: 'Báo giá', permission: 'quotes.view' },
      { key: '/orders', icon: <FileTextOutlined />, label: 'Đơn hàng', permission: 'orders.view' },
      { key: '/design', icon: <BgColorsOutlined />, label: 'Thiết kế', permission: 'design.view' },
      { key: '/production', icon: <ToolOutlined />, label: 'Sản xuất', permission: 'production.view' },
      { key: '/deliveries', icon: <CarOutlined />, label: 'Giao hàng', permission: 'deliveries.view' },
      { key: '/customers', icon: <TeamOutlined />, label: 'Khách hàng', permission: 'customers.view' },
      { key: '/products', icon: <ShopOutlined />, label: 'Sản phẩm', permission: 'products.view' },
    ],
  },
  {
    key: 'accounting',
    name: 'Kế toán',
    description: 'Thu chi, công nợ, kho vật tư, tài sản, thuế GTGT, sổ sách và khoá sổ cuối tháng',
    icon: <CalculatorOutlined />,
    color: '#2f7d4f',
    nav: [
      { key: '/accounting', icon: <DashboardOutlined />, label: 'Tổng quan & khoá sổ', permission: 'accounting.view' },
      { key: '/accounting/periods', icon: <CalendarOutlined />, label: 'Kỳ kế toán', permission: 'accounting.view' },
      { key: '/payments', icon: <DollarOutlined />, label: 'Thanh toán & công nợ', permission: 'payments.view' },
      { key: '/accounting/cash', icon: <WalletOutlined />, label: 'Thu – chi', permission: 'accounting.view' },
      { key: '/accounting/debts', icon: <SwapOutlined />, label: 'Phải thu – phải trả', permission: 'accounting.view' },
      { key: '/accounting/stock', icon: <ContainerOutlined />, label: 'Kho NVL', permission: 'accounting.view' },
      { key: '/accounting/assets', icon: <BankOutlined />, label: 'TSCĐ & CCDC', permission: 'accounting.view' },
      { key: '/accounting/tax', icon: <PercentageOutlined />, label: 'Thuế GTGT', permission: 'accounting.view' },
      { key: '/accounting/journal', icon: <BookOutlined />, label: 'Sổ & bút toán', permission: 'accounting.view' },
      { key: '/accounting/reports', icon: <BarChartOutlined />, label: 'Báo cáo', permission: 'accounting.view' },
    ],
  },
  {
    key: 'warehouse',
    name: 'Kho',
    description: 'Nhiều kho (giấy, vật tư xưởng bạt, tồn offset, khuôn), thủ kho xác nhận phiếu, chuyển kho, tồn theo ngày; khuôn bế',
    icon: <InboxOutlined />,
    color: '#b5651d',
    nav: [
      { key: '/warehouse', icon: <DashboardOutlined />, label: 'Tổng quan kho', permission: 'warehouse.view' },
      { key: '/warehouse/stock', icon: <DatabaseOutlined />, label: 'Tồn kho & phiếu', permission: 'warehouse.view' },
      { key: '/warehouse/dies', icon: <BlockOutlined />, label: 'Khuôn', permission: 'warehouse.view' },
      { key: '/warehouse/batches', icon: <DeploymentUnitOutlined />, label: 'Giao nhận khuôn', permission: 'warehouse.view' },
      { key: '/warehouse/counts', icon: <AuditOutlined />, label: 'Kiểm kê', permission: 'warehouse.view' },
      { key: '/warehouse/reports', icon: <BarChartOutlined />, label: 'Báo cáo kho', permission: 'warehouse.view' },
      { key: '/warehouse/catalog', icon: <ProfileOutlined />, label: 'Danh mục kho', permission: 'warehouse.view' },
    ],
  },
  {
    key: 'admin',
    name: 'Quản trị',
    description: 'Tài khoản người dùng, nhóm quyền và kết nối fanpage',
    icon: <SettingOutlined />,
    color: '#7a4fb5',
    nav: [
      { key: '/accounts', icon: <UserOutlined />, label: 'Tài khoản', permission: 'accounts.view' },
      { key: '/roles', icon: <SafetyCertificateOutlined />, label: 'Nhóm quyền', permission: 'roles.view' },
      { key: '/channels', icon: <ApiOutlined />, label: 'Kết nối kênh', permission: 'channels.manage' },
    ],
  },
];


/** Menu item a path belongs to (longest match, so /accounting/cash beats /accounting) */
export function navItemOf(path: string): { module: AppModule; item: NavItem } | null {
  let best: { module: AppModule; item: NavItem } | null = null;
  for (const module of MODULES) {
    for (const item of module.nav) {
      const hit = path === item.key || path.startsWith(`${item.key}/`);
      if (hit && (!best || item.key.length > best.item.key.length)) best = { module, item };
    }
  }
  return best;
}

export function allowedModules(can: (p: Permission) => boolean): Array<AppModule & { allowed: NavItem[] }> {
  return MODULES.map((m) => ({ ...m, allowed: m.nav.filter((n) => can(n.permission)) })).filter((m) => m.allowed.length > 0);
}
