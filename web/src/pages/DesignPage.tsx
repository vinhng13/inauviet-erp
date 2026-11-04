import { Flex, Segmented, Space, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Schemas } from '../api/client';
import { useDesignQueue } from '../api/hooks';
import { DocsDownload } from '../components/PrintMenu';
import { formatDate, formatDateTime } from '../lib/format';

type Item = Schemas['DesignQueueItemDto'];
type State = Item['state'];

const STATES: Array<{ key: 'all' | State; label: string; color?: string }> = [
  { key: 'all', label: 'Tất cả' },
  { key: 'TODO', label: 'Chưa gửi', color: 'default' },
  { key: 'WAITING', label: 'Chờ khách', color: 'blue' },
  { key: 'CHANGES', label: 'Cần sửa', color: 'orange' },
  { key: 'FINAL', label: 'Hoàn thiện', color: 'green' },
];
const STATE_LABEL: Record<State, string> = { TODO: 'Chưa gửi maket', WAITING: 'Chờ khách phản hồi', CHANGES: 'Khách yêu cầu sửa', FINAL: 'Đã duyệt · hoàn thiện' };

/** "Việc thiết kế": every order in steps 3–4, by what the designer has to do next. */
export function DesignPage() {
  const navigate = useNavigate();
  const [mine, setMine] = useState(false);
  const [tab, setTab] = useState<'all' | State>('all');
  const { data, isFetching } = useDesignQueue({ mine: mine || undefined });
  const items = data ?? [];
  const rows = items.filter((i) => tab === 'all' || i.state === tab);

  return (
    <Flex vertical gap={16}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Việc thiết kế
      </Typography.Title>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Segmented
          value={tab}
          onChange={(v) => setTab(v as 'all' | State)}
          options={STATES.map((s) => ({ value: s.key, label: `${s.label} (${items.filter((i) => s.key === 'all' || i.state === s.key).length})` }))}
        />
        <Space>
          <Switch id="design-mine" size="small" checked={mine} onChange={setMine} />
          <label htmlFor="design-mine">Chỉ việc của tôi</label>
        </Space>
      </Flex>
      <Table<Item>
        rowKey="id"
        loading={isFetching}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 900 }}
        locale={{ emptyText: 'Không có đơn nào ở khâu thiết kế' }}
        onRow={(o) => ({ onClick: () => navigate(`/orders/${o.id}`), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Đơn', dataIndex: 'code', width: 150, render: (v: string) => <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>{v}</Typography.Text> },
          { title: 'Khách hàng', dataIndex: 'customerName', width: 180 },
          { title: 'Hàng', dataIndex: 'summary', ellipsis: true },
          { title: 'Thiết kế', key: 'designer', width: 150, render: (_, o) => o.designer?.fullName ?? <Typography.Text type="warning">Chưa giao</Typography.Text> },
          {
            title: 'Maket',
            key: 'v',
            width: 150,
            render: (_, o) => (o.lastVersion ? <>v{o.lastVersion}<div style={{ fontSize: 12, opacity: 0.65 }}>{formatDateTime(o.lastSentAt)}</div></> : '—'),
          },
          {
            title: 'Trạng thái',
            key: 'state',
            width: 190,
            render: (_, o) => <Tag color={STATES.find((s) => s.key === o.state)?.color}>{o.state === 'FINAL' && !o.finalized ? `Đã duyệt v${o.approvedVersion} · đang hoàn thiện` : STATE_LABEL[o.state]}</Tag>,
          },
          { title: 'Hạn giao', dataIndex: 'dueDate', width: 120, render: (v: string | null, o) => <Typography.Text type={o.isOverdue ? 'danger' : undefined}>{formatDate(v)}</Typography.Text> },
          {
            title: '',
            key: 'print',
            width: 56,
            render: (_, o) => (o.lastVersion ? <DocsDownload docs={[{ kind: 'design', sourceId: o.id, label: 'Duyệt thiết kế' }]} code={o.code} /> : null),
          },
        ]}
      />
    </Flex>
  );
}
