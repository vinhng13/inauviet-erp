import { Badge, Flex, Segmented, Tabs, Tag, Typography } from 'antd';
import { useSearchParams } from 'react-router';
import { usePartners, useWarehouses } from '../../api/warehouse';
import type { ReactNode } from 'react';
import type { Schemas } from '../../api/client';

export type DieStatus = Schemas['WhDieStatus'];
export type DieAction = Schemas['DieActionDto']['action'];
export type SlipKind = Schemas['WhSlipKind'];

export const STATUS: Record<DieStatus, { label: string; color: string }> = {
  MAKING: { label: 'Đang làm khuôn', color: 'cyan' },
  READY: { label: 'Đạt, sẵn sàng', color: 'green' },
  IN_USE: { label: 'Đang bế', color: 'blue' },
  CHECKING: { label: 'Chờ kiểm', color: 'gold' },
  REPAIRING: { label: 'Đang sửa', color: 'purple' },
  DEFECT: { label: 'Không đạt', color: 'orange' },
  BROKEN: { label: 'Hỏng', color: 'red' },
  DISPOSED: { label: 'Đã thanh lý', color: 'default' },
  TRANSIT: { label: 'Đang chuyển', color: 'processing' },
  INCOMING: { label: 'Khuôn mới, chờ nhận', color: 'gold' },
};

/** Thao tác tại chỗ (khuôn không đổi nơi). Đổi nơi thì "Chuyển khuôn". */
export const ACTION: Record<DieAction, { label: string; hint: string }> = {
  PASS: { label: 'Kiểm tra: Đạt', hint: 'Khuôn đạt, sẵn sàng để bế' },
  DEFECT: { label: 'Kiểm tra: Không đạt', hint: 'Khuôn không đạt (dao lệch, mẻ, cong...). Nơi làm khuôn làm lại / sửa rồi kiểm tra lại.' },
  DISPOSE: { label: 'Thanh lý', hint: 'Không dùng nữa' },
  MOVE: { label: 'Đổi kệ', hint: 'Cất sang kệ khác trong cùng kho' },
};

export type BatchStatus = Schemas['WhDieBatchStatus'];

/** Trạng thái phiếu chuyển khuôn (phiếu cũ có thể còn chờ xác nhận) */
export function BatchStatusTag({ batch }: { batch: Pick<Schemas['BatchDto'], 'status' | 'outState' | 'inState'> }) {
  if (batch.status === 'DONE') return <Tag color="green">Đã chuyển</Tag>;
  if (batch.status === 'REJECTED') return <Tag color="red">Bị từ chối</Tag>;
  if (batch.status === 'CANCELLED') return <Tag>Đã huỷ</Tag>;
  if (batch.outState === 'PENDING') return <Tag color="gold">Chờ xác nhận xuất</Tag>;
  if (batch.outState === 'OK') return <Tag color="processing">Đang chuyển, chờ nhận</Tag>;
  return <Tag color="gold">Chờ kho nhận</Tag>;
}

/** Nơi đi / nơi đến của khuôn: mọi kho và mọi đối tác (không lọc theo loại), giá trị "k:<id>" / "x:<id>" */
export function useDiePlaces(): { options: Array<{ label: string; options: Array<{ value: string; label: string }> }>; khos: Schemas['WarehouseDto'][]; partners: Schemas['PartnerDto'][]; name: (key?: string | null) => string } {
  const warehouses = useWarehouses();
  const partners = usePartners();
  const khos = (warehouses.data ?? []).filter((w) => w.isActive);
  const shops = (partners.data ?? []).filter((p) => p.isActive);
  const options = [
    { label: 'Kho', options: khos.map((k) => ({ value: `k:${k.id}`, label: k.name })) },
    { label: 'Đối tác', options: shops.map((p) => ({ value: `x:${p.id}`, label: p.name })) },
  ].filter((g) => g.options.length);
  const name = (key?: string | null) => {
    if (!key) return '';
    const id = key.slice(2);
    if (key.startsWith('n:')) return id.trim(); // xưởng mới gõ tên
    return key.startsWith('k:') ? (khos.find((k) => k.id === id)?.name ?? '') : ((partners.data ?? []).find((p) => p.id === id)?.name ?? '');
  };
  return { options, khos, partners: shops, name };
}

/** Khóa nơi hiện tại của một khuôn ("k:<kho>" hoặc "x:<xưởng>") */
export const placeKey = (d: Pick<Schemas['DieRowDto'], 'holderId' | 'warehouseId'>) => (d.holderId ? `x:${d.holderId}` : `k:${d.warehouseId}`);

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
 * Kho đang làm việc (mọi kho đang dùng), nhớ trên địa chỉ trang (?kho=GIAY) và trong trình duyệt.
 * Trả về kho đang chọn và hàm đổi kho.
 */
export function useWarehousePick(): { warehouse: Schemas['WarehouseDto'] | undefined; list: Schemas['WarehouseDto'][]; pick: (code: string) => void; loading: boolean } {
  const { data, isLoading } = useWarehouses();
  const [params, setParams] = useSearchParams();
  const list = (data ?? []).filter((w) => w.isActive);
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
  // Giống hàng chọn nơi của Kho khuôn: tên · số vật tư đang có, cuộn ngang khi hẹp
  return (
    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
      <Segmented
        value={value?.code}
        onChange={(v) => onChange(String(v))}
        options={list.map((w) => ({
          value: w.code,
          label: (
            <Badge count={w.canConfirm ? w.pending : 0} size="small" offset={[8, -2]}>
              <span style={{ padding: '0 4px' }}>
                {w.name} · {w.materials}
              </span>
            </Badge>
          ),
        }))}
      />
    </div>
  );
}

export function DieStatusTag({ status }: { status: DieStatus }) {
  return <Tag color={STATUS[status].color}>{STATUS[status].label}</Tag>;
}

/** Các thẻ của Kho khuôn: danh sách khuôn, bế khuôn & chuyển kho, nhật ký. Đổi thẻ thì bỏ các lọc của thẻ cũ. */
export const DIE_VIEWS = [
  { key: 'dies', label: 'Danh sách khuôn' },
  { key: 'moves', label: 'Bế khuôn & chuyển kho' },
  { key: 'journal', label: 'Nhật ký khuôn' },
] as const;
export type DieView = (typeof DIE_VIEWS)[number]['key'];

/**
 * Đầu trang Kho khuôn (như Kho vật tư): chọn nơi trước (Tất cả, từng kho, từng xưởng / nơi làm khuôn), rồi các thẻ.
 * Nơi đã chọn áp dụng cho cả ba thẻ; đổi thẻ thì giữ nơi, bỏ các lọc khác của thẻ cũ.
 */
export function DieTabs({ view }: { view: DieView }) {
  const [params, setParams] = useSearchParams();
  const places = useDiePlaces();
  const place = params.get('place') ?? '';
  const go = (patch: { view?: string; place?: string }) => {
    const next = new URLSearchParams();
    const v = patch.view ?? view;
    const pl = patch.place ?? place;
    if (v !== 'dies') next.set('view', v);
    if (pl) next.set('place', pl);
    setParams(next);
  };
  const options = [
    { value: '', label: 'Tất cả' },
    ...places.khos.map((k) => ({ value: `k:${k.id}`, label: `${k.name} · ${k.dies}` })),
    ...places.partners.filter((p) => p.diesHeld > 0 || `x:${p.id}` === place).map((p) => ({ value: `x:${p.id}`, label: `${p.name} · ${p.diesHeld}` })),
  ];
  return (
    <>
      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
        <Segmented value={place} onChange={(v) => go({ place: String(v) })} options={options.map((o) => ({ value: o.value, label: <span style={{ padding: '0 4px' }}>{o.label}</span> }))} />
      </div>
      {/* Cùng nhịp với Kho vật tư: chọn nơi cách thẻ 16px, nội dung thẻ cách thanh thẻ 16px (trang ngoài gap 16) */}
      <Tabs activeKey={view} style={{ marginTop: 8, marginBottom: -16 }} onChange={(k) => go({ view: k })} items={DIE_VIEWS.map((v) => ({ key: v.key, label: v.label }))} />
    </>
  );
}

export function PageHead({ title, extra, children }: { title: string; extra?: ReactNode; children?: ReactNode }) {
  return (
    <Flex vertical gap={8}>
      {/* minHeight bằng hàng nút: trang có nút hay không thì tiêu đề vẫn cùng vị trí */}
      <Flex wrap gap={12} align="center" justify="space-between" style={{ minHeight: 40 }}>
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
