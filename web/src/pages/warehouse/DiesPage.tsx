import { CameraOutlined, CheckOutlined, DeploymentUnitOutlined, DownloadOutlined, EditOutlined, PlusOutlined, WarningOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  Button,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Flex,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ApiError, type Schemas } from '../../api/client';
import { diePhotoUrl, useDie, useDies, useLocations, usePartners, useSymbols, useWarehouseMutations, type Die, type DieQuery, type DieRow } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatDateTime, formatVnd, vndInputProps } from '../../lib/format';
import { BatchModal } from './BatchesPage';
import { ACTION, ACTION_NEEDS, DieStatusTag, downloadCsv, KIND, ORIENT, OWNER, PageHead, STATUS, type DieAction, type DieStatus } from './common';

const FLAG_LABEL = { overdue: 'Quá hẹn chưa về', review: 'Cần xác nhận', out: 'Đang ở xưởng ngoài' } as const;

/** Danh mục khuôn: tìm theo mã, tên, khách, kích thước; mở hồ sơ để luân chuyển */
export function WarehouseDiesPage() {
  const can = useCan();
  const [params, setParams] = useSearchParams();
  const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
  const query: DieQuery = {
    q: params.get('q') ?? undefined,
    status: (params.get('status') as DieStatus) ?? undefined,
    symbol: params.get('symbol') ?? undefined,
    place: params.get('place') ?? undefined,
    flag: (params.get('flag') as keyof typeof FLAG_LABEL) ?? undefined,
    l: num('l'),
    w: num('w'),
    h: num('h'),
    tol: num('tol'),
  };
  const set = (patch: Record<string, string | number | null | undefined>) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === '') next.delete(k);
        else next.set(k, String(v));
      }
      return next;
    });
  const { data, isFetching } = useDies(query);
  const symbols = useSymbols();
  const partners = usePartners();
  const [editing, setEditing] = useState<Die | 'new' | null>(null);
  const [selected, setSelected] = useState<DieRow[]>([]);
  const [batch, setBatch] = useState<'OUT' | 'IN' | null>(null);
  const openId = params.get('open') ?? undefined;
  const sizeSearch = query.l !== undefined || query.w !== undefined || query.h !== undefined;

  return (
    <Flex vertical gap={12}>
      <PageHead
        title="Khuôn"
        extra={
          <Space wrap>
            {can('warehouse.dies') && selected.length > 0 && (
              <>
                <Button icon={<DeploymentUnitOutlined />} onClick={() => setBatch('OUT')}>Xuất {selected.length} khuôn</Button>
                <Button onClick={() => setBatch('IN')}>Nhận về {selected.length} khuôn</Button>
              </>
            )}
            {can('warehouse.dies') && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>Khuôn mới</Button>
            )}
          </Space>
        }
      />
      <Flex wrap gap={8} align="center">
        <Input.Search
          id="dies-search"
          key={query.q ?? ''}
          defaultValue={query.q}
          placeholder="Mã, tên khuôn, khách, ghi chú"
          allowClear
          onSearch={(v) => set({ q: v.trim(), open: null })}
          style={{ width: 280 }}
        />
        <Select
          id="dies-symbol"
          allowClear
          placeholder="Ký hiệu"
          style={{ width: 150 }}
          value={query.symbol}
          onChange={(v) => set({ symbol: v })}
          options={(symbols.data ?? []).map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))}
        />
        <Select
          id="dies-status"
          allowClear
          placeholder="Trạng thái"
          style={{ width: 150 }}
          value={query.status}
          onChange={(v) => set({ status: v })}
          options={(Object.keys(STATUS) as DieStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))}
        />
        <Select
          id="dies-place"
          allowClear
          placeholder="Ở đâu"
          style={{ width: 170 }}
          value={query.place}
          onChange={(v) => set({ place: v })}
          options={[{ value: 'home', label: 'Kho Âu Việt' }, ...(partners.data ?? []).filter((p) => p.diesHeld > 0 || p.kind === 'DIE_SHOP').map((p) => ({ value: p.id, label: p.name }))]}
        />
        <Select
          id="dies-flag"
          allowClear
          placeholder="Cần chú ý"
          style={{ width: 170 }}
          value={query.flag}
          onChange={(v) => set({ flag: v })}
          options={(Object.keys(FLAG_LABEL) as Array<keyof typeof FLAG_LABEL>).map((f) => ({ value: f, label: FLAG_LABEL[f] }))}
        />
      </Flex>
      <Flex wrap gap={8} align="center">
        <Typography.Text type="secondary">Tìm khuôn dùng lại theo kích thước (cm):</Typography.Text>
        <SizeSearch query={query} onSearch={(v) => set(v)} />
        {sizeSearch && <Button size="small" onClick={() => set({ l: null, w: null, h: null, tol: null })}>Bỏ tìm kích thước</Button>}
        <Button
          size="small"
          icon={<DownloadOutlined />}
          onClick={() =>
            downloadCsv(
              `khuon-${dayjs().format('YYYY-MM-DD')}.csv`,
              ['Mã', 'Tên khuôn', 'Khách', 'Kích thước', 'Dọc/ngang', 'Số mảnh', 'Trạng thái', 'Ở đâu', 'Hẹn về', 'Cần xác nhận'],
              (data?.items ?? []).map((d) => [d.code, d.productName, d.customerName, d.size, d.orientation ? ORIENT[d.orientation] : '', d.pieces, STATUS[d.status].label, d.place, d.expectedBackOn, d.reviewNote]),
            )
          }
        >
          Xuất CSV
        </Button>
      </Flex>
      <Table<DieRow>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data?.items}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true, showTotal: (n) => `${n} khuôn` }}
        rowSelection={can('warehouse.dies') ? { selectedRowKeys: selected.map((d) => d.id), onChange: (_, rows) => setSelected(rows) } : undefined}
        onRow={(r) => ({ onClick: () => set({ open: r.id }), style: { cursor: 'pointer' } })}
        locale={{ emptyText: sizeSearch ? 'Không có khuôn nào gần kích thước này — cần làm khuôn mới.' : 'Không có khuôn' }}
        scroll={{ x: 1000 }}
        columns={[
          { title: 'Mã', dataIndex: 'code', width: 95, fixed: 'left', render: (v: string) => <strong>{v}</strong> },
          {
            title: 'Tên khuôn',
            dataIndex: 'productName',
            render: (v: string, r) => (
              <span>
                {v}
                {r.customerName && <Typography.Text type="secondary"> · {r.customerName}</Typography.Text>}
                {r.needsReview && (
                  <Tooltip title={r.reviewNote}>
                    <Tag color="orange" style={{ marginLeft: 6 }}>Cần xác nhận</Tag>
                  </Tooltip>
                )}
              </span>
            ),
          },
          { title: 'Kích thước', dataIndex: 'size', width: 130, render: (v: string | null, r) => (v ? `${v}${r.orientation ? ` · ${ORIENT[r.orientation]}` : ''}` : '') },
          { title: 'Mảnh', dataIndex: 'pieces', width: 60, align: 'right' },
          { title: 'Trạng thái', dataIndex: 'status', width: 110, render: (s: DieStatus) => <DieStatusTag status={s} /> },
          { title: 'Ở đâu', dataIndex: 'place', width: 170 },
          {
            title: 'Hẹn về',
            dataIndex: 'expectedBackOn',
            width: 110,
            render: (v: string | null, r) => (v ? <Typography.Text type={r.overdue ? 'danger' : undefined}>{r.overdue && <WarningOutlined />} {formatDate(v)}</Typography.Text> : ''),
          },
        ]}
      />
      {openId && <DieDrawer id={openId} onClose={() => set({ open: null })} onEdit={setEditing} />}
      {editing && <DieFormModal die={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onCreated={(d) => set({ open: d.id })} />}
      {batch && (
        <BatchModal
          kind={batch}
          dies={selected}
          onClose={(ok) => {
            setBatch(null);
            if (ok) setSelected([]);
          }}
        />
      )}
    </Flex>
  );
}

function SizeSearch({ query, onSearch }: { query: DieQuery; onSearch: (v: { l?: number | null; w?: number | null; h?: number | null; tol?: number | null; open: null }) => void }) {
  const [v, setV] = useState({ l: query?.l ?? null, w: query?.w ?? null, h: query?.h ?? null, tol: query?.tol ?? 0.5 });
  return (
    <Space.Compact>
      <InputNumber id="size-l" placeholder="Dài" min={0} value={v.l} onChange={(l) => setV({ ...v, l })} style={{ width: 80 }} decimalSeparator="," />
      <InputNumber id="size-w" placeholder="Rộng" min={0} value={v.w} onChange={(w) => setV({ ...v, w })} style={{ width: 80 }} decimalSeparator="," />
      <InputNumber id="size-h" placeholder="Cao" min={0} value={v.h} onChange={(h) => setV({ ...v, h })} style={{ width: 80 }} decimalSeparator="," />
      <InputNumber id="size-tol" min={0} max={5} step={0.5} value={v.tol} onChange={(tol) => setV({ ...v, tol: tol ?? 0.5 })} style={{ width: 90 }} prefix="±" decimalSeparator="," />
      <Button type="primary" onClick={() => onSearch({ ...v, open: null })} disabled={v.l === null && v.w === null && v.h === null}>Tìm</Button>
    </Space.Compact>
  );
}

function DieDrawer({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (d: Die) => void }) {
  const can = useCan();
  const { message } = App.useApp();
  const { data: d, isLoading, dataUpdatedAt } = useDie(id);
  const { updateDie, diePhoto } = useWarehouseMutations();
  const [action, setAction] = useState<DieAction | null>(null);
  const confirmReview = () =>
    d &&
    updateDie.mutate(
      { id: d.id, ...dieInput(d), reviewed: true },
      { onSuccess: () => message.success('Đã xác nhận thông tin khuôn'), onError: (e) => message.error(errorMessage(e)) },
    );
  return (
    <Drawer open size={760} onClose={onClose} loading={isLoading} title={d ? `${d.code} · ${d.productName}` : 'Khuôn'}
      extra={d && can('warehouse.dies') && <Button icon={<EditOutlined />} onClick={() => onEdit(d)}>Sửa thông tin</Button>}
    >
      {d && (
        <Flex vertical gap={16}>
          {d.needsReview && (
            <Alert
              type="warning"
              showIcon
              title="Cần xác nhận"
              description={d.reviewNote}
              action={can('warehouse.dies') && <Button size="small" icon={<CheckOutlined />} loading={updateDie.isPending} onClick={confirmReview}>Đã kiểm, đúng</Button>}
            />
          )}
          <Flex gap={16} wrap>
            <Descriptions size="small" column={2} style={{ flex: 1, minWidth: 380 }} bordered
              items={[
                { label: 'Trạng thái', children: <DieStatusTag status={d.status} /> },
                { label: 'Ở đâu', children: d.place },
                { label: 'Kích thước', children: [d.size, d.sizeText && d.size !== d.sizeText ? `(${d.sizeText})` : null].filter(Boolean).join(' ') || '—' },
                { label: 'Dọc / ngang', children: d.orientation ? ORIENT[d.orientation] : '—' },
                { label: 'Số mảnh', children: d.pieces ?? '—' },
                { label: 'SP / khuôn', children: d.ups ?? '—' },
                { label: 'Loại', children: KIND[d.kind] },
                { label: 'Khách', children: d.customerName ?? '—' },
                { label: 'Nơi làm khuôn', children: d.makerName ?? '—' },
                { label: 'Sở hữu', children: OWNER[d.owner] },
                ...(d.expectedBackOn ? [{ label: 'Hẹn về', children: <Typography.Text type={d.overdue ? 'danger' : undefined}>{formatDate(d.expectedBackOn)}</Typography.Text> }] : []),
                ...(d.costVnd !== undefined && d.costVnd !== null ? [{ label: 'Giá làm khuôn', children: formatVnd(d.costVnd) }] : []),
                ...(d.note ? [{ label: 'Ghi chú', span: 2, children: d.note }] : []),
              ]}
            />
            <Flex vertical gap={8} align="center" style={{ width: 180 }}>
              {d.hasPhoto ? <Image width={180} src={diePhotoUrl(d.id, dataUpdatedAt)} alt={`Ảnh khuôn ${d.code}`} /> : <Typography.Text type="secondary">Chưa có ảnh</Typography.Text>}
              {can('warehouse.dies') && (
                <Upload
                  accept="image/*"
                  showUploadList={false}
                  beforeUpload={(file) => {
                    diePhoto.mutate({ id: d.id, file }, { onSuccess: () => message.success('Đã lưu ảnh'), onError: (e) => message.error(errorMessage(e)) });
                    return false;
                  }}
                >
                  <Button size="small" icon={<CameraOutlined />} loading={diePhoto.isPending}>{d.hasPhoto ? 'Đổi ảnh' : 'Thêm ảnh'}</Button>
                </Upload>
              )}
            </Flex>
          </Flex>
          {can('warehouse.dies') && d.allowedActions.length > 0 && (
            <Flex wrap gap={8}>
              {(d.allowedActions as DieAction[]).map((a) => (
                <Tooltip key={a} title={ACTION[a].hint}>
                  <Button type={a === primaryAction(d.status) ? 'primary' : 'default'} danger={a === 'DEFECT' || a === 'DISPOSE'} onClick={() => setAction(a)}>
                    {ACTION[a].label}
                  </Button>
                </Tooltip>
              ))}
            </Flex>
          )}
          {d.similar.length > 0 && (
            <Alert
              type="info"
              title={`Khuôn gần giống kích thước: ${d.similar.map((s) => `${s.code} (${s.size}, ${STATUS[s.status].label})`).join('; ')}`}
            />
          )}
          <div>
            <Typography.Title level={5}>Lịch sử</Typography.Title>
            <Timeline
              items={d.moves.map((m) => ({
                color: m.action === 'DEFECT' ? 'red' : m.action === 'ISSUE' ? 'blue' : m.action === 'IMPORT' || m.action === 'EDIT' ? 'gray' : 'green',
                children: (
                  <div>
                    <strong>{formatDate(m.date)}</strong> · {m.actionLabel}
                    {m.toStatus && m.action !== 'EDIT' && <> → <DieStatusTag status={m.toStatus} /></>}
                    {m.place && <> · {m.place}</>}
                    {m.batchCode && <Tag style={{ marginLeft: 6 }}>{m.batchCode}</Tag>}
                    <div style={{ fontSize: 12, opacity: 0.75 }}>
                      {[m.reference && `Lệnh: ${m.reference}`, m.expectedBackOn && `hẹn về ${formatDate(m.expectedBackOn)}`, m.note, m.user && `${m.user}, ${formatDateTime(m.createdAt)}`].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                ),
              }))}
            />
          </div>
        </Flex>
      )}
      {d && action && <ActionModal die={d} action={action} onClose={() => setAction(null)} />}
    </Drawer>
  );
}

const primaryAction = (s: DieStatus): DieAction | null => ({ READY: 'ISSUE', IN_USE: 'RETURN', CHECKING: 'PASS', REPAIRING: 'BACK_REPAIR', DEFECT: 'SEND_REPAIR' } as Partial<Record<DieStatus, DieAction>>)[s] ?? null;

type ActionForm = { date: Dayjs; partnerId?: string; locationId?: string; expectedBackOn?: Dayjs; reference?: string; note?: string; broken?: boolean };

function ActionModal({ die, action, onClose }: { die: Die; action: DieAction; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<ActionForm>();
  const partners = usePartners();
  const locations = useLocations();
  const { dieAction } = useWarehouseMutations();
  const needs = ACTION_NEEDS[action];
  const submit = (v: ActionForm) =>
    dieAction.mutate(
      {
        id: die.id,
        action,
        date: v.date.format('YYYY-MM-DD'),
        partnerId: v.partnerId ?? null,
        locationId: v.locationId ?? null,
        expectedBackOn: v.expectedBackOn?.format('YYYY-MM-DD') ?? null,
        reference: v.reference || null,
        note: v.note || null,
        broken: v.broken,
      },
      { onSuccess: () => (message.success(`${ACTION[action].label}: ${die.code}`), onClose()), onError: (e) => message.error(errorMessage(e)) },
    );
  const partnerOptions = (partners.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name }));
  return (
    <Modal open title={`${ACTION[action].label} · ${die.code}`} okText="Ghi nhận" cancelText="Đóng" onCancel={onClose} onOk={() => form.submit()} confirmLoading={dieAction.isPending} destroyOnHidden>
      <Typography.Paragraph type="secondary">{ACTION[action].hint}</Typography.Paragraph>
      <Form<ActionForm> form={form} layout="vertical" onFinish={submit} initialValues={{ date: dayjs(), locationId: action === 'PASS' ? (die.locationId ?? undefined) : undefined }}>
        <Form.Item name="date" label="Ngày" rules={[{ required: true }]}>
          <DatePicker format="DD/MM/YYYY" allowClear={false} />
        </Form.Item>
        {needs.partner && (
          <Form.Item
            name="partnerId"
            label={action === 'SEND_REPAIR' ? 'Gửi sửa ở đâu' : action === 'MOVE' ? 'Gửi giữ ở xưởng (bỏ trống nếu đổi kệ trong kho)' : 'Xưởng bế (bỏ trống nếu bế tại Âu Việt)'}
            rules={needs.partner === 'required' ? [{ required: true, message: 'Chọn xưởng' }] : []}
          >
            <Select allowClear showSearch optionFilterProp="label" options={partnerOptions} />
          </Form.Item>
        )}
        {needs.location && (
          <Form.Item name="locationId" label="Vị trí kệ" rules={needs.location === 'required' ? [{ required: true, message: 'Chọn kệ' }] : []}>
            <Select allowClear showSearch optionFilterProp="label" options={(locations.data ?? []).filter((l) => l.isActive).map((l) => ({ value: l.id, label: l.code }))} />
          </Form.Item>
        )}
        {needs.expected && (
          <Form.Item name="expectedBackOn" label="Hẹn ngày lấy lại">
            <DatePicker format="DD/MM/YYYY" />
          </Form.Item>
        )}
        {needs.reference && (
          <Form.Item name="reference" label="Lệnh sản xuất / đơn">
            <Input />
          </Form.Item>
        )}
        {action === 'DEFECT' && (
          <Form.Item name="broken" valuePropName="checked">
            <Checkbox>Hỏng hẳn, không sửa được</Checkbox>
          </Form.Item>
        )}
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

type DieForm = Omit<Schemas['DieInputDto'], 'force' | 'reviewed'>;

const dieInput = (d: Die): DieForm => ({
  kind: d.kind,
  productName: d.productName,
  customerName: d.customerName,
  lengthCm: d.lengthCm,
  widthCm: d.widthCm,
  heightCm: d.heightCm,
  sizeText: d.sizeText,
  orientation: d.orientation,
  pieces: d.pieces,
  ups: d.ups,
  makerId: d.makerId,
  owner: d.owner,
  costVnd: d.costVnd ?? null,
  note: d.note,
});

function DieFormModal({ die, onClose, onCreated }: { die: Die | null; onClose: () => void; onCreated: (d: Die) => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<DieForm>();
  const symbols = useSymbols();
  const partners = usePartners();
  const locations = useLocations();
  const { createDie, updateDie } = useWarehouseMutations();
  const [similar, setSimilar] = useState<DieRow[] | null>(null);
  const symbol = Form.useWatch('symbolCode', form);
  const next = symbols.data?.find((s) => s.code === symbol);
  const save = (force = false) => {
    const v = form.getFieldsValue(true) as DieForm;
    const body = { ...v, customerName: v.customerName || null, sizeText: v.sizeText || null, note: v.note || null };
    if (die) {
      updateDie.mutate({ id: die.id, ...body }, { onSuccess: () => (message.success('Đã lưu'), onClose()), onError: (e) => message.error(errorMessage(e)) });
      return;
    }
    createDie.mutate(
      { ...body, force },
      {
        onSuccess: (d) => {
          message.success(`Đã tạo khuôn ${d.code}`);
          onClose();
          onCreated(d);
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'WH_DIE_SIMILAR_EXISTS') setSimilar(e.body.details?.similar as DieRow[]);
          else message.error(errorMessage(e));
        },
      },
    );
  };
  return (
    <Modal
      open
      width={760}
      title={die ? `Sửa khuôn ${die.code}` : 'Khuôn mới'}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>Đóng</Button>
          {similar && <Button danger onClick={() => save(true)} loading={createDie.isPending}>Vẫn tạo khuôn mới</Button>}
          <Button type="primary" onClick={() => form.validateFields().then(() => save(false))} loading={createDie.isPending || updateDie.isPending}>
            {die ? 'Lưu' : 'Tạo khuôn'}
          </Button>
        </Space>
      }
      destroyOnHidden
    >
      <Form<DieForm> form={form} layout="vertical" initialValues={die ? dieInput(die) : { kind: 'CUT', owner: 'AU_VIET' }} onValuesChange={() => setSimilar(null)}>
        <Flex wrap gap={12}>
          {!die && (
            <Form.Item name="symbolCode" label="Ký hiệu" rules={[{ required: true, message: 'Chọn ký hiệu' }]} extra={next && `Mã sẽ cấp: ${next.code}-${String(next.lastNo + 1).padStart(3, '0')}`}>
              <Select showSearch optionFilterProp="label" style={{ width: 200 }} options={(symbols.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.code, label: `${s.code} · ${s.name}` }))} />
            </Form.Item>
          )}
          <Form.Item name="productName" label="Tên khuôn / sản phẩm" rules={[{ required: true, message: 'Ghi tên khuôn' }]} style={{ flex: 1, minWidth: 260 }}>
            <Input />
          </Form.Item>
          <Form.Item name="customerName" label="Khách hàng" style={{ width: 220 }}>
            <Input />
          </Form.Item>
        </Flex>
        <Flex wrap gap={12}>
          <Form.Item name="lengthCm" label="Dài (cm)"><InputNumber min={0} decimalSeparator="," style={{ width: 100 }} /></Form.Item>
          <Form.Item name="widthCm" label="Rộng (cm)"><InputNumber min={0} decimalSeparator="," style={{ width: 100 }} /></Form.Item>
          <Form.Item name="heightCm" label="Cao / hông (cm)"><InputNumber min={0} decimalSeparator="," style={{ width: 110 }} /></Form.Item>
          <Form.Item name="sizeText" label="Kích thước ghi chữ (nếu không đo được)" style={{ flex: 1, minWidth: 200 }}><Input placeholder="Ví dụ: 2 khuôn ghép, tròn 38cm" /></Form.Item>
        </Flex>
        <Flex wrap gap={12}>
          <Form.Item name="orientation" label="Dọc / ngang">
            <Select allowClear style={{ width: 110 }} options={[{ value: 'PORTRAIT', label: 'Dọc' }, { value: 'LANDSCAPE', label: 'Ngang' }]} />
          </Form.Item>
          <Form.Item name="pieces" label="Số mảnh"><InputNumber min={1} max={99} style={{ width: 90 }} /></Form.Item>
          <Form.Item name="ups" label="SP / khuôn"><InputNumber min={1} max={999} style={{ width: 90 }} /></Form.Item>
          <Form.Item name="kind" label="Loại">
            <Select style={{ width: 150 }} options={Object.entries(KIND).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="owner" label="Sở hữu">
            <Select style={{ width: 130 }} options={Object.entries(OWNER).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
        </Flex>
        <Flex wrap gap={12}>
          <Form.Item name="makerId" label="Nơi làm khuôn">
            <Select allowClear showSearch optionFilterProp="label" style={{ width: 220 }} options={(partners.data ?? []).map((p) => ({ value: p.id, label: p.name }))} />
          </Form.Item>
          <Form.Item name="costVnd" label="Giá làm khuôn">
            <InputNumber {...vndInputProps} style={{ width: 160 }} />
          </Form.Item>
          {!die && (
            <>
              <Form.Item name="locationId" label="Cất ở kệ" extra="Bỏ trống: khuôn về kho chờ kiểm">
                <Select allowClear showSearch optionFilterProp="label" style={{ width: 160 }} options={(locations.data ?? []).filter((l) => l.isActive).map((l) => ({ value: l.id, label: l.code }))} />
              </Form.Item>
              <Form.Item name="holderId" label="Hoặc giao thẳng tới xưởng">
                <Select allowClear showSearch optionFilterProp="label" style={{ width: 200 }} options={(partners.data ?? []).filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name }))} />
              </Form.Item>
            </>
          )}
        </Flex>
        <Form.Item name="note" label="Ghi chú"><Input.TextArea rows={2} /></Form.Item>
      </Form>
      {similar && (
        <Alert
          type="warning"
          showIcon
          title="Đã có khuôn cùng ký hiệu, kích thước gần giống — xem có dùng lại được không"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {similar.map((s) => (
                <li key={s.id}>
                  <strong>{s.code}</strong> {s.productName} · {s.size} · {STATUS[s.status].label} · {s.place}
                </li>
              ))}
            </ul>
          }
        />
      )}
    </Modal>
  );
}

