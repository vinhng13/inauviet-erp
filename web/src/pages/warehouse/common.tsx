import { Flex, Tag, Typography } from 'antd';
import type { ReactNode } from 'react';
import type { Schemas } from '../../api/client';

export type DieStatus = Schemas['WhDieStatus'];
export type DieAction = Schemas['DieActionDto']['action'];
export type SlipKind = Schemas['WhSlipKind'];

export const STATUS: Record<DieStatus, { label: string; color: string }> = {
  READY: { label: 'Sẵn sàng', color: 'green' },
  IN_USE: { label: 'Đang bế', color: 'blue' },
  CHECKING: { label: 'Chờ kiểm', color: 'gold' },
  REPAIRING: { label: 'Đang sửa', color: 'purple' },
  DEFECT: { label: 'Lỗi', color: 'orange' },
  BROKEN: { label: 'Hỏng', color: 'red' },
  DISPOSED: { label: 'Đã thanh lý', color: 'default' },
};

export const ACTION: Record<DieAction, { label: string; hint: string }> = {
  ISSUE: { label: 'Xuất khuôn', hint: 'Giao cho xưởng bế (hoặc dùng tại xưởng Âu Việt) cho một lệnh' },
  KEEP: { label: 'Xưởng giữ lại', hint: 'Bế xong, khuôn để lại ở xưởng cho lần sau' },
  RETURN: { label: 'Nhập lại kho', hint: 'Khuôn về kho Âu Việt, chờ kiểm' },
  PASS: { label: 'Kiểm đạt, lên kệ', hint: 'Khuôn dùng tốt, cất vào kệ' },
  DEFECT: { label: 'Báo lỗi / hỏng', hint: 'Dao mẻ, cong, gãy...' },
  SEND_REPAIR: { label: 'Gửi sửa', hint: 'Đưa khuôn lỗi đi sửa' },
  BACK_REPAIR: { label: 'Nhận về sau sửa', hint: 'Khuôn sửa xong về kho, chờ kiểm' },
  DISPOSE: { label: 'Thanh lý', hint: 'Không dùng nữa' },
  MOVE: { label: 'Đổi vị trí', hint: 'Đổi kệ, hoặc chuyển sang gửi giữ ở xưởng' },
};

export const ACTION_NEEDS: Record<DieAction, { partner?: 'required' | 'optional'; location?: 'required' | 'optional'; expected?: boolean; reference?: boolean }> = {
  ISSUE: { partner: 'optional', expected: true, reference: true },
  KEEP: {},
  RETURN: { location: 'optional', reference: true },
  PASS: { location: 'required' },
  DEFECT: {},
  SEND_REPAIR: { partner: 'required', expected: true },
  BACK_REPAIR: { location: 'optional' },
  DISPOSE: {},
  MOVE: { partner: 'optional', location: 'optional' },
};

export const KIND: Record<Schemas['WhDieKind'], string> = { CUT: 'Khuôn bế', FOIL: 'Khuôn ép nhũ', EMBOSS: 'Khuôn dập nổi' };
export const OWNER: Record<Schemas['WhDieOwner'], string> = { AU_VIET: 'Âu Việt', CUSTOMER: 'Khách hàng', PARTNER: 'Đối tác' };
export const ORIENT: Record<Schemas['WhOrientation'], string> = { PORTRAIT: 'Dọc', LANDSCAPE: 'Ngang' };
export const PARTNER_KIND: Record<Schemas['WhPartnerKind'], string> = { DIE_MAKER: 'Nơi làm khuôn', DIE_SHOP: 'Xưởng bế', SUPPLIER: 'Nhà cung cấp', OTHER: 'Khác' };
export const SLIP: Record<SlipKind, { label: string; color: string }> = {
  RECEIPT: { label: 'Nhập kho', color: 'green' },
  ISSUE: { label: 'Xuất kho', color: 'blue' },
  RETURN: { label: 'Nhập lại', color: 'cyan' },
  ADJUST: { label: 'Điều chỉnh', color: 'purple' },
};

export function DieStatusTag({ status }: { status: DieStatus }) {
  return <Tag color={STATUS[status].color}>{STATUS[status].label}</Tag>;
}

export function PageHead({ title, extra, children }: { title: string; extra?: ReactNode; children?: ReactNode }) {
  return (
    <Flex vertical gap={8}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {extra}
      </Flex>
      {children}
    </Flex>
  );
}

/** 21.5 → "21,5" */
export const cm = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(Math.round(v * 100) / 100).replace('.', ','));
export const qty = (v: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(v);

/** Save rows as a CSV that Excel opens with Vietnamese intact (UTF-8 BOM, ; separator) */
export function downloadCsv(name: string, header: string[], rows: Array<Array<string | number | null | undefined>>): void {
  const cell = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
