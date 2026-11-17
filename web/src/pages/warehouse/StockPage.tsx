import { DownloadOutlined, ExportOutlined, ImportOutlined, MinusCircleOutlined, PlusOutlined, RollbackOutlined } from '@ant-design/icons';
import { App, Button, DatePicker, Drawer, Flex, Form, Input, InputNumber, Modal, Segmented, Select, Space, Table, Tabs, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { Schemas } from '../../api/client';
import { usePartners, useSlips, useStockCard, useStockItems, useWarehouseMutations, type StockItem } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatVnd, vndInputProps } from '../../lib/format';
import { downloadCsv, PageHead, qty, SLIP, type SlipKind } from './common';

type NewKind = 'RECEIPT' | 'ISSUE' | 'RETURN';
const NEW_TITLE: Record<NewKind, string> = { RECEIPT: 'Phiếu nhập kho', ISSUE: 'Phiếu xuất kho', RETURN: 'Phiếu nhập lại (hàng thừa trả về kho)' };

/** Tồn kho theo vật tư và khổ, thẻ kho từng khổ, danh sách phiếu */
export function WarehouseStockPage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'slips' ? 'slips' : 'stock';
  const [creating, setCreating] = useState<NewKind | null>(null);
  return (
    <Flex vertical gap={16}>
      <PageHead
        title="Tồn kho & phiếu"
        extra={
          can('warehouse.slip') && (
            <Space wrap>
              <Button icon={<ImportOutlined />} onClick={() => setCreating('RECEIPT')}>Nhập kho</Button>
              <Button icon={<RollbackOutlined />} onClick={() => setCreating('RETURN')}>Nhập lại</Button>
              <Button type="primary" icon={<ExportOutlined />} onClick={() => setCreating('ISSUE')}>Xuất kho</Button>
            </Space>
          )
        }
      />
      <Tabs
        activeKey={tab}
        onChange={(k) => setParams(k === 'slips' ? { tab: k } : {})}
        items={[
          { key: 'stock', label: 'Tồn kho', children: <StockTable /> },
          { key: 'slips', label: 'Phiếu kho', children: <SlipList /> },
        ]}
      />
      {creating && <SlipModal kind={creating} onClose={() => setCreating(null)} />}
    </Flex>
  );
}

function StockTable() {
  const { data, isFetching } = useStockItems();
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<string>('all');
  const [low, setLow] = useState(false);
  const [card, setCard] = useState<StockItem | null>(null);
  const groups = useMemo(() => [...new Set((data ?? []).map((i) => i.group))], [data]);
  const text = q.trim().toLowerCase();
  const rows = (data ?? []).filter((i) => (group === 'all' || i.group === group) && (!low || i.low) && (!text || i.label.toLowerCase().includes(text)));
  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={12} align="center">
        <Input.Search id="stock-search" placeholder="Tên vật tư hoặc khổ, ví dụ 27 x 23" allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 300 }} />
        <Segmented value={group} onChange={(v) => setGroup(String(v))} options={[{ value: 'all', label: 'Tất cả' }, ...groups.map((g) => ({ value: g, label: g }))]} />
        <Segmented value={low ? 'low' : 'any'} onChange={(v) => setLow(v === 'low')} options={[{ value: 'any', label: 'Mọi mức tồn' }, { value: 'low', label: 'Dưới tối thiểu' }]} />
        <Button
          icon={<DownloadOutlined />}
          onClick={() => downloadCsv(`ton-kho-${dayjs().format('YYYY-MM-DD')}.csv`, ['Nhóm', 'Vật tư / khổ', 'ĐVT', 'Tồn', 'Tối thiểu'], rows.map((i) => [i.group, i.label, i.unit, i.qty, i.minQty]))}
        >
          Xuất CSV
        </Button>
      </Flex>
      <Table<StockItem>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={rows}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        locale={{ emptyText: 'Chưa có vật tư. Thêm ở Danh mục kho.' }}
        onRow={(r) => ({ onClick: () => setCard(r), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Nhóm', dataIndex: 'group', width: 120 },
          { title: 'Vật tư / khổ', dataIndex: 'label' },
          { title: 'ĐVT', dataIndex: 'unit', width: 70 },
          {
            title: 'Tồn',
            key: 'qty',
            width: 140,
            align: 'right',
            sorter: (a, b) => a.qty - b.qty,
            render: (_, r) => <strong style={{ color: r.low ? '#cf1322' : undefined }}>{qty(r.qty)}</strong>,
          },
          { title: 'Tối thiểu', dataIndex: 'minQty', width: 100, align: 'right', render: (v: number | null) => (v === null ? '' : qty(v)) },
          { title: 'Giá trị tham khảo', dataIndex: 'valueVnd', width: 150, align: 'right', render: (v?: number | null) => (v ? formatVnd(v) : '') },
          { key: 'flag', width: 120, render: (_, r) => (r.low ? <Tag color="red">Dưới tối thiểu</Tag> : null) },
        ]}
      />
      {card && <StockCard item={card} onClose={() => setCard(null)} />}
    </Flex>
  );
}

function StockCard({ item, onClose }: { item: StockItem; onClose: () => void }) {
  const { data, isFetching } = useStockCard(item.id);
  return (
    <Drawer open size={720} onClose={onClose} title={`Thẻ kho · ${item.label}`}>
      <Typography.Paragraph>
        Tồn hiện tại: <strong>{qty(data?.item.qty ?? item.qty)} {item.unit}</strong>
      </Typography.Paragraph>
      <Table
        rowKey="slipId"
        size="small"
        loading={isFetching}
        dataSource={data?.rows}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        locale={{ emptyText: 'Chưa có phiếu nào' }}
        columns={[
          { title: 'Ngày', dataIndex: 'date', width: 100, render: formatDate },
          { title: 'Số phiếu', dataIndex: 'code', width: 120, render: (v: string, r) => <span>{v} <Tag color={SLIP[r.kind].color}>{SLIP[r.kind].label}</Tag></span> },
          { title: 'Diễn giải', key: 'd', render: (_, r) => [r.partyText, r.reference].filter(Boolean).join(' · ') },
          { title: 'Nhập', dataIndex: 'inQty', width: 80, align: 'right', render: (v: number) => (v ? qty(v) : '') },
          { title: 'Xuất', dataIndex: 'outQty', width: 80, align: 'right', render: (v: number) => (v ? qty(v) : '') },
          { title: 'Tồn', dataIndex: 'balance', width: 90, align: 'right', render: (v: number) => <strong>{qty(v)}</strong> },
        ]}
      />
    </Drawer>
  );
}

function SlipList() {
  const can = useCan();
  const { message, modal } = App.useApp();
  const [kind, setKind] = useState<SlipKind | 'all'>('all');
  const [month, setMonth] = useState<Dayjs | null>(dayjs());
  const [q, setQ] = useState('');
  const { data, isFetching } = useSlips({ kind: kind === 'all' ? undefined : kind, month: month?.format('YYYY-MM'), q: q || undefined });
  const { voidSlip } = useWarehouseMutations();
  const askVoid = (s: Schemas['SlipDto']) => {
    let reason = '';
    modal.confirm({
      title: `Huỷ phiếu ${s.code}?`,
      content: <Input.TextArea id="void-reason" autoFocus placeholder="Lý do huỷ" onChange={(e) => (reason = e.target.value)} />,
      okText: 'Huỷ phiếu',
      okButtonProps: { danger: true },
      cancelText: 'Đóng',
      onOk: () =>
        reason.trim()
          ? voidSlip.mutateAsync({ id: s.id, reason: reason.trim() }).then(() => message.success('Đã huỷ phiếu'), (e) => {
              message.error(errorMessage(e));
              throw e;
            })
          : (message.warning('Ghi lý do huỷ'), Promise.reject(new Error('reason'))),
    });
  };
  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={12} align="center">
        <Segmented value={kind} onChange={(v) => setKind(v as SlipKind | 'all')} options={[{ value: 'all', label: 'Tất cả' }, ...(Object.keys(SLIP) as SlipKind[]).map((k) => ({ value: k, label: SLIP[k].label }))]} />
        <DatePicker picker="month" format="MM/YYYY" value={month} onChange={setMonth} placeholder="Mọi tháng" />
        <Input.Search id="slip-search" placeholder="Số phiếu, người nhận, lệnh" allowClear onSearch={(v) => setQ(v.trim())} style={{ width: 260 }} />
      </Flex>
      <Table<Schemas['SlipDto']>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={{ pageSize: 30, hideOnSinglePage: true }}
        locale={{ emptyText: 'Không có phiếu' }}
        rowClassName={(r) => (r.voidedAt ? 'row-voided' : '')}
        columns={[
          { title: 'Ngày', dataIndex: 'date', width: 100, render: formatDate },
          { title: 'Số phiếu', dataIndex: 'code', width: 120 },
          { title: 'Loại', dataIndex: 'kind', width: 110, render: (k: SlipKind, r) => (r.voidedAt ? <Tag>Đã huỷ</Tag> : <Tag color={SLIP[k].color}>{SLIP[k].label}</Tag>) },
          { title: 'Vật tư', key: 'l', render: (_, r) => r.lines.map((l) => `${l.label}: ${qty(l.qty)} ${l.unit}`).join('; ') },
          { title: 'NCC / người nhận', key: 'p', width: 170, render: (_, r) => [r.partnerName, r.receiver].filter(Boolean).join(' · ') },
          { title: 'Mục đích / lệnh', key: 'r', width: 170, render: (_, r) => [r.purpose, r.reference].filter(Boolean).join(' · ') },
          { title: 'Người lập', dataIndex: 'createdBy', width: 120 },
          {
            key: 'a',
            width: 80,
            render: (_, r) =>
              can('warehouse.slip') && !r.voidedAt && r.kind !== 'ADJUST' ? (
                <Button size="small" type="link" danger onClick={() => askVoid(r)}>Huỷ</Button>
              ) : r.voidedAt ? (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.voidReason}</Typography.Text>
              ) : null,
          },
        ]}
      />
    </Flex>
  );
}

type LineValue = { stockItemId?: string; qty?: number; unitPriceVnd?: number | null };
type SlipForm = { date: Dayjs; partnerId?: string; receiver?: string; purpose?: string; reference?: string; note?: string; lines: LineValue[] };

function SlipModal({ kind, onClose }: { kind: NewKind; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<SlipForm>();
  const items = useStockItems();
  const partners = usePartners();
  const { createSlip } = useWarehouseMutations();
  const lines = Form.useWatch('lines', form) ?? [];
  const byId = new Map((items.data ?? []).map((i) => [i.id, i]));
  const options = (items.data ?? []).map((i) => ({ value: i.id, label: `${i.label} (tồn ${qty(i.qty)} ${i.unit})` }));
  const submit = (v: SlipForm) =>
    createSlip.mutate(
      {
        kind,
        date: v.date.format('YYYY-MM-DD'),
        partnerId: v.partnerId ?? null,
        receiver: v.receiver || null,
        purpose: v.purpose || null,
        reference: v.reference || null,
        note: v.note || null,
        lines: v.lines.filter((l) => l.stockItemId && l.qty).map((l) => ({ stockItemId: l.stockItemId!, qty: l.qty!, unitPriceVnd: kind === 'RECEIPT' ? (l.unitPriceVnd ?? null) : null })),
      },
      { onSuccess: (s) => (message.success(`Đã lập ${s.code}`), onClose()), onError: (e) => message.error(errorMessage(e)) },
    );
  return (
    <Modal open width={820} title={NEW_TITLE[kind]} okText="Lưu phiếu" cancelText="Đóng" onCancel={onClose} onOk={() => form.submit()} confirmLoading={createSlip.isPending} destroyOnHidden>
      <Form<SlipForm> form={form} layout="vertical" onFinish={submit} initialValues={{ date: dayjs(), lines: [{}] }}>
        <Flex wrap gap={12}>
          <Form.Item name="date" label="Ngày" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} />
          </Form.Item>
          {kind === 'RECEIPT' && (
            <Form.Item name="partnerId" label="Nhà cung cấp" style={{ minWidth: 240 }}>
              <Select allowClear showSearch optionFilterProp="label" options={(partners.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name }))} />
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
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <Flex vertical gap={4}>
              {fields.map((f, i) => {
                const it = byId.get(lines[i]?.stockItemId ?? '');
                return (
                  <Flex key={f.key} gap={8} align="start">
                    <Form.Item name={[f.name, 'stockItemId']} style={{ flex: 1, marginBottom: 8 }} rules={[{ required: true, message: 'Chọn vật tư' }]}>
                      <Select showSearch optionFilterProp="label" placeholder="Vật tư · khổ" options={options} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'qty']} style={{ width: 140, marginBottom: 8 }} rules={[{ required: true, message: 'Số lượng' }]}>
                      <InputNumber min={0.001} style={{ width: '100%' }} placeholder="Số lượng" suffix={it?.unit} />
                    </Form.Item>
                    {kind === 'RECEIPT' && (
                      <Form.Item name={[f.name, 'unitPriceVnd']} style={{ width: 150, marginBottom: 8 }}>
                        <InputNumber {...vndInputProps} style={{ width: '100%' }} placeholder="Đơn giá (nếu có)" />
                      </Form.Item>
                    )}
                    <Button type="text" icon={<MinusCircleOutlined />} onClick={() => remove(f.name)} disabled={fields.length === 1} aria-label="Bỏ dòng" />
                  </Flex>
                );
              })}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} style={{ alignSelf: 'flex-start' }}>Thêm dòng</Button>
            </Flex>
          )}
        </Form.List>
        <Form.Item name="note" label="Ghi chú" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

