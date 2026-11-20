import { DownloadOutlined } from '@ant-design/icons';
import { Button, DatePicker, Flex, Select, Table, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { Link, useSearchParams } from 'react-router';
import type { Schemas } from '../../api/client';
import { useDieJournal, useWhPeople, type DieJournalQuery } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { formatDate } from '../../lib/format';
import { downloadCsv, PageHead, useDiePlaces } from './common';
import { pager } from '../../lib/paging';

type Row = Schemas['DieJournalRowDto'];

const ACTIONS: Array<{ value: Schemas['WhDieAction']; label: string }> = [
  { value: 'CREATE', label: 'Tạo khuôn' },
  { value: 'REQUEST', label: 'Lập phiếu giao nhận' },
  { value: 'SEND', label: 'Xác nhận xuất' },
  { value: 'RECEIVE', label: 'Xác nhận đã nhận' },
  { value: 'REJECT', label: 'Phiếu bị từ chối / huỷ' },
  { value: 'REUSE', label: 'Bế lệnh mới tại xưởng' },
  { value: 'KEEP', label: 'Bế xong, xưởng giữ' },
  { value: 'PASS', label: 'Kiểm đạt, lên kệ' },
  { value: 'MOVE', label: 'Đổi kệ / chuyển vị trí' },
  { value: 'DEFECT', label: 'Báo lỗi' },
  { value: 'DISPOSE', label: 'Thanh lý' },
  { value: 'EDIT', label: 'Sửa thông tin' },
];

/** Nhật ký khuôn: tra lại mọi thao tác trong một ngày hoặc khoảng ngày — nhập, xuất, chuyển đi đâu, ai làm */
export function WarehouseDieJournalPage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const today = dayjs().format('YYYY-MM-DD');
  const q: DieJournalQuery = {
    from: params.get('from') ?? today,
    to: params.get('to') ?? today,
    action: (params.get('action') as Schemas['WhDieAction']) ?? undefined,
    place: params.get('place') ?? undefined,
    userId: params.get('userId') ?? undefined,
  };
  const set = (patch: Record<string, string | null | undefined>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (!v) next.delete(k);
        else next.set(k, v);
      }
      return next;
    });
  const { data, isFetching } = useDieJournal(q);
  const places = useDiePlaces();
  const people = useWhPeople(can('warehouse.manage'));
  const counts = new Map<string, number>();
  for (const r of data ?? []) counts.set(r.actionLabel, (counts.get(r.actionLabel) ?? 0) + 1);
  const range: [Dayjs, Dayjs] = [dayjs(q.from), dayjs(q.to)];
  return (
    <Flex vertical gap={12}>
      <PageHead title="Nhật ký khuôn">
        <Typography.Text type="secondary">Tra lại mọi thao tác trong một ngày hoặc khoảng ngày: nhập, xuất, chuyển đi đâu, ai làm, ai xác nhận. Bấm mã khuôn để mở khuôn, bấm số phiếu để xem phiếu.</Typography.Text>
      </PageHead>
      <Flex wrap gap={8} align="center">
        <DatePicker.RangePicker
          id="journal-range"
          format="DD/MM/YYYY"
          allowClear={false}
          value={range}
          disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          onChange={(v) => v?.[0] && v[1] && set({ from: v[0].format('YYYY-MM-DD'), to: v[1].format('YYYY-MM-DD') })}
        />
        <Button size="small" onClick={() => set({ from: today, to: today })}>Hôm nay</Button>
        <Button size="small" onClick={() => set({ from: dayjs().subtract(1, 'day').format('YYYY-MM-DD'), to: dayjs().subtract(1, 'day').format('YYYY-MM-DD') })}>Hôm qua</Button>
        <Button size="small" onClick={() => set({ from: dayjs().startOf('month').format('YYYY-MM-DD'), to: today })}>Tháng này</Button>
        <Select id="journal-action" allowClear placeholder="Thao tác" style={{ width: 200 }} value={q.action} onChange={(v) => set({ action: v })} options={ACTIONS} />
        <Select
          id="journal-place"
          allowClear
          showSearch
          placeholder="Nơi (đi hoặc đến)"
          style={{ width: 210 }}
          value={q.place}
          onChange={(v) => set({ place: v })}
          options={places.options.map((g) => ({ label: g.label, options: g.options.map((o) => ({ value: o.label, label: o.label })) }))}
        />
        {can('warehouse.manage') && (
          <Select id="journal-user" allowClear showSearch optionFilterProp="label" placeholder="Người làm" style={{ width: 180 }} value={q.userId} onChange={(v) => set({ userId: v })} options={(people.data ?? []).map((u) => ({ value: u.id, label: u.fullName }))} />
        )}
        <Button
          icon={<DownloadOutlined />}
          onClick={() =>
            downloadCsv(
              `nhat-ky-khuon-${q.from}-${q.to}.csv`,
              ['Ngày', 'Giờ', 'Mã khuôn', 'Tên khuôn', 'Thao tác', 'Từ', 'Đến', 'Lệnh', 'Ghi chú', 'Người làm', 'Phiếu'],
              (data ?? []).map((r) => [r.date, dayjs(r.createdAt).format('HH:mm'), r.code, r.productName, r.actionLabel, r.fromPlace, r.place, r.reference, r.note, r.user, r.batchCode]),
            )
          }
        >
          Xuất CSV
        </Button>
      </Flex>
      {counts.size > 0 && (
        <Flex wrap gap={6}>
          {[...counts].map(([k, n]) => (
            <Tag key={k}>{k}: {n}</Tag>
          ))}
        </Flex>
      )}
      <Table<Row>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={pager(data?.length, { showTotal: (n) => `${n} thao tác` })}
        locale={{ emptyText: 'Không có thao tác nào trong khoảng ngày này' }}
        scroll={{ x: 1000 }}
        columns={[
          { title: 'Ngày giờ', key: 't', width: 130, render: (_, r) => `${formatDate(r.date)} ${dayjs(r.createdAt).format('HH:mm')}` },
          { title: 'Khuôn', key: 'd', render: (_, r) => <span><Link to={`/warehouse/dies?open=${r.dieId}`}><strong>{r.code}</strong></Link> {r.productName}</span> },
          { title: 'Thao tác', key: 'a', width: 190, render: (_, r) => <span>{r.actionLabel}{r.note && <div style={{ fontSize: 12, opacity: 0.75 }}>{r.note}</div>}</span> },
          { title: 'Từ → Đến', key: 'p', width: 280, render: (_, r) => [r.fromPlace, r.place].filter(Boolean).join(' → ') },
          { title: 'Lệnh', dataIndex: 'reference', width: 130 },
          { title: 'Người làm', dataIndex: 'user', width: 130 },
          { title: 'Phiếu', key: 'b', width: 130, render: (_, r) => r.batchId && <Link to={`/warehouse/batches?open=${r.batchId}`}>{r.batchCode}</Link> },
        ]}
      />
    </Flex>
  );
}
