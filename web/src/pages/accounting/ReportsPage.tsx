import { Card, Flex, Select, Table, Tabs, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useGeneralLedger, usePnl } from '../../api/accounting';
import type { Schemas } from '../../api/client';
import { formatDate, formatVnd } from '../../lib/format';
import { AccountingPage, Balance, money, type Period } from './common';

/** "Báo cáo": profit and loss by month, and the general ledger of one account */
export function AccountingReportsPage() {
  return (
    <AccountingPage title="Báo cáo">
      {(period) => (
        <Tabs
          items={[
            { key: 'pnl', label: 'Kết quả kinh doanh', children: <Pnl /> },
            { key: 'gl', label: 'Sổ cái tài khoản', children: <Ledger period={period} /> },
          ]}
        />
      )}
    </AccountingPage>
  );
}

const PNL_ROWS: Array<{ key: keyof Schemas['PnlColumnDto']; label: string; sign?: string; strong?: boolean }> = [
  { key: 'revenueVnd', label: 'Doanh thu bán hàng (511)', strong: true },
  { key: 'cogsVnd', label: 'Giá vốn hàng bán (632, gồm chi phí SX chung)', sign: '−' },
  { key: 'sellingVnd', label: 'Chi phí bán hàng (6421)', sign: '−' },
  { key: 'adminVnd', label: 'Chi phí quản lý doanh nghiệp (6422)', sign: '−' },
  { key: 'otherNetVnd', label: 'Thu nhập / chi phí khác (thuần)', sign: '±' },
  { key: 'profitVnd', label: 'Lợi nhuận trước thuế', strong: true },
];

function Pnl() {
  const { data, isLoading } = usePnl();
  const columns = data?.columns ?? [];
  return (
    <Card size="small">
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        6 kỳ gần nhất và luỹ kế năm. Kỳ chưa khoá sổ là số tạm tính.
      </Typography.Paragraph>
      <Table
        rowKey="key"
        size="small"
        loading={isLoading}
        pagination={false}
        scroll={{ x: 200 + columns.length * 150 }}
        dataSource={PNL_ROWS}
        columns={[
          { title: 'Chỉ tiêu', key: 'l', fixed: 'left', width: 300, render: (_, r) => (r.strong ? <strong>{r.label}</strong> : <span style={{ paddingInlineStart: 12 }}>{r.sign} {r.label}</span>) },
          ...columns.map((c, i) => ({
            title: (
              <span>
                {c.label} {c.provisional && <Tag style={{ marginInlineStart: 4 }}>tạm</Tag>}
              </span>
            ),
            key: `c${i}`,
            align: 'right' as const,
            width: 150,
            render: (_: unknown, r: (typeof PNL_ROWS)[number]) => {
              const v = c[r.key] as number;
              return r.strong ? <strong style={{ color: r.key === 'profitVnd' && v < 0 ? '#cf1322' : undefined }}>{formatVnd(v)}</strong> : formatVnd(v);
            },
          })),
        ]}
      />
    </Card>
  );
}

function Ledger({ period }: { period: Period }) {
  const [account, setAccount] = useState('111');
  const { data, isFetching } = useGeneralLedger(period.id, account);
  return (
    <Flex vertical gap={12}>
      <Select
        id="gl-account"
        aria-label="Tài khoản"
        showSearch
        optionFilterProp="label"
        value={account}
        onChange={setAccount}
        style={{ width: 360 }}
        options={(data?.usedAccounts ?? [{ code: account, name: '', isCredit: false }]).map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` }))}
      />
      <Typography.Text>
        Số dư đầu kỳ <Balance value={data?.openingVnd ?? 0} /> · Phát sinh Nợ <strong>{formatVnd(data?.debitVnd ?? 0)}</strong> · Phát sinh Có <strong>{formatVnd(data?.creditVnd ?? 0)}</strong> · Số dư cuối kỳ{' '}
        <Balance value={data?.closingVnd ?? 0} />
      </Typography.Text>
      <Table<Schemas['GlRowDto']>
        rowKey={(r) => `${r.entryId}-${r.balanceVnd}-${r.debitVnd}-${r.creditVnd}`}
        size="small"
        loading={isFetching}
        dataSource={data?.rows}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
        locale={{ emptyText: 'Không có phát sinh trong kỳ' }}
        columns={[
          { title: 'Ngày', dataIndex: 'date', width: 105, render: formatDate },
          { title: 'Số', dataIndex: 'code', width: 150 },
          { title: 'Diễn giải', dataIndex: 'description' },
          { title: 'TK đối ứng', dataIndex: 'contra', width: 110 },
          { title: 'Nợ', dataIndex: 'debitVnd', width: 140, align: 'right', render: money },
          { title: 'Có', dataIndex: 'creditVnd', width: 140, align: 'right', render: money },
          { title: 'Số dư', dataIndex: 'balanceVnd', width: 170, align: 'right', render: (v: number) => <Balance value={v} /> },
        ]}
      />
    </Flex>
  );
}
