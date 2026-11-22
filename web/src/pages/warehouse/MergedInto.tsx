import { Navigate, useLocation } from 'react-router';

/** Địa chỉ cũ (Bế khuôn & chuyển kho, Nhật ký khuôn) nay là một thẻ của Kho khuôn: chuyển sang, giữ các tham số */
export function MergedInto({ view }: { view: 'moves' | 'journal' }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  params.set('view', view);
  return <Navigate to={`/warehouse/dies?${params.toString()}`} replace />;
}
