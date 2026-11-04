import { DownloadOutlined, EyeOutlined, FileZipOutlined, PrinterOutlined } from '@ant-design/icons';
import { App, Button, Dropdown, Tooltip, type MenuProps } from 'antd';
import { useState } from 'react';
import type { Schemas } from '../api/client';
import { useCan } from '../lib/access';
import { downloadDoc, downloadFile, openDoc, orderZipUrl, type DocKind } from '../lib/download';
import { errorMessage } from '../lib/errors';

export interface DocRef {
  kind: DocKind;
  /** Quote id for "quote", order id otherwise */
  sourceId: string;
  label: string;
}

export const DOC_LABEL: Record<DocKind, string> = {
  quote: 'Báo giá',
  order: 'Đơn hàng',
  design: 'Duyệt thiết kế',
  lsx: 'Lệnh sản xuất',
  acceptance: 'Biên bản nghiệm thu',
  invoice: 'Hoá đơn bán hàng',
};

/** Same availability rules as the server (DocumentsService.orderKinds), from an order card or detail. */
export function orderDocs(
  o: {
    id: string;
    status: Schemas['OrderStatus'];
    quote: { id: string } | null;
    hasDesign: boolean;
    productionStarted: boolean;
    tripsDelivered: number;
  },
  can: (p: Parameters<ReturnType<typeof useCan>>[0]) => boolean,
): DocRef[] {
  const money = can('money.view');
  const refs: DocRef[] = [];
  const add = (kind: DocKind, sourceId = o.id) => refs.push({ kind, sourceId, label: DOC_LABEL[kind] });
  if (o.quote && money && can('quotes.view')) add('quote', o.quote.id);
  if (money) add('order');
  if (o.hasDesign) add('design');
  if (o.productionStarted) add('lsx');
  if (o.status === 'DELIVERING' || o.status === 'COMPLETED' || o.tripsDelivered > 0) add('acceptance');
  if (money) add('invoice');
  return refs;
}

export const cardDocs = (o: Schemas['OrderCardDto'], can: Parameters<typeof orderDocs>[1]) =>
  orderDocs(
    {
      id: o.id,
      status: o.status,
      quote: o.quote,
      hasDesign: o.lastDesignVersion !== null,
      productionStarted: o.productionCode !== null || o.productionStage !== null,
      tripsDelivered: o.tripsDelivered,
    },
    can,
  );

export const detailDocs = (o: Schemas['OrderDetailDto'], can: Parameters<typeof orderDocs>[1]) =>
  orderDocs(
    {
      id: o.id,
      status: o.status,
      quote: o.quote,
      hasDesign: o.design.versions.length > 0,
      productionStarted: o.production !== null,
      tripsDelivered: o.deliveries.filter((d) => d.status === 'DELIVERED').length,
    },
    can,
  );

/** Runs a download and shows the API's message when it fails. */
export function useDownload() {
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const run = async (p: () => Promise<void>) => {
    setBusy(true);
    const hide = message.loading('Đang tạo file…', 0);
    try {
      await p();
    } catch (err) {
      message.error(errorMessage(err));
    } finally {
      hide();
      setBusy(false);
    }
  };
  return { busy, run };
}

/**
 * Download icon for a row in a list: one document downloads at once; several open a menu with each file
 * and "Tải cả bộ (.zip)". Clicks don't open the row.
 */
export function DocsDownload({ docs, orderId, code }: { docs: DocRef[]; orderId?: string; code: string }) {
  const { busy, run } = useDownload();
  if (docs.length === 0) return null;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  if (docs.length === 1) {
    const d = docs[0];
    return (
      <span onClick={stop}>
        <Tooltip title={`Tải ${d.label} (PDF)`}>
          <Button type="text" size="small" icon={<DownloadOutlined />} loading={busy} aria-label={`Tải ${d.label} ${code}`} onClick={() => run(() => downloadDoc(d.kind, d.sourceId))} />
        </Tooltip>
      </span>
    );
  }
  const items: MenuProps['items'] = [
    { type: 'group', label: `Tài liệu ${code}`, children: docs.map((d) => ({ key: `${d.kind}:${d.sourceId}`, icon: <DownloadOutlined />, label: d.label })) },
    ...(orderId ? [{ type: 'divider' as const }, { key: 'zip', icon: <FileZipOutlined />, label: `Tải cả bộ (${docs.length} file, .zip)` }] : []),
  ];
  return (
    <span onClick={stop}>
      <Dropdown
        trigger={['click']}
        menu={{
          items,
          onClick: ({ key }) => {
            if (key === 'zip' && orderId) return run(() => downloadFile(orderZipUrl(orderId), `${code}_TaiLieu.zip`));
            const [kind, id] = key.split(':') as [DocKind, string];
            return run(() => downloadDoc(kind, id));
          },
        }}
      >
        <Tooltip title="Tải tài liệu">
          <Button type="text" size="small" icon={<DownloadOutlined />} loading={busy} aria-label={`Tải tài liệu ${code}`} />
        </Tooltip>
      </Dropdown>
    </span>
  );
}

/** Download icon for an order card in a list */
export function OrderDocsDownload({ order }: { order: Schemas['OrderCardDto'] }) {
  const can = useCan();
  return <DocsDownload docs={cardDocs(order, can)} orderId={order.id} code={order.code} />;
}

/** "In / tải" menu on the order page: view (to print) or download each document, or all as a zip */
export function OrderDocsMenu({ order }: { order: Schemas['OrderDetailDto'] }) {
  const can = useCan();
  const { busy, run } = useDownload();
  const docs = detailDocs(order, can);
  if (docs.length === 0) return null;
  const items: MenuProps['items'] = [
    { type: 'group', label: 'Xem / in', children: docs.map((d) => ({ key: `view:${d.kind}:${d.sourceId}`, icon: <EyeOutlined />, label: d.label })) },
    { type: 'divider' },
    { type: 'group', label: 'Tải về (PDF)', children: docs.map((d) => ({ key: `dl:${d.kind}:${d.sourceId}`, icon: <DownloadOutlined />, label: d.label })) },
    { type: 'divider' },
    { key: 'zip', icon: <FileZipOutlined />, label: `Tải cả bộ (${docs.length} file, .zip)` },
  ];
  return (
    <Dropdown
      trigger={['click']}
      menu={{
        items,
        onClick: ({ key }) => {
          if (key === 'zip') return run(() => downloadFile(orderZipUrl(order.id), `${order.code}_TaiLieu.zip`));
          const [action, kind, id] = key.split(':') as ['view' | 'dl', DocKind, string];
          if (action === 'view') return openDoc(kind, id);
          return run(() => downloadDoc(kind, id));
        },
      }}
    >
      <Button icon={<PrinterOutlined />} loading={busy}>
        In / tải tài liệu
      </Button>
    </Dropdown>
  );
}
