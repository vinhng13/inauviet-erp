import { CheckOutlined, CloseOutlined, MinusCircleOutlined, PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import { Alert, App, Badge, Button, DatePicker, Descriptions, Drawer, Flex, Form, Input, Modal, Select, Table, Segmented, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useBatch, useBatches, useDies, useLocations, useSymbols, useWarehouseMutations, type Batch, type DieRow } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { BatchStatusTag, DieStatusTag, DieTabs, PageHead, placeKey, useDiePlaces, type DieStatus } from './common';
import { pager } from '../../lib/paging';
import { CreatableSelect, isNew, newName } from '../../components/CreatableSelect';

type Tab = 'mine' | 'open' | 'all';


/** Các lần chuyển khuôn giữa kho, xưởng bế và nơi làm khuôn; có hiệu lực ngay */
/** Thẻ Bế khuôn & chuyển kho trong Kho khuôn */
export function WarehouseBatchesPage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'all';
  const open = params.get('open') ?? undefined;
  const set = (patch: Record<string, string | null>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return next;
    });
  const place = params.get('place') ?? undefined;
  const mine = useBatches('mine');
  const { data, isFetching } = useBatches(tab, place);
  const [creating, setCreating] = useState<MoveMode | null>(null);
  return (
    <Flex vertical gap={16}>
      <PageHead
        title="Kho khuôn"
        extra={
          can('warehouse.dies') && (
            <Flex gap={8}>
              <Button icon={<PlusOutlined />} onClick={() => setCreating('kho')}>Tạo phiếu chuyển kho</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating('cut')}>Bế khuôn</Button>
            </Flex>
          )
        }
      >
        <DieTabs view="moves" />
      </PageHead>
      {/* phiếu cũ (trước khi chuyển khuôn có hiệu lực ngay) còn chờ xác nhận */}
      {(mine.data?.length ?? 0) > 0 && (
        <Segmented
          value={tab}
          onChange={(k) => set({ tab: String(k), open: null })}
          options={[
            { value: 'all', label: 'Các lần chuyển' },
            { value: 'mine', label: <Badge count={mine.data!.length} size="small" offset={[10, 0]}>Phiếu cũ còn chờ</Badge> },
          ]}
        />
      )}
      <BatchTable rows={data} loading={isFetching} onOpen={(id) => set({ open: id })} emptyText={tab === 'mine' ? 'Không còn phiếu cũ nào chờ' : 'Chưa chuyển khuôn lần nào'} />
      {open && <BatchDrawer id={open} onClose={() => set({ open: null })} />}
      {creating && <BatchModal mode={creating} onClose={(b) => (setCreating(null), b && set({ open: b.id, tab: 'all' }))} />}
    </Flex>
  );
}

export function BatchTable({ rows, loading, onOpen, emptyText }: { rows?: Batch[]; loading?: boolean; onOpen: (id: string) => void; emptyText: string }) {
  return (
    <Table<Batch>
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={rows}
      pagination={pager(rows?.length)}
      locale={{ emptyText }}
      scroll={{ x: 1000 }}
      onRow={(b) => ({ onClick: () => onOpen(b.id), style: { cursor: 'pointer' } })}
      rowClassName={(b) => (b.status === 'REJECTED' || b.status === 'CANCELLED' ? 'row-voided' : '')}
      columns={[
        { title: 'Ngày', dataIndex: 'date', width: 100, render: formatDate },
        { title: 'Số phiếu', dataIndex: 'code', width: 140, render: (v: string) => <span style={{ whiteSpace: 'nowrap' }}>{v}</span> },
        { title: 'Từ → Đến', key: 'ft', width: 260, render: (_, b) => `${b.fromName} → ${b.toName}` },
        { title: 'Khuôn', key: 'd', width: 220, render: (_, b) => <span>{b.dies.map((d) => d.code).join(', ')}{b.isNew && <Typography.Text type="secondary"> (khuôn mới)</Typography.Text>}</span> },
        { title: 'Lệnh', dataIndex: 'reference', width: 140 },
        { title: 'Trạng thái', key: 's', width: 150, render: (_, b) => (b.status === 'OPEN' ? <span><BatchStatusTag batch={b} /><div style={{ fontSize: 12 }}>{b.waitingFor}</div></span> : <BatchStatusTag batch={b} />) },
        { title: 'Người chuyển', dataIndex: 'createdBy', width: 140 },
      ]}
    />
  );
}

export function BatchDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { message, modal } = App.useApp();
  const { data: b, isLoading } = useBatch(id);
  const locations = useLocations();
  const { sendBatch, receiveBatch, rejectBatch, cancelBatch } = useWarehouseMutations();
  const [shelf, setShelf] = useState<string | undefined>(undefined);
  const shelves = (locations.data ?? []).filter((l) => l.isActive && l.warehouseId === b?.toWarehouseId);
  const ok = (text: string) => () => message.success(text);
  const fail = (e: unknown) => message.error(errorMessage(e));
  const reject = () => {
    let reason = '';
    modal.confirm({
      title: `Từ chối phiếu ${b!.code}?`,
      content: <Input.TextArea id="batch-reject-reason" rows={3} placeholder="Lý do" onChange={(e) => (reason = e.target.value)} />,
      okText: 'Từ chối',
      okButtonProps: { danger: true },
      cancelText: 'Đóng',
      onOk: () => {
        if (!reason.trim()) {
          message.warning('Ghi lý do');
          return Promise.reject();
        }
        return rejectBatch.mutateAsync({ id, reason: reason.trim() }).then(ok('Đã từ chối, khuôn ở nguyên chỗ cũ'), fail);
      },
    });
  };
  return (
    <Drawer
      open
      size={760}
      onClose={onClose}
      loading={isLoading}
      title={b ? `${b.code} · ${b.isNew ? 'Khuôn mới' : 'Chuyển khuôn'}` : 'Chuyển khuôn'}
      extra={
        b && (
          <Flex gap={8} wrap>
            {b.canSend && <Button type="primary" icon={<CheckOutlined />} loading={sendBatch.isPending} onClick={() => sendBatch.mutate(id, { onSuccess: ok(b.inState === 'NONE' ? `Đã xác nhận xuất, khuôn tới ${b.toName}` : `Đã xuất, chờ ${b.toName} nhận`), onError: fail })}>Xác nhận xuất</Button>}
            {b.canReceive && (
              <>
                <CreatableSelect id="receive-shelf" allowClear addLabel="Thêm kệ" placeholder="Cất ở kệ" style={{ width: 160 }} value={shelf ?? b.toLocationId ?? undefined} onChange={setShelf} options={shelves.map((l) => ({ value: l.id, label: l.code }))} />
                <Button type="primary" icon={<CheckOutlined />} loading={receiveBatch.isPending} onClick={() => receiveBatch.mutate({ id, locationId: shelf && !isNew(shelf) ? shelf : shelf ? null : b.toLocationId, locationCode: newName(shelf) || null }, { onSuccess: ok(`Đã nhận khuôn vào ${b.toName}`), onError: fail })}>Xác nhận đã nhận</Button>
              </>
            )}
            {b.canReject && <Button danger icon={<CloseOutlined />} onClick={reject}>Từ chối</Button>}
            {!b.canReject && b.canCancel && (
              <Button danger onClick={() => modal.confirm({ title: `Huỷ phiếu ${b.code}?`, okText: 'Huỷ phiếu', okButtonProps: { danger: true }, cancelText: 'Đóng', onOk: () => cancelBatch.mutateAsync(id).then(ok('Đã huỷ phiếu'), fail) })}>
                Huỷ phiếu
              </Button>
            )}
            <Button icon={<PrinterOutlined />} onClick={() => printBatch(b)} aria-label="In biên bản" />
          </Flex>
        )
      }
    >
      {b && (
        <Flex vertical gap={16}>
          {b.waitingFor && !b.canSend && !b.canReceive && <Alert type="warning" showIcon title={b.waitingFor} />}
          {b.canReceive && <Alert type="info" showIcon title="Chọn kệ cất (nếu có) rồi bấm Xác nhận đã nhận." />}
          <Descriptions
            size="small"
            column={2}
            bordered
            items={[
              { label: 'Trạng thái', children: <BatchStatusTag batch={b} /> },
              { label: 'Ngày', children: formatDate(b.date) },
              { label: 'Từ', children: b.fromName },
              { label: 'Đến', children: b.toName },
              { label: 'Lệnh sản xuất', children: b.reference ?? '—' },
              { label: 'Người chuyển', children: `${b.createdBy}, ${formatDateTime(b.createdAt)}` },
              // phiếu cũ còn chờ xác nhận
              ...(b.status === 'OPEN'
                ? [
                    { label: 'Xác nhận xuất', children: b.outState === 'NONE' ? <Typography.Text type="secondary">Không cần</Typography.Text> : b.outBy ? `${b.outBy}, ${formatDateTime(String(b.outAt))}` : <Typography.Text type="secondary">chưa</Typography.Text> },
                    { label: 'Xác nhận nhận', children: b.inState === 'NONE' ? <Typography.Text type="secondary">Không có bước nhận</Typography.Text> : b.inBy ? `${b.inBy}, ${formatDateTime(String(b.inAt))}` : <Typography.Text type="secondary">chưa</Typography.Text> },
                  ]
                : []),
              ...(b.rejectReason ? [{ label: 'Lý do', span: 2, children: b.rejectReason }] : []),
              ...(b.note ? [{ label: 'Ghi chú', span: 2, children: b.note }] : []),
            ]}
          />
          <Table<DieRow>
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={b.dies}
            locale={{ emptyText: 'Khuôn mới đã bỏ cùng phiếu' }}
            columns={[
              { title: 'Mã', dataIndex: 'code', width: 95, render: (v: string, d) => <Link to={`/warehouse/dies?open=${d.id}`}>{v}</Link> },
              { title: 'Khuôn', dataIndex: 'productName' },
              { title: 'Kích thước', dataIndex: 'size', width: 120 },
              { title: 'Hiện tại', key: 'now', width: 230, render: (_, d) => <span><DieStatusTag status={d.status} /> {d.place}</span> },
            ]}
          />
        </Flex>
      )}
    </Drawer>
  );
}

type BatchForm = { date: Dayjs; from?: string; to?: string; toLocationId?: string; reference?: string; note?: string; newDies?: Array<{ symbolCode?: string; productName?: string; size?: string }> };

/** Bế khuôn / gửi sửa / chuyển kho: tới một kho bất kỳ (Âu Việt hoặc kho ngoài). Trạng thái theo thao tác, không theo loại kho */
export type MoveMode = 'cut' | 'kho' | 'fix';
const MODE: Record<MoveMode, { title: string; to: string; hint: string; ok: string }> = {
  cut: { title: 'Bế khuôn', to: 'Bế ở', ok: 'Bế khuôn', hint: 'Khuôn tới nơi bế (hoặc bế ngay tại kho đang giữ khuôn), trạng thái Đang bế. Chỉ khuôn đã kiểm tra Đạt mới bế được.' },
  kho: { title: 'Phiếu chuyển kho', to: 'Kho nhận', ok: 'Chuyển kho', hint: 'Khuôn sang kho nhận. Khuôn đang bế về kho thì thành Đạt, sẵn sàng; còn lại giữ nguyên trạng thái.' },
  fix: { title: 'Gửi sửa / làm lại', to: 'Sửa ở', ok: 'Gửi sửa', hint: 'Khuôn không đạt tới nơi sửa (hoặc sửa ngay tại kho đang giữ khuôn), trạng thái Đang sửa. Sửa xong bấm Kiểm tra.' },
};

/**
 * Chuyển khuôn: từ kho khuôn đang ở tới bất kỳ kho nào (gõ tên kho mới thì tự thêm thành Kho ngoài), có hiệu lực ngay khi lưu.
 * `dies` chọn sẵn (từ danh sách hoặc hồ sơ khuôn) thì nơi đi cố định theo khuôn. Từ một kho Âu Việt có thể thêm khuôn chưa có mã.
 */
export function BatchModal({ dies = [], mode, onClose }: { dies?: DieRow[]; mode: MoveMode; onClose: (b?: Batch) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<BatchForm>();
  const places = useDiePlaces();
  const symbols = useSymbols();
  const locations = useLocations();
  const { createBatch } = useWarehouseMutations();
  const preset = dies.length > 0;
  const presetFrom = preset ? placeKey(dies[0]) : undefined;
  const mixed = preset && dies.some((d) => placeKey(d) !== presetFrom);
  const watchedFrom = Form.useWatch('from', form);
  const from = watchedFrom && watchedFrom.length > 2 ? watchedFrom : presetFrom;
  // Mặc định đi từ kho Âu Việt đang giữ nhiều khuôn nhất (khi danh sách kho đã tải)
  const firstKho = ([...places.khos].sort((a, b) => Number(b.ownership === 'AU_VIET') - Number(a.ownership === 'AU_VIET') || b.dies - a.dies)[0])?.id;
  useEffect(() => {
    if (!preset && firstKho && !form.getFieldValue('from')) form.setFieldValue('from', `k:${firstKho}`);
  }, [firstKho, preset, form]);
  const to = Form.useWatch('to', form);
  const newDies = Form.useWatch('newDies', form) ?? [];
  const [selected, setSelected] = useState<string[]>(dies.map((d) => d.id));
  const [q, setQ] = useState('');
  const candidates = useDies({ place: from, q: q.trim() || undefined }, !preset && !!from);

  const pool = (preset ? dies : (candidates.data?.items ?? [])).filter((d) => !d.pendingBatchId || selected.includes(d.id));
  const kho = (key?: string) => (key?.startsWith('k:') ? places.khos.find((k) => k.id === key.slice(2)) : undefined);
  const fromKho = kho(from)?.ownership === 'AU_VIET' ? from!.slice(2) : null;
  const toKho = to?.startsWith('k:') && to !== from && kho(to)?.ownership === 'AU_VIET' ? to.slice(2) : null;
  // Bế / sửa ngay tại kho đang giữ khuôn được (làm khuôn ở Mê Linh, bế luôn ở Mê Linh), không phải chuyển đi đâu
  const here = mode !== 'kho';
  // Nhóm "Tại chỗ" đứng đầu (bế / sửa ngay tại kho đang giữ khuôn), rồi các kho khác theo sở hữu
  const toOptions = [
    ...(here && from?.startsWith('k:') ? [{ label: 'Tại chỗ', options: [{ value: from, label: `${places.name(from)} (${mode === 'fix' ? 'sửa' : 'bế'} tại chỗ)` }] }] : []),
    ...places.options.map((g) => ({ ...g, options: g.options.filter((o) => o.value !== from) })),
  ].filter((g) => g.options.length);

  const submit = (v: BatchForm) => {
    const f = v.from ?? presetFrom;
    if (!f || !v.to) return;
    const lines = (v.newDies ?? []).filter((n) => n.productName?.trim());
    if (!selected.length && !lines.length) {
      message.warning('Chọn ít nhất một khuôn');
      return;
    }
    createBatch.mutate(
      {
        date: v.date.format('YYYY-MM-DD'),
        fromWarehouseId: f.slice(2),
        toWarehouseId: v.to.startsWith('k:') ? v.to.slice(2) : null,
        toWarehouseName: v.to.startsWith('n:') ? v.to.slice(2).trim() : null,
        purpose: mode === 'fix' ? 'REPAIR' : mode === 'cut' ? 'CUT' : null,
        toLocationId: toKho && v.toLocationId && !isNew(v.toLocationId) ? v.toLocationId : null,
        toLocationCode: (toKho && newName(v.toLocationId)) || null,
        dieIds: selected,
        newDies: lines.map((n) => ({ symbolCode: n.symbolCode!, productName: n.productName!.trim(), size: n.size?.trim() || null })),
        reference: v.reference?.trim() || null,
        note: v.note?.trim() || null,
      },
      {
        onSuccess: (b) => {
          message.success(`${MODE[mode].title}: ${b.dies.length} khuôn tới ${b.toName} (${b.code})`);
          onClose(b);
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  };
  return (
    <Modal open width={860} title={MODE[mode].title} okText={MODE[mode].ok} cancelText="Đóng" onCancel={() => onClose()} onOk={() => form.submit()} okButtonProps={{ disabled: mixed }} confirmLoading={createBatch.isPending} destroyOnHidden>
      {mixed && <Alert type="error" style={{ marginBottom: 12 }} title="Các khuôn đã chọn đang ở nhiều nơi khác nhau. Mỗi lần chuyển chỉ đi từ một nơi." />}
      <Form<BatchForm> form={form} layout="vertical" onFinish={submit} initialValues={{ date: dayjs(), from: presetFrom ?? (firstKho ? `k:${firstKho}` : undefined), to: mode !== 'kho' && preset && dies[0].external && dies.every((d) => d.status !== 'IN_USE') ? presetFrom : undefined }}>
        <Flex wrap gap={12}>
          <Form.Item name="date" label="Ngày" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
          <Form.Item name="from" label="Từ (khuôn đang ở)" rules={[{ required: true, message: 'Chọn nơi đi' }]} style={{ minWidth: 220 }}>
            <Select id="batch-from" showSearch optionFilterProp="label" disabled={preset} options={places.options} onChange={() => (setSelected([]), form.setFieldValue('newDies', []))} />
          </Form.Item>
          <Form.Item name="to" label={MODE[mode].to} rules={[{ required: true, message: 'Chọn nơi đến' }]} style={{ minWidth: 240 }}>
            <CreatableSelect id="batch-to" newPrefix="n:" addLabel="Thêm kho" placeholder="Chọn kho hoặc gõ tên mới" options={toOptions} onChange={() => form.setFieldValue('toLocationId', undefined)} />
          </Form.Item>
          {toKho && (
            <Form.Item name="toLocationId" label="Cất ở kệ">
              <CreatableSelect allowClear addLabel="Thêm kệ" style={{ width: 160 }} options={(locations.data ?? []).filter((l) => l.isActive && l.warehouseId === toKho).map((l) => ({ value: l.id, label: l.code }))} />
            </Form.Item>
          )}
          {mode === 'cut' && (
            <Form.Item name="reference" label="Lệnh sản xuất (không bắt buộc)">
              <Input id="batch-ref" style={{ width: 190 }} placeholder="LSX-…" />
            </Form.Item>
          )}
        </Flex>
        <Alert type="info" style={{ marginBottom: 12 }} title={`${MODE[mode].hint} Lưu là có hiệu lực ngay.`} />
        {!preset && (
          <Input.Search id="batch-die-search" placeholder="Lọc khuôn ở nơi đi: tên, mã hoặc kích thước" allowClear onSearch={setQ} style={{ marginBottom: 8, maxWidth: 380 }} />
        )}
        <Table<DieRow>
          rowKey="id"
          size="small"
          loading={!preset && candidates.isFetching}
          dataSource={pool}
          pagination={pager(pool?.length)}
          rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
          locale={{ emptyText: from ? `Không có khuôn nào ở ${places.name(from)}` : 'Chọn nơi đi' }}
          columns={[
            { title: 'Mã', dataIndex: 'code', width: 95 },
            { title: 'Khuôn', dataIndex: 'productName', ellipsis: true },
            { title: 'Kích thước', dataIndex: 'size', width: 120 },
            { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (s: DieStatus) => <DieStatusTag status={s} /> },
            { title: 'Ở đâu', dataIndex: 'place', width: 170 },
          ]}
          title={() => `Đã chọn ${selected.length + newDies.filter((n) => n?.productName).length} khuôn`}
        />
        {fromKho && !preset && mode === 'cut' && (
          <Form.List name="newDies">
            {(fields, { add, remove }) => (
              <Flex vertical gap={8} style={{ marginTop: 8 }}>
                {fields.map((f) => (
                  <Flex key={f.key} gap={8} wrap align="start">
                    <Form.Item name={[f.name, 'symbolCode']} rules={[{ required: true, message: 'Ký hiệu' }]} style={{ margin: 0 }}>
                      <Select style={{ width: 150 }} placeholder="Ký hiệu" options={(symbols.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))} />
                    </Form.Item>
                    <Form.Item name={[f.name, 'productName']} rules={[{ required: true, message: 'Ghi tên khuôn' }]} style={{ margin: 0, flex: 1, minWidth: 200 }}>
                      <Input placeholder="Tên khuôn" />
                    </Form.Item>
                    <Form.Item name={[f.name, 'size']} style={{ margin: 0 }}>
                      <Input placeholder="24x24x12,5" style={{ width: 140 }} />
                    </Form.Item>
                    <Button type="text" icon={<MinusCircleOutlined />} onClick={() => remove(f.name)} aria-label="Bỏ dòng" />
                  </Flex>
                ))}
                <div>
                  <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ symbolCode: symbols.data?.[0]?.code })}>Khuôn có trong kho nhưng chưa có mã</Button>{' '}
                  <Typography.Text type="secondary">mã cấp tự động theo ký hiệu khi lưu, đánh dấu cần bổ sung thông tin</Typography.Text>
                </div>
              </Flex>
            )}
          </Form.List>
        )}
        <Form.Item name="note" label="Ghi chú" style={{ marginTop: 12 }}>
          <Input />
        </Form.Item>
      </Form>
    </Modal>
  );
}

const esc = (s: string | null | undefined) => (s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Biên bản in (cửa sổ in của trình duyệt) */
export function printBatch(b: Batch): void {
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  const rows = b.dies
    .map((d, i) => `<tr><td>${i + 1}</td><td>${esc(d.code)}</td><td>${esc(d.productName)}</td><td>${esc(d.size)}</td><td>${d.pieces ?? ''}</td><td></td></tr>`)
    .join('');
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(b.code)}</title>
<style>body{font-family:system-ui,sans-serif;margin:32px;color:#111}h1{font-size:20px;text-align:center;margin:0 0 4px}p{margin:4px 0}
table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #444;padding:6px 8px;font-size:13px;text-align:left}
.sign{display:flex;justify-content:space-around;margin-top:32px;text-align:center}.sign div{width:40%}.muted{color:#555;font-size:12px}</style></head><body>
<p class="muted">CÔNG TY IN ÂU VIỆT</p>
<h1>BIÊN BẢN GIAO NHẬN KHUÔN</h1>
<p style="text-align:center">Số: ${esc(b.code)} · Ngày ${formatDate(b.date)}</p>
<p>Từ: <strong>${esc(b.fromName)}</strong> → Đến: <strong>${esc(b.toName)}</strong>${b.reference ? ` · Lệnh sản xuất: ${esc(b.reference)}` : ''}</p>
${b.note ? `<p>Ghi chú: ${esc(b.note)}</p>` : ''}
<table><thead><tr><th>#</th><th>Mã khuôn</th><th>Tên khuôn</th><th>Kích thước</th><th>Số mảnh</th><th>Tình trạng khi giao</th></tr></thead><tbody>${rows}</tbody></table>
<p>Tổng: ${b.dies.length} khuôn.</p>
<div class="sign"><div><strong>Bên giao</strong><p class="muted">(ký, ghi rõ họ tên)</p></div><div><strong>Bên nhận</strong><p class="muted">(ký, ghi rõ họ tên)</p></div></div>
<p class="muted" style="margin-top:48px">Người chuyển trên phần mềm: ${esc(b.createdBy)}</p>
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}
