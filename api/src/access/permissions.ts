/**
 * The complete list of permissions, grouped by module. A permission group (Role) holds a subset of
 * these keys; the system group "Quản trị viên" always has all of them.
 *
 * Adding a permission: add it here, use it with @RequirePermission(...), and grant it to groups
 * from the "Nhóm quyền" screen. Keys are stored in the database, so never rename an existing key.
 */
export const PERMISSION_MODULES = [
  {
    key: 'quotes',
    label: 'Báo giá',
    actions: [
      { key: 'view', label: 'Xem', description: 'Danh sách và chi tiết báo giá' },
      { key: 'create', label: 'Thêm', description: 'Lập báo giá mới' },
      { key: 'update', label: 'Sửa', description: 'Sửa báo giá chưa chốt, đánh dấu đã gửi, khách không lấy' },
      { key: 'close', label: 'Chốt', description: 'Chốt báo giá thành đơn hàng' },
    ],
  },
  {
    key: 'orders',
    label: 'Đơn hàng',
    actions: [
      { key: 'view', label: 'Xem', description: 'Bảng đơn hàng, danh sách và chi tiết đơn, lịch sử' },
      { key: 'create', label: 'Thêm', description: 'Tạo đơn mới (kèm kế hoạch giao)' },
      { key: 'update', label: 'Sửa', description: 'Sửa ngày, ghi chú, hàng hoá; bắt đầu sản xuất' },
      { key: 'cancel', label: 'Huỷ', description: 'Huỷ đơn chưa hoàn thành' },
    ],
  },
  {
    key: 'design',
    label: 'Thiết kế',
    actions: [
      { key: 'view', label: 'Xem', description: 'Hàng chờ thiết kế, các phiên bản maket và phản hồi của khách' },
      { key: 'assign', label: 'Phân công', description: 'Giao đơn cho nhân viên thiết kế' },
      { key: 'work', label: 'Thực hiện', description: 'Gửi maket, ghi phản hồi của khách, chốt thiết kế và chuyển sản xuất' },
    ],
  },
  {
    key: 'production',
    label: 'Sản xuất',
    actions: [
      { key: 'view', label: 'Xem', description: 'Bảng lệnh sản xuất' },
      { key: 'update', label: 'Cập nhật', description: 'Chuyển công đoạn, đổi hạn và mức ưu tiên, báo xong sản xuất' },
    ],
  },
  {
    key: 'deliveries',
    label: 'Giao hàng',
    actions: [
      { key: 'view', label: 'Xem', description: 'Lịch giao hàng' },
      { key: 'create', label: 'Thêm', description: 'Thêm chuyến giao cho đơn đã có' },
      { key: 'update', label: 'Sửa', description: 'Sửa ngày, địa chỉ, số lượng chuyến chưa giao' },
      { key: 'deliver', label: 'Xác nhận giao', description: 'Đánh dấu giao xong, ghi số thực giao' },
      { key: 'cancel', label: 'Huỷ', description: 'Huỷ chuyến chưa giao' },
      { key: 'reopen', label: 'Mở lại', description: 'Đưa chuyến đã giao về chờ giao để sửa sai' },
      { key: 'accept', label: 'Nghiệm thu', description: 'Ghi nhận biên bản nghiệm thu khách đã ký, hoàn thành đơn' },
    ],
  },
  {
    key: 'payments',
    label: 'Thanh toán',
    actions: [
      { key: 'view', label: 'Xem', description: 'Danh sách khoản thu của đơn' },
      { key: 'create', label: 'Thêm', description: 'Ghi nhận tiền cọc, tiền thu (kể cả khi giao hàng)' },
      { key: 'void', label: 'Huỷ', description: 'Huỷ khoản thu nhập nhầm' },
    ],
  },
  {
    key: 'accounting',
    label: 'Kế toán',
    actions: [
      { key: 'view', label: 'Xem', description: 'Sổ sách, kho, tài sản, thuế, báo cáo lãi lỗ và sổ cái' },
      { key: 'post', label: 'Lập chứng từ', description: 'Phiếu nhập, phiếu xuất, phiếu chi, ghi tăng tài sản, bút toán thủ công, sửa bút toán tự động' },
      { key: 'close', label: 'Khoá sổ', description: 'Chạy các bước cuối tháng và khoá sổ kỳ' },
      { key: 'reopen', label: 'Mở lại kỳ', description: 'Mở lại kỳ đã khoá sổ để sửa sai' },
    ],
  },
  {
    key: 'money',
    label: 'Giá & số tiền',
    actions: [
      { key: 'view', label: 'Xem', description: 'Thấy đơn giá, tổng tiền, còn nợ. Không có quyền này thì mọi số tiền bị ẩn.' },
    ],
  },
  {
    key: 'customers',
    label: 'Khách hàng',
    actions: [
      { key: 'view', label: 'Xem', description: 'Danh sách và hồ sơ khách hàng' },
      { key: 'create', label: 'Thêm', description: 'Thêm khách hàng mới' },
      { key: 'update', label: 'Sửa', description: 'Sửa thông tin khách hàng' },
    ],
  },
  {
    key: 'products',
    label: 'Sản phẩm',
    actions: [
      { key: 'view', label: 'Xem', description: 'Danh mục sản phẩm và đơn giá' },
      { key: 'manage', label: 'Quản lý', description: 'Thêm, sửa, ngừng bán sản phẩm' },
    ],
  },
  {
    key: 'accounts',
    label: 'Tài khoản',
    actions: [
      { key: 'view', label: 'Xem', description: 'Danh sách tài khoản' },
      { key: 'create', label: 'Thêm', description: 'Tạo tài khoản mới' },
      { key: 'update', label: 'Sửa', description: 'Sửa thông tin, đổi nhóm quyền, khoá / mở khoá' },
      { key: 'resetPassword', label: 'Đặt lại mật khẩu', description: 'Cấp mật khẩu tạm cho tài khoản khác' },
    ],
  },
  {
    key: 'roles',
    label: 'Nhóm quyền',
    actions: [
      { key: 'view', label: 'Xem', description: 'Danh sách nhóm quyền và bảng quyền' },
      { key: 'manage', label: 'Quản lý', description: 'Thêm, sửa, xoá nhóm quyền' },
    ],
  },
] as const;

type Module = (typeof PERMISSION_MODULES)[number];
export type Permission = { [M in Module as M['key']]: `${M['key']}.${M['actions'][number]['key']}` }[Module['key']];

export const ALL_PERMISSIONS: Permission[] = PERMISSION_MODULES.flatMap((m) => m.actions.map((a) => `${m.key}.${a.key}` as Permission));
const KNOWN = new Set<string>(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return KNOWN.has(value);
}

/** Permissions that only make sense together with another one. Saving a group adds the missing base permission. */
export const IMPLIED: Partial<Record<Permission, Permission[]>> = {
  'quotes.view': ['customers.view', 'products.view'],
  'quotes.create': ['quotes.view', 'money.view'],
  'quotes.update': ['quotes.view', 'money.view'],
  'quotes.close': ['quotes.view', 'orders.create'],
  'products.manage': ['products.view'],
  'orders.create': ['orders.view', 'customers.view'],
  'orders.update': ['orders.view'],
  'orders.cancel': ['orders.view'],
  'design.view': ['orders.view'],
  'design.assign': ['design.view'],
  'design.work': ['design.view'],
  'production.view': ['orders.view'],
  'production.update': ['production.view'],
  'deliveries.view': ['orders.view'],
  'deliveries.create': ['deliveries.view'],
  'deliveries.update': ['deliveries.view'],
  'deliveries.deliver': ['deliveries.view'],
  'deliveries.cancel': ['deliveries.view'],
  'deliveries.reopen': ['deliveries.view'],
  'deliveries.accept': ['deliveries.view'],
  'payments.view': ['orders.view', 'money.view'],
  'payments.create': ['payments.view'],
  'payments.void': ['payments.view'],
  'accounting.view': ['money.view'],
  'accounting.post': ['accounting.view'],
  'accounting.close': ['accounting.view'],
  'accounting.reopen': ['accounting.close'],
  'customers.create': ['customers.view'],
  'customers.update': ['customers.view'],
  'accounts.create': ['accounts.view', 'roles.view'],
  'accounts.update': ['accounts.view', 'roles.view'],
  'accounts.resetPassword': ['accounts.view'],
  'roles.manage': ['roles.view'],
};

/** Normalize a list of keys: drop unknown ones, add implied ones, sort in catalog order. */
export function normalizePermissions(keys: string[]): Permission[] {
  const set = new Set<Permission>();
  const add = (p: Permission) => {
    if (set.has(p)) return;
    set.add(p);
    for (const q of IMPLIED[p] ?? []) add(q);
  };
  keys.filter(isPermission).forEach(add);
  return ALL_PERMISSIONS.filter((p) => set.has(p));
}

/** Starting groups created by the seed (the system admin group is created by the migration). */
export const DEFAULT_ROLES: Array<{ name: string; description: string; permissions: Permission[] }> = [
  {
    name: 'Kinh doanh',
    description: 'Báo giá, chốt đơn, lên kế hoạch giao, theo dõi khách hàng và thu tiền',
    permissions: normalizePermissions([
      'quotes.create', 'quotes.update', 'quotes.close',
      'orders.create', 'orders.update', 'orders.cancel', 'design.assign', 'production.view',
      'deliveries.create', 'deliveries.update', 'deliveries.deliver', 'deliveries.cancel', 'deliveries.accept',
      'payments.create', 'customers.create', 'customers.update',
    ]),
  },
  {
    name: 'Kế toán',
    description: 'Tiền thu, công nợ và sổ sách kế toán nội bộ',
    permissions: normalizePermissions(['payments.create', 'payments.void', 'deliveries.view', 'customers.view', 'accounting.post', 'accounting.close']),
  },
  {
    name: 'Giao hàng',
    description: 'Xem lịch giao và xác nhận đã giao. Không thấy giá tiền.',
    permissions: normalizePermissions(['deliveries.deliver', 'deliveries.accept', 'customers.view']),
  },
  {
    name: 'Thiết kế',
    description: 'Nhận đơn cần thiết kế, gửi maket, ghi phản hồi của khách, chốt thiết kế. Không thấy giá tiền.',
    permissions: normalizePermissions(['design.work']),
  },
  {
    name: 'Sản xuất',
    description: 'Xem lệnh sản xuất, chuyển công đoạn in, gia công, kiểm tra. Không thấy giá tiền.',
    permissions: normalizePermissions(['production.update']),
  },
];
