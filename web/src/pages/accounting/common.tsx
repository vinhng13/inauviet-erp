import { CalendarOutlined, LockOutlined, UnlockOutlined } from '@ant-design/icons';
import { App, Button, Card, DatePicker, Flex, Result, Select, Space, Spin, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAccountingMutations, useLedgerAccounts, useSelectedPeriod } from '../../api/accounting';
import type { Schemas } from '../../api/client';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatVnd } from '../../lib/format';

export type Period = Schemas['PeriodDto'];

/** "2026-10" → "10/2026" */
export const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;

export const STEP_LABEL: Record<Schemas['ClosingStep'], string> = {
  price: 'Tính giá xuất kho bình quân',
  depreciation: 'Khấu hao TSCĐ',
  allocation: 'Phân bổ công cụ dụng cụ',
  vat: 'Khấu trừ thuế GTGT',
  transfer: 'Kết chuyển lãi lỗ',
};

export const PAY_METHOD: Record<Schemas['PayMethod'], string> = { CASH: 'Tiền mặt (111)', BANK: 'Chuyển khoản (112)', CREDIT: 'Mua chịu (331)' };
export const COST_ACCOUNTS = [
  { value: '154', label: '154 · Chi phí SX dở dang' },
  { value: '6421', label: '6421 · Chi phí bán hàng' },
  { value: '6422', label: '6422 · Chi phí QLDN' },
];
export type VatRate = 0 | 5 | 8 | 10;
export const VAT_OPTIONS = ([0, 5, 8, 10] as VatRate[]).map((v) => ({ value: v, label: `${v}%` }));

export function PeriodTag({ period }: { period: Period }) {
  return period.status === 'CLOSED' ? (
    <Tag icon={<LockOutlined />} color="default">
      Đã khoá sổ
    </Tag>
  ) : (
    <Tag icon={<UnlockOutlined />} color="green">
      Đang mở
    </Tag>
  );
}

/** Signed amount for ledgers: credit balances shown in brackets-free "Có" form */
export function Balance({ value, credit }: { value: number; credit?: boolean }) {
  if (!value) return <span style={{ opacity: 0.45 }}>0</span>;
  const side = value > 0 ? 'Nợ' : 'Có';
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      {formatVnd(Math.abs(value))} <Typography.Text type="secondary" style={{ fontSize: 12 }}>{credit === undefined ? side : ''}</Typography.Text>
    </span>
  );
}

export const money = (v: number | null | undefined) => (v ? formatVnd(v) : <span style={{ opacity: 0.4 }}>—</span>);

/**
 * Frame of every accounting screen: title, the month being looked at, and the first-period setup when the
 * books have not started yet.
 */
export function AccountingPage({ title, extra, children }: { title: string; extra?: (period: Period) => ReactNode; children: (period: Period) => ReactNode }) {
  const { periods, list, period, setMonth, started } = useSelectedPeriod();
  if (periods.isLoading) return <Spin />;
  if (periods.error) return <Result status="warning" title="Không tải được sổ sách" subTitle={errorMessage(periods.error)} />;
  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Space wrap size={12} align="center">
          <Typography.Title level={3} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {started && period && (
            <>
              <Select
                id="period-select"
                aria-label="Kỳ kế toán"
                value={period.month}
                onChange={setMonth}
                style={{ width: 200 }}
                suffixIcon={<CalendarOutlined />}
                options={list.map((x) => ({ value: x.month, label: `Kỳ ${monthLabel(x.month)}${x.status === 'CLOSED' ? ' · đã khoá' : ''}` }))}
              />
              <PeriodTag period={period} />
            </>
          )}
        </Space>
        {started && period && extra?.(period)}
      </Flex>
      {started && period ? children(period) : <StartBooks />}
    </Flex>
  );
}

/** Before anything else: choose the first month kept in the books */
export function StartBooks() {
  const can = useCan();
  const { message } = App.useApp();
  const { start } = useAccountingMutations();
  const [month, setMonth] = useState<Dayjs | null>(dayjs().startOf('month'));
  return (
    <Card>
      <Result
        status="info"
        title="Sổ sách chưa bắt đầu"
        subTitle="Chọn tháng đầu tiên ghi sổ. Sau đó nhập số dư đầu kỳ và tồn kho đầu kỳ (lấy từ sổ cũ hoặc kiểm kê) trong mục Kỳ kế toán."
        extra={
          can('accounting.close') ? (
            <Space wrap>
              <DatePicker id="start-month" picker="month" format="MM/YYYY" value={month} onChange={setMonth} allowClear={false} />
              <Button
                type="primary"
                loading={start.isPending}
                disabled={!month}
                onClick={() =>
                  start.mutate(month!.format('YYYY-MM'), {
                    onSuccess: () => message.success(`Đã mở sổ từ kỳ ${month!.format('MM/YYYY')}`),
                    onError: (e) => message.error(errorMessage(e)),
                  })
                }
              >
                Bắt đầu ghi sổ
              </Button>
            </Space>
          ) : (
            <Typography.Text type="secondary">Nhờ kế toán trưởng (quyền khoá sổ) bắt đầu sổ sách.</Typography.Text>
          )
        }
      />
    </Card>
  );
}

/** Account picker over the chart of accounts */
export function AccountSelect(props: { value?: string; onChange?: (v: string) => void; id?: string; style?: React.CSSProperties; only?: string[] }) {
  const { data } = useLedgerAccounts();
  return (
    <Select
      showSearch
      optionFilterProp="label"
      placeholder="Tài khoản"
      {...props}
      options={(data ?? []).filter((a) => !props.only || props.only.includes(a.code)).map((a) => ({ value: a.code, label: `${a.code} · ${a.name}` }))}
    />
  );
}

export function PeriodClosedNote({ period }: { period: Period }) {
  if (period.status === 'OPEN') return null;
  return (
    <Typography.Text type="secondary">
      Kỳ {monthLabel(period.month)} đã khoá sổ: chỉ xem. <Link to={`/accounting/periods?ky=${period.month}`}>Mở lại kỳ</Link> nếu cần sửa.
    </Typography.Text>
  );
}

/** Plain list of rows (log lines, order warnings) */
export function Rows<T>({ items, render, empty, rowKey }: { items: T[]; render: (item: T) => ReactNode; empty?: string; rowKey: (item: T) => string }) {
  if (!items.length) return <Typography.Text type="secondary">{empty ?? 'Không có'}</Typography.Text>;
  return (
    <div role="list">
      {items.map((it) => (
        <div role="listitem" key={rowKey(it)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px', borderBottom: '1px solid rgba(5,5,5,0.06)', flexWrap: 'wrap' }}>
          {render(it)}
        </div>
      ))}
    </div>
  );
}
