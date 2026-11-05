import { Card, Col, Flex, Row, Statistic, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router';
import { useDebts } from '../../api/accounting';
import type { Schemas } from '../../api/client';
import { formatDate, formatVnd } from '../../lib/format';
import { AccountingPage, money, monthLabel, type Period } from './common';

/** "Phải thu – phải trả": balances of 131 by customer and 331 by supplier at the end of the month */
export function AccountingDebtsPage() {
  return <AccountingPage title="Phải thu – phải trả">{(period) => <Debts period={period} />}</AccountingPage>;
}

function Debts({ period }: { period: Period }) {
  const { data, isFetching } = useDebts(period.id);
  return (
    <Flex vertical gap={16}>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title={`Phải thu cuối kỳ ${monthLabel(period.month)}`} value={data ? formatVnd(data.receivableTotalVnd) : '…'} styles={{ content: { fontSize: 18 } }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="Phải trả cuối kỳ" value={data ? formatVnd(data.payableTotalVnd) : '…'} styles={{ content: { fontSize: 18 } }} />
          </Card>
        </Col>
      </Row>
      <Card size="small" title="Phải thu khách hàng (131)" extra={<Link to="/payments">Thu tiền theo đơn</Link>}>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Công nợ ghi nhận khi khách ký nghiệm thu (gồm thuế GTGT 8%); tiền cọc thu trước nghiệm thu hiện ở cột "Trả trước".
        </Typography.Paragraph>
        <Table<Schemas['ReceivableRowDto']>
          rowKey={(r) => r.customerId ?? 'opening'}
          size="small"
          loading={isFetching}
          dataSource={data?.receivables}
          pagination={{ pageSize: 30, hideOnSinglePage: true }}
          scroll={{ x: 700 }}
          locale={{ emptyText: 'Không có công nợ phải thu' }}
          columns={[
            { title: 'Khách hàng', key: 'c', render: (_, r) => (r.customerId ? <Link to={`/customers/${r.customerId}`}>{r.customerName}</Link> : <Typography.Text type="secondary">{r.customerName}</Typography.Text>) },
            { title: 'Còn nợ', dataIndex: 'oweVnd', width: 150, align: 'right', render: (v: number) => (v ? <strong>{formatVnd(v)}</strong> : money(v)) },
            { title: 'Trả trước', dataIndex: 'advanceVnd', width: 150, align: 'right', render: money },
            { title: 'Nợ từ ngày', key: 'd', width: 170, render: (_, r) => (r.oldestDate ? <>{formatDate(r.oldestDate)} {r.overdue30 && <Tag color="red">quá 30 ngày</Tag>}</> : '—') },
          ]}
        />
      </Card>
      <Card size="small" title="Phải trả nhà cung cấp (331)" extra={<Link to={`/accounting/cash?ky=${period.month}`}>Lập phiếu chi trả nợ</Link>}>
        <Table<Schemas['PayableRowDto']>
          rowKey={(r) => r.supplierId ?? 'opening'}
          size="small"
          loading={isFetching}
          dataSource={data?.payables}
          pagination={{ pageSize: 30, hideOnSinglePage: true }}
          scroll={{ x: 700 }}
          locale={{ emptyText: 'Không có công nợ phải trả' }}
          columns={[
            { title: 'Nhà cung cấp', dataIndex: 'supplierName' },
            { title: 'Mua chịu', dataIndex: 'boughtVnd', width: 150, align: 'right', render: money },
            { title: 'Đã trả', dataIndex: 'paidVnd', width: 150, align: 'right', render: money },
            { title: 'Còn phải trả', dataIndex: 'balanceVnd', width: 160, align: 'right', render: (v: number) => <strong>{formatVnd(v)}</strong> },
          ]}
        />
      </Card>
    </Flex>
  );
}
