import { CheckOutlined, CloseOutlined, MinusCircleOutlined, PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import { Alert, App, Badge, Button, Checkbox, DatePicker, Descriptions, Drawer, Flex, Form, Input, Modal, Select, Table, Tabs, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useBatch, useBatches, useDies, useLocations, useSymbols, useWarehouseMutations, type Batch, type DieRow } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { BatchStatusTag, DieStatusTag, PageHead, placeKey, useDiePlaces, type DieStatus } from './common';

type Tab = 'mine' | 'open' | 'all';

const RULES =
  'Mọi phiếu phải có nơi đến. Kho → xưởng: thủ kho kho đi xác nhận xuất. Xưởng → kho: thủ kho kho nhận xác nhận khi khuôn về (về ở trạng thái Chờ kiểm). ' +
  'Kho ↔ kho: kho đi xác nhận xuất, kho nhận xác nhận đã nhận. Xưởng → xưởng: thủ kho kho quản lý khuôn xác nhận. Bế lệnh mới tại xưởng đang giữ khuôn thì không cần phiếu.';

/** Phiếu giao nhận khuôn giữa các kho và xưởng; thủ kho xác nhận xuất / nhận */
export function WarehouseBatchesPage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'mine';
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
  const mine = useBatches('mine');
  const { data, isFetching } = useBatches(tab);
  const [creating, setCreating] = useState(false);
  return (
    <Flex vertical gap={16}>
      <PageHead
        title="Giao nhận khuôn"
        extra={can('warehouse.dies') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>Lập phiếu giao nhận</Button>}
      >
        <Alert type="info" title={RULES} />
      </PageHead>
      <Tabs
        activeKey={tab}
        onChange={(k) => set({ tab: k, open: null })}
        items={[
          { key: 'mine', label: <Badge count={mine.data?.length ?? 0} size="small" offset={[10, 0]}>Chờ bạn xác nhận</Badge> },
          { key: 'open', label: 'Đang mở' },
          { key: 'all', label: 'Tất cả phiếu' },
        ]}
      />
      <BatchTable rows={data} loading={isFetching} onOpen={(id) => set({ open: id })} emptyText={tab === 'mine' ? 'Không có phiếu nào chờ bạn xác nhận' : 'Không có phiếu'} />
      {open && <BatchDrawer id={open} onClose={() => set({ open: null })} />}
      {creating && <BatchModal onClose={(b) => (setCreating(false), b && set({ open: b.id, tab: 'open' }))} />}
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
      pagination={{ pageSize: 30, hideOnSinglePage: true }}
      locale={{ emptyText }}
      scroll={{ x: 1000 }}
      onRow={(b) => ({ onClick: () => onOpen(b.id), style: { cursor: 'pointer' } })}
      rowClassName={(b) => (b.status === 'REJECTED' || b.status === 'CANCELLED' ? 'row-voided' : '')}
      columns={[
        { title: 'Ngày', dataIndex: 'date', width: 100, render: formatDate },
        { title: 'Số phiếu', dataIndex: 'code', width: 130 },
        { title: 'Từ → Đến', key: 'ft', width: 260, render: (_, b) => `${b.fromName} → ${b.toName}` },
        { title: 'Khuôn', key: 'd', render: (_, b) => <span>{b.dies.map((d) => d.code).join(', ')}{b.isNew && <Typography.Text type="secondary"> (khuôn mới)</Typography.Text>}</span> },
        { title: 'Lệnh', dataIndex: 'reference', width: 140 },
        { title: 'Trạng thái', key: 's', width: 170, render: (_, b) => <BatchStatusTag batch={b} /> },
        {
          title: 'Đang chờ / xác nhận',
          key: 'w',
          width: 220,
          render: (_, b) => <span style={{ fontSize: 12 }}>{b.waitingFor ?? [b.outBy && `xuất: ${b.outBy}`, b.inBy && `nhận: ${b.inBy}`].filter(Boolean).join(' · ')}</span>,
        },
        { title: 'Người lập', dataIndex: 'createdBy', width: 120 },
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
      title={b ? `${b.code} · ${b.isNew ? 'Khuôn mới' : 'Giao nhận khuôn'}` : 'Phiếu giao nhận'}
      extra={
        b && (
          <Flex gap={8} wrap>
            {b.canSend && <Button type="primary" icon={<CheckOutlined />} loading={sendBatch.isPending} onClick={() => sendBatch.mutate(id, { onSuccess: ok(b.inState === 'NONE' ? `Đã xác nhận xuất, khuôn tới ${b.toName}` : `Đã xuất, chờ ${b.toName} nhận`), onError: fail })}>Xác nhận xuất</Button>}
            {b.canReceive && (
              <>
                <Select id="receive-shelf" allowClear placeholder="Cất ở kệ" style={{ width: 140 }} value={shelf ?? b.toLocationId ?? undefined} onChange={setShelf} options={shelves.map((l) => ({ value: l.id, label: l.code }))} />
                <Button type="primary" icon={<CheckOutlined />} loading={receiveBatch.isPending} onClick={() => receiveBatch.mutate({ id, locationId: shelf ?? b.toLocationId }, { onSuccess: ok(`Đã nhận khuôn vào ${b.toName}`), onError: fail })}>Xác nhận đã nhận</Button>
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
              { label: 'Lệnh / đơn', children: b.reference ?? '—' },
              { label: 'Hẹn về', children: b.expectedBackOn ? formatDate(b.expectedBackOn) : '—' },
              { label: 'Người lập', children: `${b.createdBy}, ${formatDateTime(b.createdAt)}` },
              { label: 'Kho xác nhận xuất', children: b.controlName ?? '—' },
              { label: 'Xác nhận xuất', children: b.outState === 'NONE' ? <Typography.Text type="secondary">Không cần (xưởng / nơi làm khuôn giao)</Typography.Text> : b.outBy ? `${b.outBy}, ${formatDateTime(String(b.outAt))}` : <Typography.Text type="secondary">chưa</Typography.Text> },
              { label: 'Xác nhận nhận', children: b.inState === 'NONE' ? <Typography.Text type="secondary">Không có bước nhận (giao tới xưởng)</Typography.Text> : b.inBy ? `${b.inBy}, ${formatDateTime(String(b.inAt))}` : <Typography.Text type="secondary">chưa</Typography.Text> },
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

type Mode = 'any' | 'out' | 'kho' | 'fix' | 'xx' | 'home';
const TITLE: Record<Mode, string> = {
  any: 'Lập phiếu giao nhận khuôn',
  out: 'Xuất khuôn đi bế',
  kho: 'Chuyển khuôn sang kho khác',
  fix: 'Gửi khuôn đi sửa',
  xx: 'Chuyển khuôn sang xưởng khác',
  home: 'Nhập khuôn về kho',
};

type BatchForm = { date: Dayjs; from?: string; to?: string; toLocationId?: string; expectedBackOn?: Dayjs; reference?: string; note?: string; confirm?: boolean; newDies?: Array<{ symbolCode?: string; productName?: string; size?: string }> };

/**
 * Lập phiếu: chọn nơi đi, nơi đến (bắt buộc), các khuôn đang ở nơi đi. Từ một kho có thể thêm khuôn chưa có mã.
 * `dies` chọn sẵn (từ danh sách hoặc hồ sơ khuôn) thì nơi đi cố định theo khuôn.
 */
export function BatchModal({ dies = [], mode = 'any', onClose }: { dies?: DieRow[]; mode?: Mode; onClose: (b?: Batch) => void }) {
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
  // Mặc định đi từ kho khuôn đầu tiên (khi danh sách kho đã tải)
  const firstKho = places.khos[0]?.id;
  useEffect(() => {
    if (!preset && firstKho && !form.getFieldValue('from')) form.setFieldValue('from', `k:${firstKho}`);
  }, [firstKho, preset, form]);
  const to = Form.useWatch('to', form);
  const newDies = Form.useWatch('newDies', form) ?? [];
  const [selected, setSelected] = useState<string[]>(dies.map((d) => d.id));
  const [q, setQ] = useState('');
  const candidates = useDies({ place: from, q: q.trim() || undefined }, !preset && !!from);

  const pool = (preset ? dies : (candidates.data?.items ?? [])).filter((d) => !d.pendingBatchId || selected.includes(d.id));
  const fromKho = from?.startsWith('k:') ? from.slice(2) : null;
  const toKho = to?.startsWith('k:') ? to.slice(2) : null;
  // Kho xác nhận xuất: kho đi; xưởng → xưởng thì kho quản lý khuôn
  const controlId = fromKho ?? (toKho ? null : (pool.find((d) => selected.includes(d.id))?.warehouseId ?? null));
  const control = places.khos.find((k) => k.id === controlId);
  const toOk = (v: string) =>
    v !== from &&
    ({ any: true, out: v.startsWith('x:'), kho: v.startsWith('k:'), fix: v.startsWith('x:'), xx: v.startsWith('x:'), home: v.startsWith('k:') } as const)[mode];
  const toOptions = places.options.map((g) => ({ ...g, options: g.options.filter((o) => toOk(o.value)) })).filter((g) => g.options.length);
  const rule = !to
    ? 'Chọn nơi đến để xem ai phải xác nhận.'
    : fromKho && toKho
      ? `Thủ kho ${places.name(from)} xác nhận xuất → khuôn đang chuyển → thủ kho ${places.name(to)} xác nhận đã nhận.`
      : fromKho
        ? `Thủ kho ${places.name(from)} xác nhận xuất → khuôn tới ${places.name(to)}.`
        : toKho
          ? `Khi khuôn về tới, thủ kho ${places.name(to)} xác nhận đã nhận; khuôn về ở trạng thái Chờ kiểm.`
          : `Không có kho nào trên đường đi: thủ kho ${control?.name ?? 'kho quản lý khuôn'} xác nhận thay.`;

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
        fromWarehouseId: f.startsWith('k:') ? f.slice(2) : null,
        fromPartnerId: f.startsWith('x:') ? f.slice(2) : null,
        toWarehouseId: v.to.startsWith('k:') ? v.to.slice(2) : null,
        toPartnerId: v.to.startsWith('x:') ? v.to.slice(2) : null,
        toLocationId: v.toLocationId ?? null,
        dieIds: selected,
        newDies: lines.map((n) => ({ symbolCode: n.symbolCode!, productName: n.productName!.trim(), size: n.size?.trim() || null })),
        expectedBackOn: v.expectedBackOn?.format('YYYY-MM-DD') ?? null,
        reference: v.reference?.trim() || null,
        note: v.note?.trim() || null,
        confirm: !!v.confirm,
      },
      {
        onSuccess: (b) => {
          message.success(b.waitingFor ? `Đã lập ${b.code}. ${b.waitingFor}` : `Đã lập và xác nhận ${b.code}`);
          onClose(b);
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  };
  return (
    <Modal open width={860} title={TITLE[mode]} okText="Lập phiếu" cancelText="Đóng" onCancel={() => onClose()} onOk={() => form.submit()} okButtonProps={{ disabled: mixed }} confirmLoading={createBatch.isPending} destroyOnHidden>
      {mixed && <Alert type="error" style={{ marginBottom: 12 }} title="Các khuôn đã chọn đang ở nhiều nơi khác nhau. Mỗi phiếu chỉ đi từ một nơi." />}
      <Form<BatchForm> form={form} layout="vertical" onFinish={submit} initialValues={{ date: dayjs(), from: presetFrom ?? (firstKho ? `k:${firstKho}` : undefined), confirm: true }}>
        <Flex wrap gap={12}>
          <Form.Item name="date" label="Ngày" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
          <Form.Item name="from" label="Từ" rules={[{ required: true, message: 'Chọn nơi đi' }]} style={{ minWidth: 200 }}>
            <Select id="batch-from" disabled={preset} options={places.options.filter((g) => g.label !== 'Nơi làm khuôn' || preset)} onChange={() => (setSelected([]), form.setFieldValue('newDies', []))} />
          </Form.Item>
          <Form.Item name="to" label="Đến (bắt buộc)" rules={[{ required: true, message: 'Chọn nơi đến. Mọi phiếu đều phải có nơi đến.' }]} style={{ minWidth: 220 }}>
            <Select id="batch-to" showSearch optionFilterProp="label" placeholder="Chọn kho hoặc xưởng" options={toOptions} onChange={() => form.setFieldValue('toLocationId', undefined)} />
          </Form.Item>
          {toKho && (
            <Form.Item name="toLocationId" label="Cất ở kệ">
              <Select allowClear style={{ width: 140 }} options={(locations.data ?? []).filter((l) => l.isActive && l.warehouseId === toKho).map((l) => ({ value: l.id, label: l.code }))} />
            </Form.Item>
          )}
          <Form.Item name="reference" label="Lệnh / đơn (không bắt buộc)">
            <Input id="batch-ref" style={{ width: 170 }} placeholder="LSX-…" />
          </Form.Item>
          {to?.startsWith('x:') && (
            <Form.Item name="expectedBackOn" label="Hẹn ngày lấy lại">
              <DatePicker format="DD/MM/YYYY" />
            </Form.Item>
          )}
        </Flex>
        <Alert type="info" style={{ marginBottom: 12 }} title={rule} />
        {!preset && (
          <Input.Search id="batch-die-search" placeholder="Lọc khuôn ở nơi đi: tên, mã hoặc kích thước" allowClear onSearch={setQ} style={{ marginBottom: 8, maxWidth: 380 }} />
        )}
        <Table<DieRow>
          rowKey="id"
          size="small"
          loading={!preset && candidates.isFetching}
          dataSource={pool}
          pagination={{ pageSize: 8, hideOnSinglePage: true }}
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
        {fromKho && !preset && (
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
        {to && control?.canConfirm && (fromKho || !toKho) && (
          <Form.Item name="confirm" valuePropName="checked" style={{ margin: 0 }}>
            <Checkbox>Tôi là thủ kho {control.name}, xác nhận xuất luôn</Checkbox>
          </Form.Item>
        )}
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
<p class="muted" style="margin-top:48px">Người lập: ${esc(b.createdBy)}${b.outBy ? ` · Thủ kho xác nhận xuất: ${esc(b.outBy)}` : ''}${b.inBy ? ` · Thủ kho xác nhận nhận: ${esc(b.inBy)}` : ''}</p>
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}
