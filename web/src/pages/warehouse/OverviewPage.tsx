import { Alert, Card, Col, Empty, Flex, List, Row, Spin, Table, Tag, Typography } from 'antd';
import { ClipboardCheck, Factory, Hammer, Layers } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { StatCard } from '../../components/StatCard';
import { useWhOverview, type DieRow } from '../../api/warehouse';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { DieStatusTag, PageHead, qty, SLIP, STATUS, type DieStatus } from './common';
import { pager } from '../../lib/paging';

/** Tổng quan kho: kho Âu Việt và kho ngoài đang giữ hàng, vật tư dưới mức tối thiểu, khuôn đang ở đâu, đang làm, chờ kiểm */
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
      {(['AU_VIET', 'EXTERNAL'] as const).map((o) => {
        // Kho Âu Việt luôn hiện; kho ngoài chỉ hiện khi đang có hàng
        const list = data.warehouses.filter((w) => w.isActive && w.ownership === o && (o === 'AU_VIET' || w.materials > 0 || w.dies > 0));
        if (!list.length) return null;
        return (
          <Flex key={o} vertical gap={8}>
            <Typography.Text strong>{o === 'AU_VIET' ? 'Kho Âu Việt' : 'Kho ngoài đang giữ hàng'}</Typography.Text>
            <Row gutter={[12, 12]}>
              {list.map((w) => (
                <Col key={w.id} xs={12} md={6}>
                  <Card size="small" hoverable onClick={() => navigate(w.dies > 0 && w.materials === 0 ? `/warehouse/dies?place=k:${w.id}` : `/warehouse/stock?kho=${w.code}`)}>
                    <Typography.Text strong>{w.name}</Typography.Text>
                    {w.address && <div style={{ fontSize: 12, opacity: 0.75 }}>{w.address}</div>}
                    <Flex gap={6} wrap style={{ marginTop: 6 }}>
                      {w.materials > 0 && <Tag>{w.materials} vật tư</Tag>}
                      {w.dies > 0 && <Tag>{w.dies} khuôn</Tag>}
                      {w.low > 0 && <Tag color="red">{w.low} dưới tối thiểu</Tag>}
                      {w.materials === 0 && w.dies === 0 && <Tag>Chưa có hàng</Tag>}
                    </Flex>
                  </Card>
                </Col>
              ))}
            </Row>
          </Flex>
        );
      })}
      {(data.dieToConfirm.length > 0 || data.dieInTransit.length > 0) && (
        <Row gutter={[16, 16]}>
          {data.dieToConfirm.length > 0 && (
            <Col xs={24} lg={12}>
              <Card size="small" title={`Phiếu khuôn cũ còn chờ xác nhận (${data.dieToConfirm.length})`}>
                <List
                  size="small"
                  dataSource={data.dieToConfirm}
                  renderItem={(b) => (
                    <List.Item
                      extra={
                        <Link style={{ marginInlineStart: 12 }} to={`/warehouse/dies?view=moves&open=${b.id}`}>
                          Mở
                        </Link>
                      }
                    >
                      <Tag color="volcano">Khuôn</Tag> {b.code} · {b.fromName} → {b.toName} · {b.dies.map((d) => d.code).join(', ')}
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          )}
          {data.dieInTransit.length > 0 && (
            <Col xs={24} lg={12}>
              <Card size="small" title={`Khuôn đang chuyển (phiếu cũ) (${data.dieInTransit.length})`}>
                <List
                  size="small"
                  dataSource={data.dieInTransit}
                  renderItem={(b) => (
                    <List.Item
                      extra={
                        <Link style={{ marginInlineStart: 12 }} to={`/warehouse/dies?view=moves&open=${b.id}`}>
                          Mở
                        </Link>
                      }
                    >
                      Khuôn · {b.fromName} → {b.toName} · {b.dies.map((d) => d.code).join(', ')}
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
          )}
        </Row>
      )}
      <Flex wrap gap={6} align="center">
        <Typography.Text strong>Khuôn theo nơi:</Typography.Text>
        {data.diePlaces.filter((p) => p.ownership === 'AU_VIET' || p.dies > 0).map((p) => (
          <Link key={p.key} to={`/warehouse/dies?place=${p.key}`}>
            <Tag color={p.ownership === 'AU_VIET' ? 'green' : 'orange'}>
              {p.name}: {p.dies}
            </Tag>
          </Link>
        ))}
      </Flex>
      <Row gutter={[16, 16]}>
        <Col xs={12} md={6}>
          <StatCard tone="indigo" title="Khuôn đang quản lý" value={data.diesTotal} icon={<Layers size={18} />} onClick={() => navigate('/warehouse/dies')} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard tone="cyan" title="Đang bế" value={data.diesByStatus.IN_USE ?? 0} icon={<Factory size={18} />} onClick={() => navigate('/warehouse/dies?status=IN_USE')} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            tone="orange"
            title="Đang làm khuôn / đang sửa"
            value={(data.diesByStatus.MAKING ?? 0) + (data.diesByStatus.REPAIRING ?? 0)}
            icon={<Hammer size={18} />}
            onClick={() => navigate('/warehouse/dies?status=MAKING')}
          />
        </Col>
        <Col xs={12} md={6}>
          <StatCard
            tone="emerald"
            title="Không đạt"
            value={data.diesByStatus.DEFECT ?? 0}
            icon={<ClipboardCheck size={18} />}
            onClick={() => navigate('/warehouse/dies?status=DEFECT')}
          />
        </Col>
      </Row>
      <Flex wrap gap={6}>
        {(Object.keys(STATUS) as DieStatus[])
          .filter((s) => data.diesByStatus[s])
          .map((s) => (
            <Link key={s} to={`/warehouse/dies?status=${s}`}>
              <Tag color={STATUS[s].color}>
                {STATUS[s].label}: {data.diesByStatus[s]}
              </Tag>
            </Link>
          ))}
      </Flex>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Khuôn đang ở kho ngoài (xưởng bế, nơi làm khuôn...)">
            <Table
              rowKey="warehouseId"
              size="small"
              pagination={false}
              dataSource={data.outside}
              locale={{ emptyText: 'Không có khuôn nào ở kho ngoài' }}
              columns={[
                { title: 'Kho', dataIndex: 'name', render: (v: string, r) => <Link to={`/warehouse/dies?place=k:${r.warehouseId}`}>{v}</Link> },
                { title: 'Số khuôn', key: 'n', align: 'right', width: 100, render: (_, r) => r.inUse + r.kept },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="Khuôn chờ kiểm">
            <Table<DieRow>
              rowKey="id"
              size="small"
              pagination={pager(data.checking?.length)}
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
                  <List.Item
                    extra={
                      <Typography.Text type="danger" style={{ marginInlineStart: 12, whiteSpace: 'nowrap' }}>
                        {qty(i.qty)} / {qty(i.minQty ?? 0)} {i.unit}
                      </Typography.Text>
                    }
                  >
                    {i.warehouseCode} · {i.label}
                  </List.Item>
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
                { title: 'Kho', dataIndex: 'warehouseCode', width: 90 },
                { title: 'Vật tư', key: 'l', ellipsis: true, render: (_, r) => r.lines.map((l) => `${l.label} ${qty(l.qty)}`).join(', ') },
                { title: 'Người nhận / nơi lấy hàng', key: 'p', width: 180, render: (_, r) => r.receiver ?? r.supplierName ?? '' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Flex>
  );
}
