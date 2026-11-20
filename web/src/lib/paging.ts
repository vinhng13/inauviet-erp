import type { TablePaginationConfig } from 'antd';

/** Số dòng mỗi trang cho mọi bảng: chọn 50 / 100 / 200, mặc định 50 */
export const PAGE_SIZES = [50, 100, 200] as const;
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

/**
 * Phân trang cho bảng lọc ở trình duyệt (cả danh sách đã tải về).
 * `total`: số dòng; khi không quá 50 dòng thì ẩn thanh phân trang.
 */
export function pager(total?: number, extra?: TablePaginationConfig): TablePaginationConfig {
  return {
    defaultPageSize: DEFAULT_PAGE_SIZE,
    pageSizeOptions: PAGE_SIZES.map(String),
    showSizeChanger: true,
    hideOnSinglePage: total !== undefined && total <= DEFAULT_PAGE_SIZE,
    locale: { items_per_page: '/ trang' },
    ...extra,
  };
}

/** Phân trang cho danh sách phân trang ở máy chủ: trang và số dòng mỗi trang do màn hình giữ */
export function serverPager(page: number, pageSize: number, total: number | undefined, onChange: (page: number, pageSize: number) => void): TablePaginationConfig {
  return {
    current: page,
    pageSize,
    total,
    pageSizeOptions: PAGE_SIZES.map(String),
    showSizeChanger: true,
    locale: { items_per_page: '/ trang' },
    onChange: (p, size) => onChange(size !== pageSize ? 1 : p, size),
  };
}
