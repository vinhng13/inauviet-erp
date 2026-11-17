import { WarningOutlined } from '@ant-design/icons';
import { Alert, Card, Col, Empty, Flex, List, Row, Spin, Statistic, Table, Tag, Typography } from 'antd';
import { Link, useNavigate } from 'react-router';
import { useWhOverview, type DieRow } from '../../api/warehouse';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { DieStatusTag, PageHead, qty, SLIP, STATUS, type DieStatus } from './common';

/** Tổng quan kho: vật tư dưới mức tối thiểu, khuôn đang ở xưởng, quá hạn, chờ kiểm, cần xác nhận */
export function WarehouseOverviewPage() {
  const { data, isLoading, error } = useWhOverview();
  const navigate = useNavigate();
  if (isLoading) return <Spin />;
  if (error || !data) return <Alert type="warning" title="Không tải được tổng quan kho" description={errorMessage(error)} />;
  const dieColumns = [
    { title: 'Mã', dataIndex: 'code', width: 100, render: (v: string, r: DieRow) => <Link to={`/warehouse/dies?open=${r.id}`}>{v}</Link> },
    { title: 'Khuôn', dataIndex: 'productName', ellipsis: true },
    { title: 'Ở đâu', dataIndex: 'place', width: 150 },
    { title: 'Hẹn về', dataIndex: 'expectedBackOn', width: 110, render: formatDate },
  ];
  return (
    <Flex vertical gap={16}>
      <PageHead title="Tổng quan kho" />
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <Card size="small"><Statistic title="Khuôn đang quản lý" value={data.diesTotal} /></Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" hoverable onClick={() => navigate('/warehouse/dies?flag=out')}>
            <Statistic title="Khuôn đang ở xưởng ngoài" value={data.atPartners.reduce((s, p) => s + p.inUse + p.kept, 0)} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" hoverable onClick={() => navigate('/warehouse/dies?flag=overdue')}>
            <Statistic title="Quá hẹn chưa về" value={data.overdue.length} styles={{ content: { color: data.overdue.length ? '#cf1322' : undefined } }} />
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small" hoverable onClick={() => navigate('/warehouse/dies?flag=review')}>
            <Statistic title="Cần xác nhận thông tin" value={data.needsReview} styles={{ content: { color: data.needsReview ? '#d46b08' : undefined } }} />
          </Card>
        </Col>
      </Row>
      <Flex wrap gap={6}>
        {(Object.keys(STATUS) as DieStatus[]).filter((s) => data.diesByStatus[s]).map((s) => (
          <Link key={s} to={`/warehouse/dies?status=${s}`}>
            <Tag color={STATUS[s].color}>{STATUS[s].label}: {data.diesByStatus[s]}</Tag>
          </Link>
        ))}
      </Flex>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Khuôn theo xưởng">
            <Table
              rowKey="holderId"
              size="small"
              pagination={false}
              dataSource={data.atPartners}
              locale={{ emptyText: 'Không có khuôn nào ở xưởng ngoài' }}
              columns={[
                { title: 'Xưởng', dataIndex: 'name', render: (v: string, r) => <Link to={`/warehouse/dies?place=${r.holderId}`}>{v}</Link> },
                { title: 'Đang bế', dataIndex: 'inUse', align: 'right', width: 90 },
                { title: 'Gửi giữ', dataIndex: 'kept', align: 'right', width: 90 },
                { title: 'Quá hẹn', dataIndex: 'overdue', align: 'right', width: 90, render: (v: number) => (v ? <Typography.Text type="danger">{v}</Typography.Text> : 0) },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title={<span><WarningOutlined style={{ color: '#cf1322' }} /> Quá hẹn chưa về</span>}>
            <Table<DieRow> rowKey="id" size="small" pagination={{ pageSize: 8, hideOnSinglePage: true }} dataSource={data.overdue} columns={dieColumns} locale={{ emptyText: 'Không có khuôn quá hẹn' }} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Khuôn chờ kiểm">
            <Table<DieRow>
              rowKey="id"
              size="small"
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              dataSource={data.checking}
              locale={{ emptyText: 'Không có khuôn chờ kiểm' }}
              columns={[...dieColumns.slice(0, 2), { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (s: DieStatus) => <DieStatusTag status={s} /> }]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Vật tư dưới mức tối thiểu" extra={<Link to="/warehouse/stock">Tồn kho</Link>}>
            {data.lowStock.length ? (
              <List
                size="small"
                dataSource={data.lowStock}
                renderItem={(i) => (
                  <List.Item extra={<Typography.Text type="danger">{qty(i.qty)} / {qty(i.minQty ?? 0)} {i.unit}</Typography.Text>}>{i.label}</List.Item>
                )}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có vật tư nào dưới mức tối thiểu" />
            )}
          </Card>
        </Col>
        <Col xs={24}>
          <Card size="small" title="Phiếu gần đây" extra={<Link to="/warehouse/stock?tab=slips">Tất cả phiếu</Link>}>
            <Table
              rowKey="id"
              size="small"
              pagination={false}
              dataSource={data.recentSlips}
              locale={{ emptyText: 'Chưa có phiếu' }}
              columns={[
                { title: 'Ngày', dataIndex: 'date', width: 110, render: formatDate },
                { title: 'Số phiếu', dataIndex: 'code', width: 130 },
                { title: 'Loại', dataIndex: 'kind', width: 110, render: (k: keyof typeof SLIP) => <Tag color={SLIP[k].color}>{SLIP[k].label}</Tag> },
                { title: 'Vật tư', key: 'l', ellipsis: true, render: (_, r) => r.lines.map((l) => `${l.label} ${qty(l.qty)}`).join(', ') },
                { title: 'Người nhận / NCC', key: 'p', width: 180, render: (_, r) => r.receiver ?? r.partnerName ?? '' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Flex>
  );
}
