import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Card, Col, Descriptions, Flex, Result, Row, Skeleton, Statistic, Typography } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useCustomer } from '../api/hooks';
import { CustomerDocuments } from '../components/CustomerDocuments';
import { CustomerFormModal } from '../components/CustomerSelect';
import { useCan } from '../lib/access';

export function CustomerDetailPage() {
  const { id = '' } = useParams();
  const { data: c, isLoading } = useCustomer(id);
  const can = useCan();
  const showMoney = can('money.view');
  const [editing, setEditing] = useState(false);

  if (isLoading) return <Skeleton active />;
  if (!c) return <Result status="404" title="Không tìm thấy khách hàng" extra={<Link to="/customers">Về danh sách</Link>} />;

  return (
    <Flex vertical gap={16} style={{ maxWidth: 1100 }}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          {c.name} <Typography.Text type="secondary" style={{ fontSize: 16 }}>{c.code}</Typography.Text>
        </Typography.Title>
        <Flex gap={8}>
          {can('customers.update') && (
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
              Sửa
            </Button>
          )}
          {can('orders.create') && (
            <Link to="/orders/new">
              <Button icon={<PlusOutlined />}>Đơn mới</Button>
            </Link>
          )}
          {can('quotes.create') && (
            <Link to={`/quotes/new?customerId=${c.id}`}>
              <Button type="primary" icon={<PlusOutlined />}>
                Lập báo giá
              </Button>
            </Link>
          )}
        </Flex>
      </Flex>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card size="small" style={{ height: '100%' }}>
            <Descriptions
              size="small"
              column={{ xs: 1, sm: 2 }}
              items={[
                { label: 'Điện thoại', children: <Typography.Text copyable>{c.phone}</Typography.Text> },
                { label: 'Công ty', children: c.companyName ?? '—' },
                { label: 'Mã số thuế', children: c.taxCode ?? '—' },
                { label: 'Địa chỉ', children: c.address ?? '—' },
                { label: 'Ghi chú', children: c.note ?? '—', span: 'filled' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" style={{ height: '100%' }}>
            <Row gutter={12}>
              <Col span={8}>
                <Statistic title="Đơn đang mở" value={c.openOrderCount} />
              </Col>
              <Col span={8}>
                <Statistic title="Tổng đơn" value={c.orderCount} />
              </Col>
              {showMoney && (
                <Col span={8}>
                  <Statistic title="Còn nợ" value={c.balanceVnd} groupSeparator="." suffix="đ" styles={{ content: { fontSize: 18 } }} />
                </Col>
              )}
            </Row>
          </Card>
        </Col>
      </Row>
      {can('orders.view') && <CustomerDocuments customerId={c.id} />}
      <CustomerFormModal open={editing} customer={c} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />
    </Flex>
  );
}
