import { PlusOutlined } from '@ant-design/icons';
import { Button, Flex, Input, Segmented, Table, Tag, Typography } from 'antd';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { Schemas } from '../api/client';
import { useQuotes } from '../api/hooks';
import { DocsDownload } from '../components/PrintMenu';
import { useCan } from '../lib/access';
import { formatDate, formatVnd } from '../lib/format';
import { QUOTE_STATUS } from '../lib/status';

type Status = Schemas['QuoteStatus'];
const TABS: Array<Status | 'ALL'> = ['ALL', 'DRAFT', 'SENT', 'WON', 'LOST'];

/** Step 1: quotes. Filters live in the URL so a filtered list can be bookmarked. */
export function QuotesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const can = useCan();
  const q = params.get('q') ?? '';
  const tab = (params.get('status') as Status | null) ?? 'ALL';
  const page = Number(params.get('page') ?? 1);
  const { data, isFetching } = useQuotes({ q: q || undefined, status: tab === 'ALL' ? undefined : tab, page, pageSize: 20 });
  const counts = data?.counts;
  const all = counts ? counts.DRAFT + counts.SENT + counts.WON + counts.LOST : 0;

  const set = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Báo giá
        </Typography.Title>
        {can('quotes.create') && (
          <Link to="/quotes/new">
            <Button type="primary" icon={<PlusOutlined />}>
              Lập báo giá
            </Button>
          </Link>
        )}
      </Flex>
      <Flex wrap gap={12} align="center">
        <Segmented
          value={tab}
          onChange={(v) => set('status', v === 'ALL' ? undefined : String(v))}
          options={TABS.map((t) => ({ value: t, label: `${t === 'ALL' ? 'Tất cả' : QUOTE_STATUS[t].label} (${t === 'ALL' ? all : (counts?.[t] ?? 0)})` }))}
        />
        <Input.Search id="quotes-search" key={q} defaultValue={q} placeholder="Mã báo giá, khách hàng, SĐT, hạng mục" allowClear onSearch={(v) => set('q', v.trim() || undefined)} style={{ width: 320 }} />
      </Flex>
      <Table<Schemas['QuoteListItemDto']>
        rowKey="id"
        size="middle"
        loading={isFetching}
        dataSource={data?.items}
        scroll={{ x: 900 }}
        onRow={(r) => ({ onClick: () => navigate(`/quotes/${r.id}`), style: { cursor: 'pointer' } })}
        pagination={{ current: page, pageSize: 20, total: data?.total, showSizeChanger: false, onChange: (p) => set('page', String(p)) }}
        columns={[
          { title: 'Mã báo giá', dataIndex: 'code', width: 140, render: (v: string) => <strong>{v}</strong> },
          { title: 'Khách hàng', key: 'customer', render: (_, r) => r.customer.name },
          { title: 'Nội dung', dataIndex: 'title', render: (v: string | null, r) => v ?? `${r.lineCount} hạng mục` },
          { title: 'Ngày lập', dataIndex: 'quoteDate', width: 110, render: formatDate },
          {
            title: 'Hiệu lực đến',
            dataIndex: 'validUntil',
            width: 130,
            render: (v: string, r) => (r.isExpired ? <Tag color="orange">Hết hạn {formatDate(v)}</Tag> : formatDate(v)),
          },
          ...(can('money.view') ? [{ title: 'Giá trị', dataIndex: 'totalVnd', width: 140, align: 'right' as const, render: (v: number) => formatVnd(v) }] : []),
          {
            title: 'Trạng thái',
            dataIndex: 'status',
            width: 190,
            render: (s: Status, r) => (
              <Tag color={QUOTE_STATUS[s].color}>
                {QUOTE_STATUS[s].label}
                {r.order ? ` · ${r.order.code}` : ''}
              </Tag>
            ),
          },
          ...(can('money.view')
            ? [
                {
                  title: '',
                  key: 'print',
                  width: 48,
                  render: (_: unknown, r: Schemas['QuoteListItemDto']) => <DocsDownload docs={[{ kind: 'quote', sourceId: r.id, label: 'Báo giá' }]} code={r.code} />,
                },
              ]
            : []),
        ]}
      />
    </Flex>
  );
}
