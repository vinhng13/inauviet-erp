import { CameraOutlined, DownloadOutlined } from '@ant-design/icons';
import { Alert, App, Button, DatePicker, Flex, Input, Segmented, Table, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import type { Schemas } from '../../api/client';
import { useSlips, useStockAsOf, useStockReport, useWarehouseMutations } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { downloadCsv, lineQty, PageHead, qty, SLIP, SlipStatusTag, useWarehousePick, WarehousePicker, type SlipKind } from './common';
import { pager } from '../../lib/paging';

type Mode = 'nxt' | 'asof' | 'journal';

/** Báo cáo kho: nhập – xuất – tồn theo khoảng ngày, tồn cuối một ngày (bản chụp), sổ phiếu theo ngày */
export function WarehouseReportPage() {
  const { warehouse, list, pick } = useWarehousePick();
  const [mode, setMode] = useState<Mode>('nxt');
  return (
    <Flex vertical gap={16}>
      <PageHead title="Báo cáo kho">
        <WarehousePicker value={warehouse} list={list} onChange={pick} />
        <Segmented
          value={mode}
          onChange={(v) => setMode(v as Mode)}
          options={[
            { value: 'nxt', label: 'Nhập – xuất – tồn' },
            { value: 'asof', label: 'Tồn theo ngày' },
            { value: 'journal', label: 'Sổ phiếu theo ngày' },
          ]}
        />
      </PageHead>
      {warehouse && mode === 'nxt' && <InOutBalance warehouse={warehouse} />}
      {warehouse && mode === 'asof' && <AsOf warehouse={warehouse} />}
      {warehouse && mode === 'journal' && <Journal warehouse={warehouse} />}
    </Flex>
  );
}

function useFilter() {
  const [q, setQ] = useState('');
  const t = q.trim().toLowerCase();
  return { setQ, match: (r: { label: string; group: string }) => !t || `${r.group} ${r.label}`.toLowerCase().includes(t) };
}

function InOutBalance({ warehouse }: { warehouse: Schemas['WarehouseDto'] }) {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().startOf('month'), dayjs()]);
  const [moved, setMoved] = useState(false);
  const f = useFilter();
  const q = { warehouseId: warehouse.id, from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') };
  const { data, isFetching } = useStockReport(q);
  const rows = (data?.rows ?? []).filter((r) => f.match(r) && (!moved || r.inQty || r.outQty));
  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={12} align="center">
        <DatePicker.RangePicker format="DD/MM/YYYY" value={range} allowClear={false} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />
        <Input.Search id="report-search" placeholder="Nhóm, vật tư, khổ" allowClear onChange={(e) => f.setQ(e.target.value)} style={{ width: 240 }} />
        <Segmented value={moved ? 'moved' : 'all'} onChange={(v) => setMoved(v === 'moved')} options={[{ value: 'all', label: 'Tất cả' }, { value: 'moved', label: 'Có phát sinh' }]} />
        <Button
          icon={<DownloadOutlined />}
          onClick={() =>
            downloadCsv(`nxt-${warehouse.code}-${q.from}-${q.to}.csv`, ['Nhóm', 'Vật tư / quy cách', 'ĐVT', 'Tồn đầu', 'Nhập', 'Xuất', 'Tồn cuối'], rows.map((r) => [r.group, r.label, r.unit, r.opening, r.inQty, r.outQty, r.closing]))
          }
        >
          Xuất CSV
        </Button>
      </Flex>
      <Typography.Text type="secondary">Tính từ các phiếu đã ghi, theo ngày ghi trên phiếu. Phiếu đã huỷ không tính.</Typography.Text>
      <Table<Schemas['StockReportRowDto']>
        rowKey="stockId"
        size="small"
        loading={isFetching}
        dataSource={rows}
        pagination={pager(rows?.length)}
        locale={{ emptyText: 'Không có số liệu' }}
        columns={[
          { title: 'Nhóm', dataIndex: 'group', width: 110 },
          { title: 'Vật tư / quy cách', dataIndex: 'label' },
          { title: 'ĐVT', dataIndex: 'unit', width: 70 },
          { title: 'Tồn đầu', dataIndex: 'opening', width: 110, align: 'right', render: qty },
          { title: 'Nhập', dataIndex: 'inQty', width: 110, align: 'right', render: (v: number) => (v ? <Typography.Text type="success">{qty(v)}</Typography.Text> : '') },
          { title: 'Xuất', dataIndex: 'outQty', width: 110, align: 'right', render: (v: number) => (v ? <Typography.Text type="danger">{qty(v)}</Typography.Text> : '') },
          { title: 'Tồn cuối', dataIndex: 'closing', width: 110, align: 'right', render: (v: number) => <strong>{qty(v)}</strong> },
        ]}
      />
    </Flex>
  );
}

function AsOf({ warehouse }: { warehouse: Schemas['WarehouseDto'] }) {
  const can = useCan();
  const { message } = App.useApp();
  const [date, setDate] = useState<Dayjs>(dayjs().subtract(1, 'day'));
  const f = useFilter();
  const { data, isFetching } = useStockAsOf({ warehouseId: warehouse.id, date: date.format('YYYY-MM-DD') });
  const { runSnapshots } = useWarehouseMutations();
  const rows = (data?.rows ?? []).filter(f.match);
  const differs = rows.some((r) => r.qty !== r.liveQty);
  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={12} align="center">
        <DatePicker id="asof-date" format="DD/MM/YYYY" value={date} allowClear={false} onChange={(v) => v && setDate(v)} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
        <Input.Search id="asof-search" placeholder="Nhóm, vật tư, khổ" allowClear onChange={(e) => f.setQ(e.target.value)} style={{ width: 240 }} />
        <Button
          icon={<DownloadOutlined />}
          onClick={() => downloadCsv(`ton-${warehouse.code}-${date.format('YYYY-MM-DD')}.csv`, ['Nhóm', 'Vật tư / quy cách', 'ĐVT', 'Tồn cuối ngày', 'Tính lại từ phiếu'], rows.map((r) => [r.group, r.label, r.unit, r.qty, r.liveQty]))}
        >
          Xuất CSV
        </Button>
        {can('warehouse.manage') && (
          <Button
            icon={<CameraOutlined />}
            loading={runSnapshots.isPending}
            onClick={() => runSnapshots.mutate(undefined, { onSuccess: (r) => message.success(r.days ? `Đã chụp tồn ${r.days} ngày` : 'Các ngày đã qua đều đã có bản chụp'), onError: (e) => message.error(errorMessage(e)) })}
          >
            Chụp các ngày còn thiếu
          </Button>
        )}
      </Flex>
      {data && (
        <Alert
          type={data.source === 'SNAPSHOT' ? 'success' : 'info'}
          showIcon
          title={
            data.source === 'SNAPSHOT'
              ? `Bản chụp tồn cuối ngày ${formatDate(data.date)}, lưu lúc ${formatDateTime(String(data.takenAt))}.`
              : `Ngày ${formatDate(data.date)} chưa có bản chụp (bản chụp được lưu tự động sau khi hết ngày). Số dưới đây tính từ phiếu hiện có.`
          }
          description={differs ? 'Có phiếu được lập bổ sung về ngày này sau khi chụp: cột "Tính lại từ phiếu" khác bản chụp.' : undefined}
        />
      )}
      <Table<Schemas['StockAsOfRowDto']>
        rowKey="stockId"
        size="small"
        loading={isFetching}
        dataSource={rows}
        pagination={pager(rows?.length)}
        columns={[
          { title: 'Nhóm', dataIndex: 'group', width: 110 },
          { title: 'Vật tư / quy cách', dataIndex: 'label' },
          { title: 'ĐVT', dataIndex: 'unit', width: 70 },
          { title: data?.source === 'SNAPSHOT' ? 'Tồn cuối ngày (bản chụp)' : 'Tồn cuối ngày', dataIndex: 'qty', width: 190, align: 'right', render: (v: number) => <strong>{qty(v)}</strong> },
          {
            title: 'Tính lại từ phiếu',
            dataIndex: 'liveQty',
            width: 150,
            align: 'right',
            render: (v: number, r) => (v !== r.qty ? <Tag color="orange">{qty(v)}</Tag> : <Typography.Text type="secondary">{qty(v)}</Typography.Text>),
          },
        ]}
      />
    </Flex>
  );
}

function Journal({ warehouse }: { warehouse: Schemas['WarehouseDto'] }) {
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs(), dayjs()]);
  const { data, isFetching } = useSlips({ warehouseId: warehouse.id, from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') });
  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={12} align="center">
        <DatePicker.RangePicker format="DD/MM/YYYY" value={range} allowClear={false} onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])} />
        <Button
          icon={<DownloadOutlined />}
          onClick={() =>
            downloadCsv(
              `so-phieu-${warehouse.code}-${range[0].format('YYYY-MM-DD')}-${range[1].format('YYYY-MM-DD')}.csv`,
              ['Ngày', 'Số phiếu', 'Loại', 'Trạng thái', 'Vật tư', 'Nơi lấy hàng / người nhận', 'Lệnh', 'Người lập'],
              (data ?? []).flatMap((s) => s.lines.map((l) => [s.date, s.code, SLIP[s.kind].label, s.voidedAt ? 'Đã huỷ' : s.status, `${l.label}: ${lineQty(l)}`, [s.supplierName, s.receiver].filter(Boolean).join(' · '), s.reference, s.createdBy])),
            )
          }
        >
          Xuất CSV
        </Button>
      </Flex>
      <Table<Schemas['SlipDto']>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={pager(data?.length)}
        locale={{ emptyText: 'Không có phiếu trong khoảng ngày này' }}
        rowClassName={(r) => (r.voidedAt || r.status === 'CANCELLED' || r.status === 'REJECTED' ? 'row-voided' : '')}
        columns={[
          { title: 'Ngày', dataIndex: 'date', width: 100, render: formatDate },
          { title: 'Số phiếu', dataIndex: 'code', width: 160 },
          { title: 'Loại', dataIndex: 'kind', width: 110, render: (k: SlipKind) => <Tag color={SLIP[k].color}>{SLIP[k].label}</Tag> },
          { title: 'Trạng thái', key: 'st', width: 140, render: (_, r) => <SlipStatusTag slip={r} /> },
          { title: 'Vật tư', key: 'l', render: (_, r) => r.lines.map((l) => `${l.label}: ${lineQty(l)}`).join('; ') },
          { title: 'Người lập', dataIndex: 'createdBy', width: 120 },
          { title: 'Nơi lấy hàng / người nhận', key: 'who', width: 180, render: (_, r) => [r.supplierName, r.receiver].filter(Boolean).join(' · ') },
        ]}
      />
    </Flex>
  );
}
