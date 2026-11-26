import { ArrowLeftRight, BookOpen, Boxes, Calculator, CalendarDays, ChartColumn, CircleDollarSign, Database, FileCheck2, FileText, Landmark, LayoutDashboard, LayoutGrid, ListTree, MessageSquare, Palette, Percent, Plug, Scissors, Settings, ShieldCheck, Store, Truck, UserRound, Users, Wallet, Warehouse, Wrench, type LucideIcon } from 'lucide-react';

import type { ReactNode } from 'react';
import type { Permission } from './access';

/** Biểu tượng Lucide cỡ menu */
function I({ c: C }: { c: LucideIcon }) {
  return <C size={16} strokeWidth={1.75} className="anticon" />;
}

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
    icon: <I c={LayoutGrid} />,
    color: '#6366f1',
    nav: [
      { key: '/board', icon: <I c={LayoutDashboard} />, label: 'Bảng điều phối', permission: 'orders.view' },
      { key: '/conversations', icon: <I c={MessageSquare} />, label: 'Hội thoại', permission: 'conversations.view' },
      { key: '/quotes', icon: <I c={FileCheck2} />, label: 'Báo giá', permission: 'quotes.view' },
      { key: '/orders', icon: <I c={FileText} />, label: 'Đơn hàng', permission: 'orders.view' },
      { key: '/design', icon: <I c={Palette} />, label: 'Thiết kế', permission: 'design.view' },
      { key: '/production', icon: <I c={Wrench} />, label: 'Sản xuất', permission: 'production.view' },
      { key: '/deliveries', icon: <I c={Truck} />, label: 'Giao hàng', permission: 'deliveries.view' },
      { key: '/customers', icon: <I c={Users} />, label: 'Khách hàng', permission: 'customers.view' },
      { key: '/products', icon: <I c={Store} />, label: 'Sản phẩm', permission: 'products.view' },
    ],
  },
  {
    key: 'accounting',
    name: 'Kế toán',
    description: 'Thu chi, công nợ, kho vật tư, tài sản, thuế GTGT, sổ sách và khoá sổ cuối tháng',
    icon: <I c={Calculator} />,
    color: '#2f7d4f',
    nav: [
      { key: '/accounting', icon: <I c={LayoutDashboard} />, label: 'Tổng quan & khoá sổ', permission: 'accounting.view' },
      { key: '/accounting/periods', icon: <I c={CalendarDays} />, label: 'Kỳ kế toán', permission: 'accounting.view' },
      { key: '/payments', icon: <I c={CircleDollarSign} />, label: 'Thanh toán & công nợ', permission: 'payments.view' },
      { key: '/accounting/cash', icon: <I c={Wallet} />, label: 'Thu – chi', permission: 'accounting.view' },
      { key: '/accounting/debts', icon: <I c={ArrowLeftRight} />, label: 'Phải thu – phải trả', permission: 'accounting.view' },
      { key: '/accounting/stock', icon: <I c={Boxes} />, label: 'Kho NVL', permission: 'accounting.view' },
      { key: '/accounting/assets', icon: <I c={Landmark} />, label: 'TSCĐ & CCDC', permission: 'accounting.view' },
      { key: '/accounting/tax', icon: <I c={Percent} />, label: 'Thuế GTGT', permission: 'accounting.view' },
      { key: '/accounting/journal', icon: <I c={BookOpen} />, label: 'Sổ & bút toán', permission: 'accounting.view' },
      { key: '/accounting/reports', icon: <I c={ChartColumn} />, label: 'Báo cáo', permission: 'accounting.view' },
    ],
  },
  {
    key: 'warehouse',
    name: 'Kho',
    description: 'Nhiều kho (của Âu Việt và kho ngoài), phiếu nhập xuất có hiệu lực ngay, chuyển kho, tồn theo ngày; khuôn bế',
    icon: <I c={Warehouse} />,
    color: '#b5651d',
    nav: [
      { key: '/warehouse', icon: <I c={LayoutDashboard} />, label: 'Tổng quan kho', permission: 'warehouse.view' },
      { key: '/warehouse/stock', icon: <I c={Database} />, label: 'Kho vật tư', permission: 'warehouse.view' },
      { key: '/warehouse/dies', icon: <I c={Scissors} />, label: 'Kho khuôn', permission: 'warehouse.view' },
      { key: '/warehouse/reports', icon: <I c={ChartColumn} />, label: 'Báo cáo kho', permission: 'warehouse.view' },
      { key: '/warehouse/catalog', icon: <I c={ListTree} />, label: 'Danh mục kho', permission: 'warehouse.view' },
    ],
  },
  {
    key: 'admin',
    name: 'Quản trị',
    description: 'Tài khoản người dùng, nhóm quyền và kết nối fanpage',
    icon: <I c={Settings} />,
    color: '#7a4fb5',
    nav: [
      { key: '/accounts', icon: <I c={UserRound} />, label: 'Tài khoản', permission: 'accounts.view' },
      { key: '/roles', icon: <I c={ShieldCheck} />, label: 'Nhóm quyền', permission: 'roles.view' },
      { key: '/channels', icon: <I c={Plug} />, label: 'Kết nối kênh', permission: 'channels.manage' },
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
