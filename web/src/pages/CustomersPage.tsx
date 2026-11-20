import { PlusOutlined } from '@ant-design/icons';
import { Button, Flex, Input, Table, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Schemas } from '../api/client';
import { useCustomers } from '../api/hooks';
import { CustomerFormModal } from '../components/CustomerSelect';
import { useCan } from '../lib/access';
import { DEFAULT_PAGE_SIZE, serverPager } from '../lib/paging';

export function CustomersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [creating, setCreating] = useState(false);
  const { data, isFetching } = useCustomers({ q: q || undefined, page, pageSize: size });
  const can = useCan();

  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Khách hàng
        </Typography.Title>
        {can('customers.create') && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            Thêm khách hàng
          </Button>
        )}
      </Flex>
      <Input.Search id="customers-search" placeholder="Tên, công ty, số điện thoại, mã KH (không cần dấu)" allowClear onSearch={(v) => { setQ(v.trim()); setPage(1); }} style={{ maxWidth: 420 }} />
      <Table<Schemas['CustomerDto']>
        rowKey="id"
        loading={isFetching}
        dataSource={data?.items}
        scroll={{ x: 760 }}
        onRow={(c) => ({ onClick: () => navigate(`/customers/${c.id}`), style: { cursor: 'pointer' } })}
        pagination={serverPager(page, size, data?.total, (p, s) => (setPage(p), setSize(s)))}
        columns={[
          { title: 'Mã', dataIndex: 'code', width: 100 },
          { title: 'Tên', dataIndex: 'name' },
          { title: 'Công ty', dataIndex: 'companyName' },
          { title: 'Điện thoại', dataIndex: 'phone', width: 140 },
          { title: 'Địa chỉ', dataIndex: 'address', ellipsis: true },
        ]}
      />
      <CustomerFormModal open={creating} onClose={() => setCreating(false)} onSaved={(c) => navigate(`/customers/${c.id}`)} />
    </Flex>
  );
}
