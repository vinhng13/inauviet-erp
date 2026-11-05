import { SaveOutlined, UnlockOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Flex, InputNumber, Space, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAccountingMutations, useMaterials, useOpenings, useSelectedPeriod, useStock } from '../../api/accounting';
import type { Schemas } from '../../api/client';
import { ReasonModal } from '../../components/ReasonModal';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatVnd, vndInputProps } from '../../lib/format';
import { AccountingPage, monthLabel, PeriodTag, Rows, type Period } from './common';

/** "Kỳ kế toán": months, who closed them, reopening, and the opening balances of the first month */
export function AccountingPeriodsPage() {
  return <AccountingPage title="Kỳ kế toán">{() => <Periods />}</AccountingPage>;
}

function Periods() {
  const can = useCan();
  const { message } = App.useApp();
  const { periods, list } = useSelectedPeriod();
  const { reopen } = useAccountingMutations();
  const [reopening, setReopening] = useState<Period | null>(null);
  const first = list[0];
  const rows = periods.data?.periods ?? [];

  return (
    <Flex vertical gap={16}>
      <Table<Period>
        rowKey="id"
        dataSource={rows}
        pagination={false}
        scroll={{ x: 900 }}
        columns={[
          { title: 'Kỳ', dataIndex: 'month', width: 110, render: (m: string) => <Link to={`/accounting?ky=${m}`}><strong>{monthLabel(m)}</strong></Link> },
          { title: 'Trạng thái', key: 's', width: 140, render: (_, p) => <PeriodTag period={p} /> },
          { title: 'Bước cuối kỳ', key: 'steps', width: 130, render: (_, p) => (p.status === 'CLOSED' ? '5/5' : `${p.stepsDone.length}/5`) },
          { title: 'Doanh thu', dataIndex: 'revenueVnd', width: 150, align: 'right', render: formatVnd },
          {
            title: 'Lợi nhuận',
            key: 'profit',
            width: 170,
            align: 'right',
            render: (_, p) => (
              <span style={{ color: p.profitVnd < 0 ? '#cf1322' : undefined }}>
                {formatVnd(p.profitVnd)}
                {p.provisional && <Typography.Text type="secondary" style={{ fontSize: 12 }}> tạm tính</Typography.Text>}
              </span>
            ),
          },
          { title: 'Khoá sổ', key: 'closed', render: (_, p) => (p.closedAt ? `${p.closedByName ?? ''} · ${formatDateTime(p.closedAt)}` : '—') },
          {
            title: '',
            key: 'a',
            width: 130,
            render: (_, p) =>
              p.canReopen && can('accounting.reopen') ? (
                <Button size="small" icon={<UnlockOutlined />} onClick={() => setReopening(p)}>
                  Mở lại kỳ
                </Button>
              ) : null,
          },
        ]}
      />
      <ReasonModal
        open={!!reopening}
        title={`Mở lại kỳ ${reopening ? monthLabel(reopening.month) : ''}`}
        okText="Mở lại kỳ"
        danger
        description="Các bước cuối kỳ sẽ phải chạy lại và khoá sổ lại. Chỉ mở lại được kỳ khoá gần nhất."
        loading={reopen.isPending}
        onCancel={() => setReopening(null)}
        onSubmit={(reason) =>
          reopen.mutate(
            { id: reopening!.id, reason },
            { onSuccess: () => { message.success('Đã mở lại kỳ'); setReopening(null); }, onError: (e) => message.error(errorMessage(e)) },
          )
        }
      />

      <Tabs
        items={[
          { key: 'openings', label: `Số dư đầu kỳ ${first ? monthLabel(first.month) : ''}`, children: first && <Openings first={first} /> },
          { key: 'stock', label: 'Tồn kho đầu kỳ', children: first && <StockOpenings first={first} /> },
          {
            key: 'log',
            label: 'Nhật ký khoá sổ',
            children: (
              <Rows
                items={periods.data?.log ?? []}
                rowKey={(l) => l.id}
                empty="Chưa có thao tác nào"
                render={(l) => (
                  <>
                    <span style={{ flex: 1, minWidth: 240 }}>{l.text}</span>
                    <Typography.Text type="secondary" style={{ whiteSpace: 'nowrap' }}>
                      {l.userName ?? 'Hệ thống'} · {formatDateTime(l.createdAt)}
                    </Typography.Text>
                  </>
                )}
              />
            ),
          },
        ]}
      />
    </Flex>
  );
}

type OpeningRow = Schemas['TrialBalanceRowDto'];

function Openings({ first }: { first: Period }) {
  const can = useCan();
  const { message } = App.useApp();
  const { data, isLoading } = useOpenings();
  const { saveOpenings } = useAccountingMutations();
  const [rows, setRows] = useState<OpeningRow[]>([]);
  useEffect(() => setRows(data?.lines ?? []), [data]);
  const editable = !!data?.editable && can('accounting.close');
  const difference = useMemo(() => rows.reduce((s, r) => s + r.debitVnd - r.creditVnd, 0), [rows]);
  const set = (account: string, field: 'debitVnd' | 'creditVnd', v: number | null) =>
    setRows((rs) => rs.map((r) => (r.account === account ? { ...r, [field]: v ?? 0, ...(v ? { [field === 'debitVnd' ? 'creditVnd' : 'debitVnd']: 0 } : {}) } : r)));

  return (
    <Card size="small" loading={isLoading}>
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">
          Số dư các tài khoản tại ngày 01/{monthLabel(first.month)}, lấy từ sổ cũ. Tài khoản 152 lấy tự động từ tồn kho đầu kỳ.
          {!data?.editable && ' Kỳ đầu tiên đã khoá sổ nên số dư đầu kỳ không sửa được nữa.'}
        </Typography.Text>
        {difference !== 0 && <Alert type="warning" showIcon message={`Tổng Nợ và tổng Có lệch ${formatVnd(Math.abs(difference))}. Các bước cuối kỳ chỉ chạy được khi số dư đầu kỳ cân.`} />}
        <Table<OpeningRow>
          rowKey="account"
          size="small"
          dataSource={rows}
          pagination={false}
          scroll={{ x: 640, y: 520 }}
          columns={[
            { title: 'TK', dataIndex: 'account', width: 80 },
            { title: 'Tên tài khoản', dataIndex: 'name' },
            {
              title: 'Dư Nợ',
              key: 'd',
              width: 190,
              align: 'right',
              render: (_, r) =>
                editable && r.account !== '152' ? (
                  <InputNumber {...vndInputProps} aria-label={`Dư Nợ ${r.account}`} value={r.debitVnd || undefined} onChange={(v) => set(r.account, 'debitVnd', v)} style={{ width: 170 }} />
                ) : (
                  formatVnd(r.debitVnd)
                ),
            },
            {
              title: 'Dư Có',
              key: 'c',
              width: 190,
              align: 'right',
              render: (_, r) =>
                editable && r.account !== '152' ? (
                  <InputNumber {...vndInputProps} aria-label={`Dư Có ${r.account}`} value={r.creditVnd || undefined} onChange={(v) => set(r.account, 'creditVnd', v)} style={{ width: 170 }} />
                ) : (
                  formatVnd(r.creditVnd)
                ),
            },
          ]}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={2}>
                <strong>Tổng</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2} align="right">
                <strong>{formatVnd(rows.reduce((s, r) => s + r.debitVnd, 0))}</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3} align="right">
                <strong>{formatVnd(rows.reduce((s, r) => s + r.creditVnd, 0))}</strong>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
        {editable && (
          <Space>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saveOpenings.isPending}
              onClick={() =>
                saveOpenings.mutate(
                  { lines: rows.filter((r) => r.account !== '152' && (r.debitVnd || r.creditVnd)).map((r) => ({ account: r.account, debitVnd: r.debitVnd, creditVnd: r.creditVnd })) },
                  { onSuccess: () => message.success('Đã lưu số dư đầu kỳ'), onError: (e) => message.error(errorMessage(e)) },
                )
              }
            >
              Lưu số dư đầu kỳ
            </Button>
          </Space>
        )}
      </Flex>
    </Card>
  );
}

function StockOpenings({ first }: { first: Period }) {
  const can = useCan();
  const { message } = App.useApp();
  const materials = useMaterials();
  const stock = useStock(first.id);
  const { saveStockOpenings } = useAccountingMutations();
  const [rows, setRows] = useState<Record<string, { qty: number; priceVnd: number }>>({});
  useEffect(() => {
    const next: Record<string, { qty: number; priceVnd: number }> = {};
    for (const r of stock.data?.rows ?? []) next[r.materialId] = { qty: r.openQty, priceVnd: r.openPriceVnd };
    setRows(next);
  }, [stock.data]);
  const editable = first.status === 'OPEN' && can('accounting.close');
  const list = (materials.data ?? []).filter((m) => m.isActive || rows[m.id]?.qty);
  const total = Object.values(rows).reduce((s, r) => s + Math.round(r.qty * r.priceVnd), 0);
  const set = (id: string, field: 'qty' | 'priceVnd', v: number | null) => setRows((rs) => ({ ...rs, [id]: { ...(rs[id] ?? { qty: 0, priceVnd: 0 }), [field]: v ?? 0 } }));

  return (
    <Card size="small" loading={materials.isLoading || stock.isLoading}>
      <Flex vertical gap={12}>
        <Typography.Text type="secondary">
          Số lượng và đơn giá vật tư còn trong kho ngày 01/{monthLabel(first.month)} (theo kiểm kê). Thêm vật tư mới ở mục <Link to="/accounting/stock">Kho NVL</Link>.
        </Typography.Text>
        <Table
          rowKey="id"
          size="small"
          dataSource={list}
          pagination={false}
          scroll={{ x: 640 }}
          columns={[
            { title: 'Mã', dataIndex: 'code', width: 120 },
            { title: 'Vật tư', dataIndex: 'name' },
            { title: 'ĐVT', dataIndex: 'unit', width: 70 },
            {
              title: 'Số lượng',
              key: 'q',
              width: 150,
              align: 'right',
              render: (_, m) => (editable ? <InputNumber aria-label={`Số lượng ${m.code}`} min={0} precision={3} value={rows[m.id]?.qty || undefined} onChange={(v) => set(m.id, 'qty', v)} style={{ width: 130 }} /> : rows[m.id]?.qty ?? 0),
            },
            {
              title: 'Đơn giá',
              key: 'p',
              width: 180,
              align: 'right',
              render: (_, m) => (editable ? <InputNumber {...vndInputProps} aria-label={`Đơn giá ${m.code}`} value={rows[m.id]?.priceVnd || undefined} onChange={(v) => set(m.id, 'priceVnd', v)} style={{ width: 160 }} /> : formatVnd(rows[m.id]?.priceVnd ?? 0)),
            },
            { title: 'Giá trị', key: 'v', width: 150, align: 'right', render: (_, m) => formatVnd(Math.round((rows[m.id]?.qty ?? 0) * (rows[m.id]?.priceVnd ?? 0))) },
          ]}
        />
        <Flex justify="space-between" align="center" wrap gap={12}>
          <span>
            Tổng giá trị (số dư đầu kỳ TK 152): <strong>{formatVnd(total)}</strong> <Tag>tự cập nhật</Tag>
          </span>
          {editable && (
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saveStockOpenings.isPending}
              onClick={() =>
                saveStockOpenings.mutate(
                  { lines: Object.entries(rows).filter(([, r]) => r.qty > 0).map(([materialId, r]) => ({ materialId, qty: r.qty, priceVnd: r.priceVnd })) },
                  { onSuccess: () => message.success('Đã lưu tồn kho đầu kỳ'), onError: (e) => message.error(errorMessage(e)) },
                )
              }
            >
              Lưu tồn kho đầu kỳ
            </Button>
          )}
        </Flex>
      </Flex>
    </Card>
  );
}
