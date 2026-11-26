import { DownloadOutlined, EditOutlined, ExportOutlined, ImportOutlined, MinusCircleOutlined, PlusOutlined, RollbackOutlined, SwapOutlined } from '@ant-design/icons';
import { Alert, App, AutoComplete, Button, DatePicker, Descriptions, Drawer, Flex, Form, Input, InputNumber, Modal, Segmented, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Schemas } from '../../api/client';
import { useSuppliers, useSlip, useSlips, useStockCard, useStockItems, useWarehouseMutations, useWarehouses, useWhMaterials, type StockItem } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { downloadCsv, lineQty, OWNERSHIP, PageHead, qty, SLIP, SlipStatusTag, useWarehousePick, WarehousePicker, type SlipKind } from './common';
import { pager } from '../../lib/paging';
import { CreatableSelect, isNew, newName } from '../../components/CreatableSelect';

type Warehouse = Schemas['WarehouseDto'];
type Slip = Schemas['SlipDto'];
type NewKind = 'RECEIPT' | 'ISSUE' | 'RETURN';
const NEW_TITLE: Record<NewKind, string> = { RECEIPT: 'Phiếu nhập kho', ISSUE: 'Phiếu xuất kho', RETURN: 'Phiếu nhập lại (hàng thừa trả về kho)' };

/** Tồn kho theo kho đang chọn, thẻ kho, phiếu, chuyển kho. Phiếu lưu là có hiệu lực ngay */
export function WarehouseStockPage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const { warehouse, list, pick } = useWarehousePick();
  const tab = params.get('tab') ?? 'stock';
  const [creating, setCreating] = useState<NewKind | 'TRANSFER' | null>(null);
  const [openSlip, setOpenSlip] = useState<string | null>(null);
  const setTab = (k: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (k === 'stock') next.delete('tab');
      else next.set('tab', k);
      return next;
    });
  return (
    <Flex vertical gap={16}>
      <PageHead
        title="Kho vật tư"
        extra={
          can('warehouse.slip') && warehouse && (
            <Space wrap>
              <Button icon={<ImportOutlined />} onClick={() => setCreating('RECEIPT')}>Nhập kho</Button>
              <Button icon={<RollbackOutlined />} onClick={() => setCreating('RETURN')}>Nhập lại</Button>
              <Button icon={<SwapOutlined />} onClick={() => setCreating('TRANSFER')}>Chuyển kho</Button>
              <Button type="primary" icon={<ExportOutlined />} onClick={() => setCreating('ISSUE')}>Xuất kho</Button>
            </Space>
          )
        }
      >
        <Flex wrap gap={8} align="center">
          <WarehousePicker value={warehouse} list={list} onChange={pick} />
          <OtherKho onPick={pick} />
        </Flex>
      </PageHead>
      {warehouse && (
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: 'stock', label: 'Tồn kho', children: <StockTable warehouse={warehouse} /> },
            { key: 'slips', label: 'Tra cứu lịch sử', children: <SlipList warehouse={warehouse} onOpen={setOpenSlip} /> },
          ]}
        />
      )}
      {warehouse && creating && creating !== 'TRANSFER' && <SlipModal kind={creating} warehouse={warehouse} onClose={() => setCreating(null)} onCreated={setOpenSlip} />}
      {warehouse && creating === 'TRANSFER' && <TransferModal warehouse={warehouse} onClose={() => setCreating(null)} onCreated={setOpenSlip} />}
      {openSlip && <SlipDrawer id={openSlip} onClose={() => setOpenSlip(null)} onOpen={setOpenSlip} />}
    </Flex>
  );
}

function StockTable({ warehouse }: { warehouse: Warehouse }) {
  const can = useCan();
  const { data, isFetching } = useStockItems(warehouse.id);
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string>('all');
  const [low, setLow] = useState(false);
  const [card, setCard] = useState<StockItem | null>(null);
  const [editMin, setEditMin] = useState<StockItem | null>(null);
  const groups = useMemo(() => [...new Set((data ?? []).map((i) => i.group))], [data]);
  const text = q.trim().toLowerCase();
  const rows = (data ?? []).filter(
    (i) => (group === 'all' || i.group === group) && (!low || i.low) && (!text || i.label.toLowerCase().includes(text) || (i.materialCode ?? '').toLowerCase().includes(text)),
  );
  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={12} align="center">
        <Input.Search id="stock-search" placeholder="Mã, tên vật tư hoặc khổ, ví dụ 27 x 23" allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 300 }} />
        <Select value={group} onChange={setGroup} style={{ width: 160 }} options={[{ value: 'all', label: 'Mọi nhóm' }, ...groups.map((g) => ({ value: g, label: g }))]} />
        <Segmented value={low ? 'low' : 'any'} onChange={(v) => setLow(v === 'low')} options={[{ value: 'any', label: 'Mọi mức tồn' }, { value: 'low', label: 'Dưới tối thiểu' }]} />
        <Button
          icon={<DownloadOutlined />}
          onClick={() =>
            downloadCsv(`ton-${warehouse.code}-${dayjs().format('YYYY-MM-DD')}.csv`, ['Kho', 'Mã', 'Nhóm', 'Vật tư / quy cách', 'ĐVT', 'Tồn', 'Tối thiểu'], rows.map((i) => [warehouse.code, i.materialCode, i.group, i.label, i.unit, i.qty, i.minQty]))
          }
        >
          Xuất CSV
        </Button>
      </Flex>
      <Table<StockItem>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={rows}
        pagination={pager(rows?.length)}
        locale={{ emptyText: 'Kho này chưa có vật tư. Bấm Nhập kho và chọn vật tư trong danh mục.' }}
        onRow={(r) => ({ onClick: () => setCard(r), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Nhóm', dataIndex: 'group', width: 110 },
          { title: 'Vật tư / quy cách', dataIndex: 'label', render: (v: string, r) => <span>{r.materialCode && <Typography.Text type="secondary">{r.materialCode} · </Typography.Text>}{v}</span> },
          { title: 'ĐVT', dataIndex: 'unit', width: 70 },
          {
            title: 'Tồn',
            key: 'qty',
            width: 160,
            align: 'right',
            sorter: (a, b) => a.qty - b.qty,
            render: (_, r) => {
              const big = r.units.filter((u) => u.id && u.factor > 1).sort((a, b) => b.factor - a.factor)[0];
              return (
                <span>
                  <strong style={{ color: r.low ? '#cf1322' : undefined }}>{qty(r.qty)}</strong>
                  {big && r.qty >= big.factor && <Typography.Text type="secondary" style={{ fontSize: 12 }}> ≈ {qty(Math.floor((r.qty / big.factor) * 10) / 10)} {big.name}</Typography.Text>}
                </span>
              );
            },
          },
          {
            title: 'Tối thiểu',
            dataIndex: 'minQty',
            width: 110,
            align: 'right',
            render: (v: number | null, r) => (
              <span onClick={(e) => e.stopPropagation()}>
                {v === null ? '' : qty(v)}
                {can('warehouse.manage') && <Button size="small" type="text" icon={<EditOutlined />} aria-label={`Mức tối thiểu ${r.label}`} onClick={() => setEditMin(r)} />}
              </span>
            ),
          },
          { key: 'flag', width: 120, render: (_, r) => (r.low ? <Tag color="red">Dưới tối thiểu</Tag> : null) },
        ]}
      />
      {card && <StockCard item={card} onClose={() => setCard(null)} />}
      {editMin && <MinQtyModal item={editMin} onClose={() => setEditMin(null)} />}
    </Flex>
  );
}

function MinQtyModal({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const { message } = App.useApp();
  const { updateStock } = useWarehouseMutations();
  const [v, setV] = useState<number | null>(item.minQty);
  return (
    <Modal
      open
      title={`Mức tối thiểu · ${item.label}`}
      okText="Lưu"
      cancelText="Đóng"
      onCancel={onClose}
      confirmLoading={updateStock.isPending}
      onOk={() => updateStock.mutate({ id: item.id, minQty: v }, { onSuccess: () => (message.success('Đã lưu'), onClose()), onError: (e) => message.error(errorMessage(e)) })}
    >
      <Typography.Paragraph type="secondary">Tồn tại kho {item.warehouseCode} dưới mức này sẽ được nhắc. Bỏ trống để không nhắc.</Typography.Paragraph>
      <InputNumber id="min-qty" min={0} value={v} onChange={setV} suffix={item.unit} style={{ width: 200 }} />
    </Modal>
  );
}

function StockCard({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const { data, isFetching } = useStockCard(item.id);
  return (
    <Drawer open size={760} onClose={onClose} title={`Thẻ kho ${item.warehouseCode} · ${item.label}`}>
      <Typography.Paragraph>
        Tồn hiện tại: <strong>{qty(data?.item.qty ?? item.qty)} {item.unit}</strong>
      </Typography.Paragraph>
      <Table
        rowKey="slipId"
        size="small"
        loading={isFetching}
        dataSource={data?.rows}
        pagination={pager(data?.rows?.length)}
        locale={{ emptyText: 'Chưa có phiếu nào' }}
        columns={[
          { title: 'Ngày', dataIndex: 'date', width: 100, render: formatDate },
          { title: 'Số phiếu', dataIndex: 'code', width: 170, render: (v: string, r) => <span>{v} <Tag color={SLIP[r.kind].color}>{SLIP[r.kind].label}</Tag></span> },
          { title: 'Diễn giải', key: 'd', render: (_, r) => [r.partyText, r.reference].filter(Boolean).join(' · ') },
          { title: 'Nhập', dataIndex: 'inQty', width: 80, align: 'right', render: (v: number) => (v ? qty(v) : '') },
          { title: 'Xuất', dataIndex: 'outQty', width: 80, align: 'right', render: (v: number) => (v ? qty(v) : '') },
          { title: 'Tồn', dataIndex: 'balance', width: 90, align: 'right', render: (v: number) => <strong>{qty(v)}</strong> },
        ]}
      />
    </Drawer>
  );
}

function SlipList({ warehouse, onOpen }: { warehouse: Warehouse; onOpen: (id: string) => void }) {
  const [kind, setKind] = useState<SlipKind | 'all'>('all');
  const [month, setMonth] = useState<Dayjs | null>(dayjs());
  const [q, setQ] = useState('');
  const { data, isFetching } = useSlips({
    warehouseId: warehouse.id,
    kind: kind === 'all' ? undefined : kind,
    month: month?.format('YYYY-MM'),
    q: q || undefined,
  });
  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={12} align="center">
        <Select
          value={kind}
          onChange={setKind}
          style={{ width: 150 }}
          options={[{ value: 'all', label: 'Mọi loại phiếu' }, ...(Object.keys(SLIP) as SlipKind[]).map((k) => ({ value: k, label: SLIP[k].label }))]}
        />
        <DatePicker picker="month" format="MM/YYYY" value={month} onChange={setMonth} placeholder="Mọi tháng" />
        <Input.Search id="slip-search" placeholder="Số phiếu, nơi lấy hàng, người nhận, lệnh" allowClear onSearch={(v) => setQ(v.trim())} style={{ width: 260 }} />
      </Flex>
      <Table<Slip>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={pager(data?.length)}
        locale={{ emptyText: 'Không có phiếu' }}
        scroll={{ x: 1150 }}
        rowClassName={(r) => (r.voidedAt || r.status === 'CANCELLED' || r.status === 'REJECTED' ? 'row-voided' : '')}
        onRow={(r) => ({ onClick: () => onOpen(r.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Ngày', dataIndex: 'date', width: 100, render: formatDate },
          { title: 'Số phiếu', dataIndex: 'code', width: 160 },
          { title: 'Loại', dataIndex: 'kind', width: 110, render: (k: SlipKind) => <Tag color={SLIP[k].color}>{SLIP[k].label}</Tag> },
          { title: 'Trạng thái', key: 'st', width: 140, render: (_, r) => <SlipStatusTag slip={r} /> },
          { title: 'Vật tư', key: 'l', ellipsis: true, render: (_, r) => r.lines.map((l) => `${l.label}: ${lineQty(l)}`).join('; ') },
          { title: 'Nơi lấy hàng / người nhận / kho bên kia', key: 'p', width: 200, render: (_, r) => [r.supplierName, r.receiver, r.counterpart?.warehouseName].filter(Boolean).join(' · ') },
          { title: 'Mục đích / lệnh', key: 'r', width: 170, render: (_, r) => [r.purpose, r.reference].filter(Boolean).join(' · ') },
          { title: 'Người lập', dataIndex: 'createdBy', width: 120 },
        ]}
      />
    </Flex>
  );
}

function SlipDrawer({ id, onClose, onOpen }: { id: string; onClose: () => void; onOpen: (id: string) => void }) {
  const { message, modal } = App.useApp();
  const slipQuery = useSlip(id);
  const s = slipQuery.data;
  const m = useWarehouseMutations();
  const ask = (title: string, ok: string, run: (reason: string) => Promise<unknown>, danger = true) => {
    let reason = '';
    modal.confirm({
      title,
      content: <Input.TextArea id="slip-reason" autoFocus placeholder="Lý do" onChange={(e) => (reason = e.target.value)} />,
      okText: ok,
      okButtonProps: { danger },
      cancelText: 'Đóng',
      onOk: () =>
        reason.trim()
          ? run(reason.trim()).then(
              () => message.success('Đã ghi nhận'),
              (e) => {
                message.error(errorMessage(e));
                throw e;
              },
            )
          : (message.warning('Ghi lý do'), Promise.reject(new Error('reason'))),
    });
  };
  return (
    <Drawer
      open
      size={760}
      onClose={onClose}
      loading={slipQuery.isLoading}
      title={s ? `${s.code} · ${SLIP[s.kind].label}` : 'Phiếu kho'}
      extra={
        s && (
          <Space wrap>
            {s.canVoid && (
              <Button danger onClick={() => ask(`Huỷ phiếu ${s.code}? Tồn sẽ được trả lại như trước khi lập phiếu.`, 'Huỷ phiếu', (reason) => m.voidSlip.mutateAsync({ id: s.id, reason }))}>Huỷ phiếu</Button>
            )}
          </Space>
        )
      }
    >
      {s && (
        <Flex vertical gap={16}>
          {s.status === 'REJECTED' && <Alert type="error" showIcon title={`Bị từ chối: ${s.rejectReason}`} />}
          {s.voidedAt && <Alert type="warning" showIcon title={`Đã huỷ: ${s.voidReason}`} />}
          <Descriptions
            size="small"
            bordered
            column={2}
            items={[
              { label: 'Kho', children: `${s.warehouseName} (${s.warehouseCode})` },
              { label: 'Trạng thái', children: <SlipStatusTag slip={s} /> },
              { label: 'Ngày', children: formatDate(s.date) },
              { label: 'Người lập', children: `${s.createdBy}, ${formatDateTime(s.createdAt)}` },
              ...(s.counterpart
                ? [{ label: s.kind === 'TRANSFER_OUT' ? 'Chuyển đến' : 'Chuyển từ', children: <a onClick={() => onOpen(s.counterpart!.id)}>{s.counterpart.warehouseName} · {s.counterpart.code}</a> }]
                : []),
              ...(s.supplierName ? [{ label: 'Nơi lấy hàng', children: s.supplierName }] : []),
              ...(s.receiver ? [{ label: s.kind === 'RETURN' ? 'Người trả' : 'Người nhận', children: s.receiver }] : []),
              ...(s.purpose ? [{ label: 'Mục đích', children: s.purpose }] : []),
              ...(s.reference ? [{ label: 'Lệnh / chứng từ', children: s.reference }] : []),
              ...(s.note ? [{ label: 'Ghi chú', span: 2, children: s.note }] : []),
            ]}
          />
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={s.lines}
            columns={[
              { title: 'Vật tư / quy cách', dataIndex: 'label' },
              { title: 'Số lượng', key: 'q', width: 220, align: 'right', render: (_, l) => lineQty(l) },
            ]}
          />
        </Flex>
      )}
    </Drawer>
  );
}

type LineValue = { specId?: string; unitId?: string | null; qty?: number };
/** Một lựa chọn trên dòng phiếu: quy cách + tồn ở kho đang lập phiếu (null = kho chưa có vật tư này) */
type LineItem = Pick<StockItem, 'specId' | 'materialCode' | 'label' | 'unit' | 'units'> & { qty: number | null };

/**
 * Vật tư chọn được trên phiếu: phiếu nhập / nhập lại lấy toàn bộ danh mục vật tư (vật tư chưa có ở kho thì kho có dòng tồn
 * khi lưu); phiếu xuất / chuyển đi chỉ lấy vật tư đang có ở kho.
 */
function useLineItems(warehouseId: string, wholeCatalog: boolean): LineItem[] {
  const stock = useStockItems(warehouseId);
  const catalog = useWhMaterials();
  const at = new Map((stock.data ?? []).map((i) => [i.specId, i]));
  if (!wholeCatalog) return stock.data ?? [];
  return (catalog.data ?? [])
    .filter((m) => m.isActive)
    .flatMap((m) =>
      m.specs
        .filter((p) => p.isActive)
        .map((p) => {
          const st = at.get(p.id);
          if (st) return st;
          return {
            specId: p.id,
            materialCode: m.code,
            label: p.label ? `${m.name} · ${p.label}` : m.name,
            unit: m.unit,
            units: [{ id: null, name: m.unit, factor: 1 }, ...m.units.filter((u) => !u.specId || u.specId === p.id).map((u) => ({ id: u.id, name: u.name, factor: u.factor }))],
            qty: null,
          };
        }),
    );
}

function LinesEditor({ items, lines }: { items: LineItem[]; lines: LineValue[] }) {
  const bySpec = new Map(items.map((i) => [i.specId, i]));
  const options = items.map((i) => ({ value: i.specId, label: `${i.materialCode ? `${i.materialCode} · ` : ''}${i.label} (${i.qty === null ? 'chưa có ở kho này' : `tồn ${qty(i.qty)} ${i.unit}`})` }));
  return (
    <Form.List name="lines">
      {(fields, { add, remove }) => (
        <Flex vertical gap={4}>
          {fields.map((f, i) => {
            const it = bySpec.get(lines[i]?.specId ?? '');
            const unit = it?.units.find((u) => (u.id ?? null) === (lines[i]?.unitId ?? null));
            const base = unit && unit.factor !== 1 && lines[i]?.qty ? ` = ${qty(Math.round(lines[i].qty! * unit.factor * 1000) / 1000)} ${it!.unit}` : '';
            return (
              <Flex key={f.key} gap={8} align="start" wrap>
                <Form.Item name={[f.name, 'specId']} style={{ flex: 1, minWidth: 260, marginBottom: 8 }} rules={[{ required: true, message: 'Chọn vật tư' }]}>
                  <Select showSearch optionFilterProp="label" placeholder="Vật tư · quy cách" options={options} />
                </Form.Item>
                <Form.Item name={[f.name, 'qty']} style={{ width: 120, marginBottom: 8 }} rules={[{ required: true, message: 'Số lượng' }]} extra={base}>
                  <InputNumber min={0.001} style={{ width: '100%' }} placeholder="Số lượng" />
                </Form.Item>
                <Form.Item name={[f.name, 'unitId']} style={{ width: 120, marginBottom: 8 }}>
                  <Select
                    aria-label="Đơn vị"
                    disabled={!it}
                    options={(it?.units ?? []).map((u) => ({ value: u.id ?? '', label: u.factor === 1 && !u.id ? u.name : `${u.name} (${qty(u.factor)})` }))}
                    placeholder={it?.unit ?? 'Đơn vị'}
                  />
                </Form.Item>
                <Button type="text" icon={<MinusCircleOutlined />} onClick={() => remove(f.name)} disabled={fields.length === 1} aria-label="Bỏ dòng" />
              </Flex>
            );
          })}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ unitId: '' })} style={{ alignSelf: 'flex-start' }}>Thêm dòng</Button>
        </Flex>
      )}
    </Form.List>
  );
}

/** Kho chỉ ghi số lượng và đơn vị tính, không ghi đơn giá */
const toLines = (lines: LineValue[]) => lines.filter((l) => l.specId && l.qty).map((l) => ({ specId: l.specId!, unitId: l.unitId || null, qty: l.qty! }));

type SlipForm = { date: Dayjs; supplierName?: string; receiver?: string; purpose?: string; reference?: string; note?: string; lines: LineValue[] };

function SlipModal({ kind, warehouse, onClose, onCreated }: { kind: NewKind; warehouse: Warehouse; onClose: () => void; onCreated: (id: string) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<SlipForm>();
  const items = useLineItems(warehouse.id, kind !== 'ISSUE');
  const suppliers = useSuppliers();
  const { createSlip } = useWarehouseMutations();
  const lines = Form.useWatch('lines', form) ?? [];
  const submit = (v: SlipForm) =>
    createSlip.mutate(
      {
        warehouseId: warehouse.id,
        kind,
        date: v.date.format('YYYY-MM-DD'),
        supplierName: v.supplierName?.trim() || null,
        receiver: v.receiver || null,
        purpose: v.purpose || null,
        reference: v.reference || null,
        note: v.note || null,
        lines: toLines(v.lines),
      },
      {
        onSuccess: (s) => {
          message.success(`Đã lưu ${s.code}, tồn đã cập nhật`);
          onClose();
          onCreated(s.id);
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  return (
    <Modal open width={900} title={`${NEW_TITLE[kind]} · ${warehouse.name}`} okText="Lưu phiếu" cancelText="Đóng" onCancel={onClose} onOk={() => form.submit()} confirmLoading={createSlip.isPending} destroyOnHidden>
      <Form<SlipForm> form={form} layout="vertical" onFinish={submit} initialValues={{ date: dayjs(), lines: [{ unitId: '' }] }}>
        <Flex wrap gap={12}>
          <Form.Item name="date" label="Ngày" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} />
          </Form.Item>
          {kind === 'RECEIPT' && (
            <Form.Item name="supplierName" label="Nơi lấy hàng (nếu có)" style={{ minWidth: 260 }} tooltip="Ghi để tra cứu sau, không bắt buộc. Phần mềm không quản lý tồn ở nơi này.">
              <AutoComplete id="slip-supplier" allowClear placeholder="Ví dụ: Giấy Hải Tiến" options={(suppliers.data ?? []).map((n) => ({ value: n }))} filterOption={(input, o) => String(o?.value ?? '').toLowerCase().includes(input.toLowerCase())} />
            </Form.Item>
          )}
          {kind !== 'RECEIPT' && (
            <Form.Item name="receiver" label={kind === 'ISSUE' ? 'Người nhận' : 'Người trả'} rules={kind === 'ISSUE' ? [{ required: true, message: 'Ghi người nhận' }] : []}>
              <Input style={{ width: 200 }} />
            </Form.Item>
          )}
          {kind === 'ISSUE' && (
            <Form.Item name="purpose" label="Mục đích">
              <Input style={{ width: 200 }} placeholder="In túi, bồi hộp..." />
            </Form.Item>
          )}
          <Form.Item name="reference" label={kind === 'RECEIPT' ? 'Số hoá đơn / chứng từ' : 'Lệnh / đơn tham chiếu'}>
            <Input style={{ width: 170 }} />
          </Form.Item>
        </Flex>
        <LinesEditor items={items} lines={lines} />
        <Form.Item name="note" label="Ghi chú" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

type TransferForm = { date: Dayjs; to?: string; receiver?: string; reference?: string; note?: string; lines: LineValue[] };

function TransferModal({ warehouse, onClose, onCreated }: { warehouse: Warehouse; onClose: () => void; onCreated: (id: string) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<TransferForm>();
  const items = useLineItems(warehouse.id, false);
  const warehouses = useWarehouses();
  const { createTransfer } = useWarehouseMutations();
  const lines = Form.useWatch('lines', form) ?? [];
  const submit = (v: TransferForm) =>
    createTransfer.mutate(
      {
        fromWarehouseId: warehouse.id,
        toWarehouseId: v.to && !isNew(v.to) ? v.to : null,
        toWarehouseName: newName(v.to) || null,
        date: v.date.format('YYYY-MM-DD'),
        receiver: v.receiver || null,
        reference: v.reference || null,
        note: v.note || null,
        lines: toLines(v.lines),
      },
      {
        onSuccess: (s) => {
          message.success(`Đã chuyển ${s.code} sang ${s.counterpart?.warehouseName}`);
          onClose();
          onCreated(s.id);
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  return (
    <Modal open width={900} title={`Chuyển kho · từ ${warehouse.name}`} okText="Chuyển kho" cancelText="Đóng" onCancel={onClose} onOk={() => form.submit()} confirmLoading={createTransfer.isPending} destroyOnHidden>
      <Typography.Paragraph type="secondary">
        Lưu là hàng rời {warehouse.name} và vào kho nhận ngay. Kho nhận chưa có vật tư sẽ được thêm vào; gõ tên kho chưa có thì phần mềm tự thêm kho (Kho ngoài).
      </Typography.Paragraph>
      <Form<TransferForm> form={form} layout="vertical" onFinish={submit} initialValues={{ date: dayjs(), lines: [{ unitId: '' }] }}>
        <Flex wrap gap={12}>
          <Form.Item name="date" label="Ngày" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="to" label="Chuyển đến kho" rules={[{ required: true, message: 'Chọn kho nhận hoặc gõ tên mới' }]} style={{ minWidth: 240 }}>
            <CreatableSelect id="transfer-to" addLabel="Thêm kho" placeholder="Chọn hoặc gõ tên kho" options={khoOptions(warehouses.data, warehouse.id)} />
          </Form.Item>
          <Form.Item name="receiver" label="Người mang / người nhận">
            <Input style={{ width: 180 }} />
          </Form.Item>
          <Form.Item name="reference" label="Lý do / lệnh">
            <Input style={{ width: 170 }} />
          </Form.Item>
        </Flex>
        <LinesEditor items={items} lines={lines} />
        <Form.Item name="note" label="Ghi chú" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** Mọi kho đang dùng, nhóm Âu Việt / Kho ngoài (bỏ kho `except`) */
function khoOptions(list: Warehouse[] | undefined, except?: string) {
  return (['AU_VIET', 'EXTERNAL'] as const)
    .map((o) => ({ label: OWNERSHIP[o].label, options: (list ?? []).filter((w) => w.isActive && w.ownership === o && w.id !== except).map((w) => ({ value: w.id, label: w.name })) }))
    .filter((g) => g.options.length);
}

/**
 * Chọn kho khác ngoài hàng nút (kho ngoài chưa có vật tư): gõ tên, có rồi thì chọn, chưa có thì thêm kho mới (Kho ngoài).
 * Người không có quyền lập phiếu chỉ chọn được kho có sẵn.
 */
function OtherKho({ onPick }: { onPick: (code: string) => void }) {
  const { message } = App.useApp();
  const can = useCan();
  const warehouses = useWarehouses();
  const { saveWarehouse } = useWarehouseMutations();
  const choose = async (v: string) => {
    if (!isNew(v)) {
      const w = warehouses.data?.find((x) => x.id === v);
      if (w) onPick(w.code);
      return;
    }
    const name = newName(v);
    try {
      await saveWarehouse.mutateAsync({ name, ownership: 'EXTERNAL' });
      const { data: list } = await warehouses.refetch();
      const w = list?.find((x) => x.name.toLowerCase() === name.replace(/\s+/g, ' ').toLowerCase());
      message.success(`Đã thêm kho ${name} (Kho ngoài)`);
      if (w) onPick(w.code);
    } catch (e) {
      message.error(errorMessage(e));
    }
  };
  return can('warehouse.slip') ? (
    <CreatableSelect id="other-kho" value={null as unknown as string} addLabel="Thêm kho" placeholder="Kho khác…" style={{ width: 200 }} popupMatchSelectWidth={280} options={khoOptions(warehouses.data)} onChange={choose} loading={saveWarehouse.isPending} />
  ) : (
    <Select id="other-kho" value={null} showSearch optionFilterProp="label" placeholder="Kho khác…" style={{ width: 200 }} options={khoOptions(warehouses.data)} onChange={choose} />
  );
}
