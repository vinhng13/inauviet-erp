import { Table, Typography } from 'antd';
import { formatQty } from '../lib/format';

export interface QtyRow {
  key: string;
  description: string;
  ordered: number;
  planned: number;
}

/** Under the delivery plan: ordered / planned / not yet planned per line. Orange = unplanned, red = over. */
export function QuantityCheck({ rows }: { rows: QtyRow[] }) {
  return (
    <Table<QtyRow>
      size="small"
      pagination={false}
      rowKey="key"
      dataSource={rows}
      columns={[
        { title: 'Mặt hàng', dataIndex: 'description' },
        { title: 'Đặt', dataIndex: 'ordered', align: 'right', render: formatQty, width: 90 },
        { title: 'Đã lên chuyến', dataIndex: 'planned', align: 'right', render: formatQty, width: 120 },
        {
          title: 'Chưa lên chuyến',
          align: 'right',
          width: 130,
          render: (_, r) => {
            const left = r.ordered - r.planned;
            if (left < 0) return <Typography.Text type="danger">Vượt {formatQty(-left)}</Typography.Text>;
            if (left > 0) return <Typography.Text type="warning">{formatQty(left)}</Typography.Text>;
            return <Typography.Text type="success">0</Typography.Text>;
          },
        },
      ]}
    />
  );
}
