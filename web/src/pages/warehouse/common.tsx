import { Badge, Flex, Segmented, Tag, Typography } from 'antd';
import { useSearchParams } from 'react-router';
import { useWarehouses } from '../../api/warehouse';
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
  TRANSFER_OUT: { label: 'Chuyển đi', color: 'geekblue' },
  TRANSFER_IN: { label: 'Nhận chuyển', color: 'lime' },
};

export type SlipStatus = Schemas['WhSlipStatus'];
export const SLIP_STATUS: Record<SlipStatus, { label: string; color: string }> = {
  PENDING: { label: 'Chờ xác nhận', color: 'gold' },
  CONFIRMED: { label: 'Đã xác nhận', color: 'green' },
  REJECTED: { label: 'Bị từ chối', color: 'red' },
  CANCELLED: { label: 'Đã huỷ', color: 'default' },
};

export function SlipStatusTag({ slip }: { slip: Pick<Schemas['SlipDto'], 'status' | 'voidedAt' | 'kind' | 'counterpart'> }) {
  if (slip.voidedAt) return <Tag>Đã huỷ</Tag>;
  if (slip.status === 'PENDING' && slip.kind === 'TRANSFER_IN' && slip.counterpart?.status === 'CONFIRMED') return <Tag color="processing">Đang chuyển đến</Tag>;
  if (slip.status === 'PENDING' && slip.kind === 'TRANSFER_IN') return <Tag color="default">Chờ kho đi xuất</Tag>;
  return <Tag color={SLIP_STATUS[slip.status].color}>{SLIP_STATUS[slip.status].label}</Tag>;
}

/** Số lượng theo đơn vị đã ghi trên phiếu, kèm số quy đổi: "2 ram (1.000 tờ)" */
export function lineQty(l: Pick<Schemas['SlipLineDto'], 'qty' | 'unit' | 'unitName' | 'unitQty'>): string {
  if (l.unitName && l.unitQty !== null) return `${qty(l.unitQty)} ${l.unitName} (${qty(l.qty)} ${l.unit})`;
  return `${qty(l.qty)} ${l.unit}`;
}

const PICK_KEY = 'wh.kho';

/**
 * Kho đang làm việc (kho theo số lượng), nhớ trên địa chỉ trang (?kho=GIAY) và trong trình duyệt.
 * Trả về kho đang chọn và hàm đổi kho.
 */
export function useWarehousePick(): { warehouse: Schemas['WarehouseDto'] | undefined; list: Schemas['WarehouseDto'][]; pick: (code: string) => void; loading: boolean } {
  const { data, isLoading } = useWarehouses();
  const [params, setParams] = useSearchParams();
  const list = (data ?? []).filter((w) => w.kind === 'STOCK' && w.isActive);
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(PICK_KEY);
  } catch {
    saved = null;
  }
  const code = params.get('kho') ?? saved;
  const warehouse = list.find((w) => w.code === code) ?? list[0];
  const pick = (c: string) => {
    try {
      localStorage.setItem(PICK_KEY, c);
    } catch {
      /* private window: remember in the address only */
    }
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('kho', c);
      return next;
    });
  };
  return { warehouse, list, pick, loading: isLoading };
}

export function WarehousePicker({ value, list, onChange }: { value?: Schemas['WarehouseDto']; list: Schemas['WarehouseDto'][]; onChange: (code: string) => void }) {
  if (!list.length) return <Typography.Text type="secondary">Chưa có kho nào. Thêm kho ở Danh mục kho.</Typography.Text>;
  return (
    <Segmented
      value={value?.code}
      onChange={(v) => onChange(String(v))}
      options={list.map((w) => ({
        value: w.code,
        label: (
          <Badge count={w.canConfirm ? w.pending : 0} size="small" offset={[8, -2]}>
            <span style={{ padding: '0 4px' }}>{w.name}</span>
          </Badge>
        ),
      }))}
    />
  );
}

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
