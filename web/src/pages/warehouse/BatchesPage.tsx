import { PlusOutlined, PrinterOutlined } from '@ant-design/icons';
import { Alert, App, Button, DatePicker, Flex, Form, Input, Modal, Select, Table, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import type { Schemas } from '../../api/client';
import { useBatches, useDies, usePartners, useWarehouseMutations, type DieRow } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate } from '../../lib/format';
import { DieStatusTag, PageHead, type DieStatus } from './common';

type Batch = Schemas['BatchDto'];
const KIND_LABEL = { OUT: 'Giao khuôn cho xưởng', IN: 'Nhận khuôn về kho' } as const;

/** Biên bản giao nhận nhiều khuôn một lần với xưởng bế */
export function WarehouseBatchesPage() {
  const can = useCan();
  const { data, isFetching } = useBatches();
  const [creating, setCreating] = useState<'OUT' | 'IN' | null>(null);
  return (
    <Flex vertical gap={16}>
      <PageHead
        title="Giao nhận khuôn"
        extra={
          can('warehouse.dies') && (
            <Flex gap={8}>
              <Button onClick={() => setCreating('IN')}>Nhận khuôn về</Button>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating('OUT')}>Giao khuôn cho xưởng</Button>
            </Flex>
          )
        }
      >
        <Typography.Text type="secondary">Mỗi lần giao / nhận nhiều khuôn lập một biên bản (GN-), in ra để hai bên ký. Có thể chọn khuôn ngay ở danh sách Khuôn.</Typography.Text>
      </PageHead>
      <Table<Batch>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={{ pageSize: 30, hideOnSinglePage: true }}
        locale={{ emptyText: 'Chưa có biên bản giao nhận' }}
        expandable={{ expandedRowRender: (b) => b.dies.map((d) => `${d.code} ${d.productName}`).join(' · ') }}
        columns={[
          { title: 'Ngày', dataIndex: 'date', width: 110, render: formatDate },
          { title: 'Số', dataIndex: 'code', width: 130 },
          { title: 'Loại', dataIndex: 'kind', width: 170, render: (k: 'OUT' | 'IN') => <Tag color={k === 'OUT' ? 'blue' : 'green'}>{KIND_LABEL[k]}</Tag> },
          { title: 'Xưởng', dataIndex: 'partnerName', width: 160 },
          { title: 'Số khuôn', key: 'n', width: 90, align: 'right', render: (_, b) => b.dies.length },
          { title: 'Lệnh', dataIndex: 'reference', width: 120 },
          { title: 'Người lập', dataIndex: 'createdBy', width: 130 },
          { key: 'p', width: 70, render: (_, b) => <Button size="small" type="link" icon={<PrinterOutlined />} onClick={() => printBatch(b)} aria-label={`In ${b.code}`} /> },
        ]}
      />
      {creating && <BatchModal kind={creating} dies={[]} onClose={() => setCreating(null)} />}
    </Flex>
  );
}

type BatchForm = { date: Dayjs; partnerId?: string; expectedBackOn?: Dayjs; reference?: string; note?: string; dieIds: string[] };

/** Giao (OUT: khuôn sẵn sàng) hoặc nhận (IN: khuôn đang ở xưởng đã chọn) nhiều khuôn, tất cả hoặc không */
export function BatchModal({ kind, dies, onClose }: { kind: 'OUT' | 'IN'; dies: DieRow[]; onClose: (ok?: boolean) => void }) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<BatchForm>();
  const partners = usePartners();
  const { createBatch } = useWarehouseMutations();
  const partnerId = Form.useWatch('partnerId', form);
  const preset = dies.length > 0;
  const firstHolder = dies.find((d) => d.holderId)?.holderId ?? undefined;
  const candidates = useDies(kind === 'OUT' ? { status: 'READY' } : { place: partnerId }, !preset && (kind === 'OUT' || !!partnerId));
  const pool = preset ? dies : (candidates.data?.items ?? []).filter((d) => (kind === 'OUT' ? true : d.status === 'IN_USE' || d.status === 'READY'));
  const wrong = preset ? dies.filter((d) => (kind === 'OUT' ? d.status !== 'READY' : !(d.status === 'IN_USE' || d.status === 'READY') || !d.holderId)) : [];
  const [selected, setSelected] = useState<string[]>(dies.map((d) => d.id));

  const submit = (v: BatchForm) =>
    createBatch.mutate(
      {
        kind,
        date: v.date.format('YYYY-MM-DD'),
        partnerId: v.partnerId!,
        dieIds: selected,
        expectedBackOn: v.expectedBackOn?.format('YYYY-MM-DD') ?? null,
        reference: v.reference || null,
        note: v.note || null,
      },
      {
        onSuccess: (b) => {
          message.success(`Đã lập ${b.code} (${b.dies.length} khuôn)`);
          onClose(true);
          modal.confirm({ title: `In biên bản ${b.code}?`, okText: 'In', cancelText: 'Để sau', onOk: () => printBatch(b) });
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  return (
    <Modal open width={820} title={KIND_LABEL[kind]} okText="Lập biên bản" cancelText="Đóng" onCancel={() => onClose()} onOk={() => form.submit()}
      okButtonProps={{ disabled: !selected.length || wrong.length > 0 }} confirmLoading={createBatch.isPending} destroyOnHidden
    >
      <Form<BatchForm> form={form} layout="vertical" onFinish={submit} initialValues={{ date: dayjs(), partnerId: kind === 'IN' ? firstHolder : undefined }}>
        <Flex wrap gap={12}>
          <Form.Item name="date" label="Ngày" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="partnerId" label="Xưởng" rules={[{ required: true, message: 'Chọn xưởng' }]} style={{ minWidth: 220 }}>
            <Select showSearch optionFilterProp="label" options={(partners.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name }))} onChange={() => !preset && setSelected([])} />
          </Form.Item>
          {kind === 'OUT' && (
            <Form.Item name="expectedBackOn" label="Hẹn ngày lấy lại">
              <DatePicker format="DD/MM/YYYY" />
            </Form.Item>
          )}
          <Form.Item name="reference" label="Lệnh sản xuất">
            <Input style={{ width: 150 }} />
          </Form.Item>
        </Flex>
        <Form.Item name="note" label="Ghi chú">
          <Input />
        </Form.Item>
      </Form>
      {wrong.length > 0 && (
        <Alert
          type="error"
          style={{ marginBottom: 12 }}
          title={kind === 'OUT' ? 'Chỉ giao được khuôn đang sẵn sàng' : 'Chỉ nhận về được khuôn đang ở xưởng'}
          description={wrong.map((d) => `${d.code} (${d.place})`).join(', ')}
        />
      )}
      {kind === 'IN' && !preset && !partnerId ? (
        <Typography.Text type="secondary">Chọn xưởng để thấy các khuôn đang ở đó.</Typography.Text>
      ) : (
        <Table<DieRow>
          rowKey="id"
          size="small"
          loading={!preset && candidates.isFetching}
          dataSource={pool}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]) }}
          columns={[
            { title: 'Mã', dataIndex: 'code', width: 95 },
            { title: 'Khuôn', dataIndex: 'productName', ellipsis: true },
            { title: 'Kích thước', dataIndex: 'size', width: 120 },
            { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (s: DieStatus) => <DieStatusTag status={s} /> },
            { title: 'Ở đâu', dataIndex: 'place', width: 150 },
          ]}
          title={() => `Đã chọn ${selected.length} khuôn`}
        />
      )}
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
<h1>BIÊN BẢN ${b.kind === 'OUT' ? 'GIAO' : 'NHẬN'} KHUÔN</h1>
<p style="text-align:center">Số: ${esc(b.code)} · Ngày ${formatDate(b.date)}</p>
<p>Xưởng: <strong>${esc(b.partnerName)}</strong>${b.reference ? ` · Lệnh sản xuất: ${esc(b.reference)}` : ''}</p>
${b.note ? `<p>Ghi chú: ${esc(b.note)}</p>` : ''}
<table><thead><tr><th>#</th><th>Mã khuôn</th><th>Tên khuôn</th><th>Kích thước</th><th>Số mảnh</th><th>Tình trạng khi ${b.kind === 'OUT' ? 'giao' : 'nhận'}</th></tr></thead><tbody>${rows}</tbody></table>
<p>Tổng: ${b.dies.length} khuôn.</p>
<div class="sign"><div><strong>Bên giao</strong><p class="muted">(ký, ghi rõ họ tên)</p></div><div><strong>Bên nhận</strong><p class="muted">(ký, ghi rõ họ tên)</p></div></div>
<p class="muted" style="margin-top:48px">Người lập: ${esc(b.createdBy)}</p>
<script>window.onload=()=>window.print()</script></body></html>`);
  w.document.close();
}

