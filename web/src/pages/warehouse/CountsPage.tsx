import { CheckCircleTwoTone, CloseCircleTwoTone, PlusOutlined, ScanOutlined } from '@ant-design/icons';
import { Alert, App, Button, DatePicker, Drawer, Flex, Form, Input, InputNumber, Modal, Popconfirm, Radio, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Schemas } from '../../api/client';
import { useCount, useCounts, useDieCount, useDieCounts, useLocations, usePartners, useStockItems, useWarehouseMutations } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime } from '../../lib/format';
import { PageHead, qty, useWarehousePick, WarehousePicker } from './common';

const COUNT_STATUS: Record<Schemas['WhCountStatus'], { label: string; color: string }> = {
  DRAFT: { label: 'Đang kiểm', color: 'gold' },
  APPROVED: { label: 'Đã duyệt', color: 'green' },
  CANCELLED: { label: 'Đã huỷ', color: 'default' },
};

/** Kiểm kê vật tư (chênh lệch duyệt thành phiếu điều chỉnh) và kiểm kê khuôn theo kệ / xưởng */
export function WarehouseCountsPage() {
  return (
    <Flex vertical gap={16}>
      <PageHead title="Kiểm kê" />
      <Tabs
        items={[
          { key: 'stock', label: 'Vật tư', children: <StockCounts /> },
          { key: 'dies', label: 'Khuôn', children: <DieCounts /> },
        ]}
      />
    </Flex>
  );
}

function StockCounts() {
  const can = useCan();
  const { message } = App.useApp();
  const { warehouse, list, pick } = useWarehousePick();
  const { data, isFetching } = useCounts(warehouse?.id);
  const items = useStockItems(warehouse?.id);
  const { createCount } = useWarehouseMutations();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const groups = useMemo(() => [...new Set((items.data ?? []).map((i) => i.group))], [items.data]);
  const [form] = Form.useForm<{ date: Dayjs; groups?: string[]; note?: string }>();
  return (
    <Flex vertical gap={12}>
      <WarehousePicker value={warehouse} list={list} onChange={pick} />
      <Flex justify="space-between" wrap gap={8}>
        <Typography.Text type="secondary">
          Phần mềm ghi sẵn tồn theo sổ của kho đang chọn; nhập số đếm thực tế. Thủ kho của kho (hoặc người quản lý kho) duyệt thì chênh lệch thành phiếu điều chỉnh (DC-). Lần đầu dùng kho, kiểm kê để nhập tồn đầu.
        </Typography.Text>
        {can('warehouse.count') && warehouse && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>Phiếu kiểm kê mới</Button>}
      </Flex>
      <Table<Schemas['CountDto']>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: 'Chưa có phiếu kiểm kê' }}
        onRow={(r) => ({ onClick: () => setOpen(r.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Ngày', dataIndex: 'date', width: 110, render: formatDate },
          { title: 'Số', dataIndex: 'code', width: 130 },
          { title: 'Trạng thái', dataIndex: 'status', width: 120, render: (s: Schemas['WhCountStatus']) => <Tag color={COUNT_STATUS[s].color}>{COUNT_STATUS[s].label}</Tag> },
          { title: 'Đã đếm', key: 'c', width: 110, render: (_, r) => `${r.counted} / ${r.total}` },
          { title: 'Phiếu điều chỉnh', dataIndex: 'adjustSlipCode', width: 150 },
          { title: 'Ghi chú', dataIndex: 'note' },
          { title: 'Người lập', dataIndex: 'createdBy', width: 130 },
        ]}
      />
      <Modal
        open={creating}
        title={`Phiếu kiểm kê vật tư · ${warehouse?.name ?? ''}`}
        okText="Lập phiếu"
        cancelText="Đóng"
        onCancel={() => setCreating(false)}
        onOk={() => form.submit()}
        confirmLoading={createCount.isPending}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{ date: dayjs() }}
          onFinish={(v) =>
            createCount.mutate(
              { warehouseId: warehouse!.id, date: v.date.format('YYYY-MM-DD'), groups: v.groups?.length ? v.groups : undefined, note: v.note || null },
              {
                onSuccess: (c) => {
                  setCreating(false);
                  setOpen(c.id);
                },
                onError: (e) => message.error(errorMessage(e)),
              },
            )
          }
        >
          <Form.Item name="date" label="Ngày kiểm" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="groups" label="Nhóm vật tư" extra="Bỏ trống để kiểm tất cả">
            <Select mode="multiple" allowClear options={groups.map((g) => ({ value: g, label: g }))} />
          </Form.Item>
          <Form.Item name="note" label="Ghi chú">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
      {open && <CountDrawer id={open} onClose={() => setOpen(null)} />}
    </Flex>
  );
}

function CountDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const can = useCan();
  const { message } = App.useApp();
  const { data: c, isLoading } = useCount(id);
  const { updateCount, approveCount, cancelCount } = useWarehouseMutations();
  const [entries, setEntries] = useState<Record<string, number | null>>({});
  const [onlyDiff, setOnlyDiff] = useState(false);
  useEffect(() => setEntries({}), [id]);
  const draft = c?.status === 'DRAFT';
  const editable = draft && can('warehouse.count');
  const value = (l: Schemas['CountLineDto']) => (l.specId in entries ? entries[l.specId] : l.countedQty);
  const dirty = Object.keys(entries).length > 0;
  const save = () =>
    updateCount.mutateAsync({ id, entries: Object.entries(entries).map(([specId, countedQty]) => ({ specId, countedQty })) }).then(
      () => (setEntries({}), message.success('Đã lưu số đếm')),
      (e) => message.error(errorMessage(e)),
    );
  const lines = (c?.lines ?? []).filter((l) => !onlyDiff || (value(l) !== null && value(l) !== l.systemQty));
  return (
    <Drawer
      open
      size={820}
      onClose={onClose}
      loading={isLoading}
      title={c ? `${c.code} · ${formatDate(c.date)}` : 'Kiểm kê'}
      extra={
        c && (
          <Space>
            {editable && <Button onClick={save} disabled={!dirty} loading={updateCount.isPending}>Lưu số đếm</Button>}
            {c.canApprove && (
              <Popconfirm
                title="Duyệt kiểm kê?"
                description="Chênh lệch sẽ thành phiếu điều chỉnh; dòng chưa đếm giữ nguyên tồn."
                okText="Duyệt"
                cancelText="Không"
                onConfirm={async () => {
                  if (dirty) await save();
                  approveCount.mutate(id, { onSuccess: (r) => message.success(`Đã duyệt${r.adjustSlipCode ? `, phiếu ${r.adjustSlipCode}` : ', không có chênh lệch'}`), onError: (e) => message.error(errorMessage(e)) });
                }}
              >
                <Button type="primary" loading={approveCount.isPending}>Duyệt</Button>
              </Popconfirm>
            )}
            {editable && (
              <Popconfirm title="Huỷ phiếu kiểm kê này?" okText="Huỷ phiếu" cancelText="Không" onConfirm={() => cancelCount.mutate(id, { onSuccess: onClose, onError: (e) => message.error(errorMessage(e)) })}>
                <Button danger>Huỷ phiếu</Button>
              </Popconfirm>
            )}
          </Space>
        )
      }
    >
      {c && (
        <Flex vertical gap={12}>
          <Flex gap={12} align="center">
            <Tag color={COUNT_STATUS[c.status].color}>{COUNT_STATUS[c.status].label}</Tag>
            <span>Đã đếm {c.counted} / {c.total}</span>
            <Switch size="small" checked={onlyDiff} onChange={setOnlyDiff} /> <span>Chỉ dòng lệch</span>
          </Flex>
          <Table<Schemas['CountLineDto']>
            rowKey="specId"
            size="small"
            dataSource={lines}
            pagination={false}
            columns={[
              { title: 'Nhóm', dataIndex: 'group', width: 100 },
              { title: 'Vật tư / khổ', dataIndex: 'label' },
              { title: 'Theo sổ', dataIndex: 'systemQty', width: 100, align: 'right', render: qty },
              {
                title: 'Đếm thực tế',
                key: 'c',
                width: 150,
                render: (_, l) =>
                  editable ? (
                    <InputNumber
                      id={`count-${l.specId}`}
                      aria-label={`Số đếm ${l.label}`}
                      min={0}
                      value={value(l)}
                      onChange={(v) => setEntries({ ...entries, [l.specId]: v })}
                      style={{ width: '100%' }}
                      suffix={l.unit}
                    />
                  ) : value(l) === null ? (
                    <Typography.Text type="secondary">chưa đếm</Typography.Text>
                  ) : (
                    qty(value(l)!)
                  ),
              },
              {
                title: 'Chênh lệch',
                key: 'd',
                width: 110,
                align: 'right',
                render: (_, l) => {
                  const v = value(l);
                  if (v === null) return '';
                  const d = Math.round((v - l.systemQty) * 1000) / 1000;
                  return d ? <Typography.Text type={d < 0 ? 'danger' : 'success'}>{d > 0 ? '+' : ''}{qty(d)}</Typography.Text> : '0';
                },
              },
            ]}
          />
        </Flex>
      )}
    </Drawer>
  );
}

function DieCounts() {
  const can = useCan();
  const { message } = App.useApp();
  const { data, isFetching } = useDieCounts();
  const locations = useLocations();
  const partners = usePartners();
  const { createDieCount } = useWarehouseMutations();
  const [open, setOpen] = useState<string | null>(null);
  const [scope, setScope] = useState<'home' | 'location' | 'partner'>('location');
  const [target, setTarget] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" wrap gap={8}>
        <Typography.Text type="secondary">Chọn một kệ (hoặc một xưởng), đánh dấu / quét mã từng khuôn thấy được. Khuôn không thấy sẽ được đánh dấu cần xác nhận.</Typography.Text>
        {can('warehouse.count') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>Kiểm kê khuôn</Button>}
      </Flex>
      <Table<Schemas['DieCountDto']>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        locale={{ emptyText: 'Chưa kiểm kê khuôn lần nào' }}
        onRow={(r) => ({ onClick: () => setOpen(r.id), style: { cursor: 'pointer' } })}
        columns={[
          { title: 'Bắt đầu', dataIndex: 'createdAt', width: 160, render: formatDateTime },
          { title: 'Phạm vi', dataIndex: 'scope' },
          { title: 'Thấy / tổng', key: 'n', width: 120, render: (_, r) => `${r.lines.filter((l) => l.found).length} / ${r.lines.filter((l) => !l.extra).length}` },
          { title: 'Trạng thái', key: 's', width: 140, render: (_, r) => (r.finishedAt ? <Tag color="green">Xong {formatDate(String(r.finishedAt).slice(0, 10))}</Tag> : <Tag color="gold">Đang kiểm</Tag>) },
          { title: 'Người kiểm', dataIndex: 'createdBy', width: 130 },
        ]}
      />
      <Modal
        open={creating}
        title="Kiểm kê khuôn"
        okText="Bắt đầu"
        cancelText="Đóng"
        onCancel={() => setCreating(false)}
        okButtonProps={{ disabled: scope !== 'home' && !target }}
        confirmLoading={createDieCount.isPending}
        onOk={() =>
          createDieCount.mutate(scope === 'partner' ? { holderId: target } : scope === 'location' ? { locationId: target } : {}, {
            onSuccess: (c) => {
              setCreating(false);
              setOpen(c.id);
            },
            onError: (e) => message.error(errorMessage(e)),
          })
        }
      >
        <Flex vertical gap={12}>
          <Radio.Group value={scope} onChange={(e) => (setScope(e.target.value), setTarget(undefined))}>
            <Radio value="location">Một kệ</Radio>
            <Radio value="home">Toàn kho Âu Việt</Radio>
            <Radio value="partner">Khuôn ở một xưởng</Radio>
          </Radio.Group>
          {scope === 'location' && (
            <Select id="count-location" placeholder="Chọn kệ" value={target} onChange={setTarget} options={(locations.data ?? []).map((l) => ({ value: l.id, label: `${l.code} (${l.dies} khuôn)` }))} />
          )}
          {scope === 'partner' && (
            <Select id="count-partner" placeholder="Chọn xưởng" value={target} onChange={setTarget} options={(partners.data ?? []).filter((p) => p.diesHeld > 0).map((p) => ({ value: p.id, label: `${p.name} (${p.diesHeld} khuôn)` }))} />
          )}
        </Flex>
      </Modal>
      {open && <DieCountDrawer id={open} onClose={() => setOpen(null)} />}
    </Flex>
  );
}

function DieCountDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const can = useCan();
  const { message } = App.useApp();
  const { data: c, isLoading } = useDieCount(id);
  const { markDieCount, finishDieCount } = useWarehouseMutations();
  const [code, setCode] = useState('');
  const scan = useRef<HTMLInputElement>(null);
  const editable = !!c && !c.finishedAt && can('warehouse.count');
  const mark = (die: string, found: boolean) =>
    markDieCount.mutate({ id, die, found }, { onSuccess: () => setCode(''), onError: (e) => message.error(errorMessage(e)) });
  const seen = c?.lines.filter((l) => l.found).length ?? 0;
  const missing = c?.lines.filter((l) => !l.found && !l.extra) ?? [];
  return (
    <Drawer
      open
      size={760}
      onClose={onClose}
      loading={isLoading}
      title={c ? `Kiểm kê khuôn · ${c.scope}` : 'Kiểm kê khuôn'}
      extra={
        editable && (
          <Popconfirm
            title="Kết thúc kiểm kê?"
            description={`${missing.length} khuôn không thấy sẽ được đánh dấu cần xác nhận.`}
            okText="Kết thúc"
            cancelText="Chưa"
            onConfirm={() => finishDieCount.mutate(id, { onSuccess: () => message.success('Đã kết thúc kiểm kê'), onError: (e) => message.error(errorMessage(e)) })}
          >
            <Button type="primary" loading={finishDieCount.isPending}>Kết thúc</Button>
          </Popconfirm>
        )
      }
    >
      {c && (
        <Flex vertical gap={12}>
          <Typography.Text>
            Thấy <strong>{seen}</strong> / {c.lines.filter((l) => !l.extra).length} khuôn theo sổ
            {c.lines.some((l) => l.extra) && <> · {c.lines.filter((l) => l.extra).length} khuôn lạ (sổ ghi ở nơi khác)</>}
          </Typography.Text>
          {c.finishedAt && missing.length > 0 && <Alert type="warning" title={`Không thấy ${missing.length} khuôn: ${missing.map((l) => l.code).join(', ')}`} />}
          {editable && (
            <Space.Compact style={{ maxWidth: 420 }}>
              <Input
                id="die-scan"
                ref={(el) => {
                  scan.current = el?.input ?? null;
                }}
                autoFocus
                prefix={<ScanOutlined />}
                placeholder="Gõ hoặc quét mã khuôn, Enter"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onPressEnter={() => code.trim() && mark(code.trim(), true)}
              />
              <Button type="primary" onClick={() => code.trim() && mark(code.trim(), true)} loading={markDieCount.isPending}>Thấy</Button>
            </Space.Compact>
          )}
          <Table
            rowKey="dieId"
            size="small"
            pagination={false}
            dataSource={c.lines}
            columns={[
              { title: '', key: 'f', width: 40, render: (_, l) => (l.found ? <CheckCircleTwoTone twoToneColor="#52c41a" /> : <CloseCircleTwoTone twoToneColor={c.finishedAt ? '#cf1322' : '#bbb'} />) },
              { title: 'Mã', dataIndex: 'code', width: 100 },
              { title: 'Khuôn', dataIndex: 'productName' },
              { title: 'Sổ ghi ở', dataIndex: 'place', width: 170, render: (v: string, l) => (l.extra ? <Tag color="orange">{v}</Tag> : v) },
              {
                key: 'a',
                width: 110,
                render: (_, l) =>
                  editable && (
                    <Button size="small" onClick={() => mark(l.dieId, !l.found)}>
                      {l.found ? 'Bỏ đánh dấu' : 'Thấy'}
                    </Button>
                  ),
              },
            ]}
          />
        </Flex>
      )}
    </Drawer>
  );
}
