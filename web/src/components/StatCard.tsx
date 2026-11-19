import type { ReactNode } from 'react';
import { STAT_GRADIENTS } from '../lib/theme';

/** Thẻ số liệu nổi bật (nền chuyển màu, chữ trắng, biểu tượng góc phải) */
export function StatCard({
  title,
  value,
  icon,
  hint,
  tone = 'indigo',
  onClick,
}: {
  title: string;
  value: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  tone?: keyof typeof STAT_GRADIENTS;
  onClick?: () => void;
}) {
  return (
    <div
      className="stat-card"
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => onClick && (e.key === 'Enter' || e.key === ' ') && onClick()}
      style={{ background: STAT_GRADIENTS[tone], cursor: onClick ? 'pointer' : undefined }}
    >
      <div className="stat-card-head">
        <span>{title}</span>
        {icon && <span className="stat-card-icon">{icon}</span>}
      </div>
      <div className="stat-card-value">{value}</div>
      {hint && <div className="stat-card-hint">{hint}</div>}
    </div>
  );
}
