import { DownloadOutlined, FileZipOutlined } from '@ant-design/icons';
import { Button, Card, Empty, Flex, Skeleton, Space, Tag, Tooltip, Typography, theme } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Schemas } from '../api/client';
import { useCustomerDocuments } from '../api/hooks';
import { useCan } from '../lib/access';
import { customerZipUrl, downloadDoc, downloadFile, openDoc, orderZipUrl, type DocKind } from '../lib/download';
import { formatDate, formatVnd } from '../lib/format';
import { ORDER_STATUS, QUOTE_STATUS } from '../lib/status';
import { useDownload } from './PrintMenu';

type Row = Schemas['CustomerDocumentRowDto'];
type File = Schemas['DocumentFileDto'];

/** Filter chips, same order as the 6 steps */
const KINDS: Array<{ kind: DocKind; label: string }> = [
  { kind: 'quote', label: 'Báo giá' },
  { kind: 'order', label: 'Đơn hàng' },
  { kind: 'design', label: 'Thiết kế' },
  { kind: 'lsx', label: 'Lệnh SX' },
  { kind: 'acceptance', label: 'Giao hàng (nghiệm thu)' },
  { kind: 'invoice', label: 'Hoá đơn' },
];

/**
 * Every quote and order of the customer with its documents: view or download one file, download one
 * order's set, or everything of the chosen kinds as one zip (a folder per order).
 */
export function CustomerDocuments({ customerId }: { customerId: string }) {
  const can = useCan();
  const { token } = theme.useToken();
  const { data, isLoading } = useCustomerDocuments(customerId);
  const { busy, run } = useDownload();
  const [kinds, setKinds] = useState<DocKind[]>(KINDS.map((k) => k.kind));
  const showMoney = can('money.view');

  const rows = data?.rows ?? [];
  const pick = (files: File[]) => files.filter((f) => kinds.includes(f.kind));
  const total = rows.reduce((n, r) => n + pick(r.files).length, 0);
  const allKinds = kinds.length === KINDS.length;
  const toggle = (k: DocKind, on: boolean) => setKinds((cur) => (on ? KINDS.map((x) => x.kind).filter((x) => x === k || cur.includes(x)) : cur.filter((x) => x !== k)));

  return (
    <Card
      size="small"
      title={`Báo giá, đơn hàng & tài liệu (${rows.length})`}
      extra={
        <Button
          type="primary"
          icon={<FileZipOutlined />}
          disabled={total === 0}
          loading={busy}
          onClick={() => run(() => downloadFile(customerZipUrl(customerId, allKinds ? undefined : kinds), data?.zipName))}
        >
          Tải toàn bộ ({total} file, .zip)
        </Button>
      }
    >
      <Flex wrap gap={6} align="center" style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">Loại tài liệu cần tải:</Typography.Text>
        {KINDS.map((k) => (
          <Tag.CheckableTag key={k.kind} checked={kinds.includes(k.kind)} onChange={(on) => toggle(k.kind, on)} style={{ border: `1px solid ${token.colorBorder}` }}>
            {k.label}
          </Tag.CheckableTag>
        ))}
      </Flex>
      {isLoading ? (
        <Skeleton active />
      ) : rows.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Khách chưa có báo giá hay đơn hàng nào" />
      ) : (
        <Flex vertical gap={8}>
          {rows.map((r) => (
            <DocRow key={r.key} row={r} files={pick(r.files)} showMoney={showMoney} />
          ))}
        </Flex>
      )}
    </Card>
  );
}

function DocRow({ row: r, files, showMoney }: { row: Row; files: File[]; showMoney: boolean }) {
  const { token } = theme.useToken();
  const { busy, run } = useDownload();
  const status = r.orderStatus ? ORDER_STATUS[r.orderStatus] : r.quoteStatus ? QUOTE_STATUS[r.quoteStatus] : null;
  const code = r.orderCode ?? r.quoteCode ?? '';
  return (
    <div style={{ border: `1px solid ${token.colorBorderSecondary}`, borderRadius: token.borderRadius, padding: '8px 12px' }}>
      <Flex wrap gap="4px 12px" align="center">
        {r.orderId ? (
          <Link to={`/orders/${r.orderId}`} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            {r.orderCode}
          </Link>
        ) : (
          <Link to={`/quotes/${r.quoteId}`} style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            {r.quoteCode}
          </Link>
        )}
        {r.orderId && r.quoteCode && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            từ {r.quoteCode}
          </Typography.Text>
        )}
        <Typography.Text type="secondary" ellipsis style={{ flex: 1, minWidth: 160 }}>
          {formatDate(r.date)} · {r.title}
        </Typography.Text>
        {status && <Tag color={status.color}>{r.orderStatus ? status.label : `Báo giá · ${status.label}`}</Tag>}
        {showMoney && r.totalVnd != null && <Typography.Text strong>{formatVnd(r.totalVnd)}</Typography.Text>}
      </Flex>
      <Flex wrap gap={6} align="center" style={{ marginTop: 6 }}>
        {files.map((f) => (
          <Space.Compact key={`${f.kind}:${f.sourceId}`} size="small">
            <Tooltip title={`Xem / in ${f.fileName}`}>
              <Button size="small" onClick={() => openDoc(f.kind, f.sourceId)}>
                {f.label}
              </Button>
            </Tooltip>
            <Tooltip title={`Tải ${f.fileName}`}>
              <Button size="small" icon={<DownloadOutlined />} aria-label={`Tải ${f.fileName}`} onClick={() => run(() => downloadDoc(f.kind, f.sourceId))} />
            </Tooltip>
          </Space.Compact>
        ))}
        {files.length === 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Không có tài liệu thuộc loại đã chọn
          </Typography.Text>
        )}
        <span style={{ flex: 1 }} />
        {files.length > 1 && r.orderId && (
          <Button
            size="small"
            icon={<FileZipOutlined />}
            loading={busy}
            onClick={() => run(() => downloadFile(orderZipUrl(r.orderId!, files.map((f) => f.kind)), `${code}_TaiLieu.zip`))}
          >
            Tải cả bộ ({files.length})
          </Button>
        )}
      </Flex>
    </div>
  );
}
