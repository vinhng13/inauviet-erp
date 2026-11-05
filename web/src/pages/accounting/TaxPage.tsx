import { Alert, Card, Col, Flex, Row, Statistic, Table } from 'antd';
import { useTax } from '../../api/accounting';
import type { Schemas } from '../../api/client';
import { formatDate, formatVnd } from '../../lib/format';
import { AccountingPage, monthLabel, type Period } from './common';

/** "Thuế GTGT": output VAT on revenue, input VAT on purchases, what is payable or carried forward */
export function AccountingTaxPage() {
  return <AccountingPage title="Thuế GTGT">{(period) => <Tax period={period} />}</AccountingPage>;
}

function Tax({ period }: { period: Period }) {
  const { data, isFetching } = useTax(period.id);
  const columns = [
    { title: 'Ngày', dataIndex: 'date', width: 110, render: formatDate },
    { title: 'Chứng từ', dataIndex: 'code', width: 150 },
    { title: 'Diễn giải', dataIndex: 'description' },
    { title: 'Giá trị chưa thuế', dataIndex: 'baseVnd', width: 160, align: 'right' as const, render: formatVnd },
    { title: 'Thuế GTGT', dataIndex: 'vatVnd', width: 140, align: 'right' as const, render: formatVnd },
  ];
  return (
    <Flex vertical gap={16}>
      <Alert type="info" showIcon message="Sổ nội bộ: thuế đầu ra tính 8% trên doanh thu khi khách nghiệm thu (không xuất hoá đơn điện tử). Số liệu để tham khảo khi kê khai." />
      <Row gutter={[12, 12]}>
        {[
          ['Thuế đầu ra', data?.outputVnd],
          ['Thuế đầu vào trong kỳ', data?.inputVnd],
          ['Đầu vào kỳ trước chuyển sang', data?.carriedInVnd],
          [data && data.carryForwardVnd > 0 ? 'Còn được khấu trừ chuyển kỳ sau' : `Phải nộp kỳ ${monthLabel(period.month)}`, data ? data.payableVnd || data.carryForwardVnd : undefined],
        ].map(([t, v]) => (
          <Col key={t as string} xs={12} md={6}>
            <Card size="small">
              <Statistic title={t as string} value={v === undefined ? '…' : formatVnd(v as number)} styles={{ content: { fontSize: 18 } }} />
            </Card>
          </Col>
        ))}
      </Row>
      <Card size="small" title="Thuế GTGT đầu ra (33311)">
        <Table<Schemas['TaxRowDto']> rowKey="entryId" size="small" loading={isFetching} dataSource={data?.output} pagination={false} scroll={{ x: 760 }} columns={columns} locale={{ emptyText: 'Không có' }} />
      </Card>
      <Card size="small" title="Thuế GTGT đầu vào được khấu trừ (1331)">
        <Table<Schemas['TaxRowDto']> rowKey="entryId" size="small" loading={isFetching} dataSource={data?.input} pagination={false} scroll={{ x: 760 }} columns={columns} locale={{ emptyText: 'Không có' }} />
      </Card>
    </Flex>
  );
}
