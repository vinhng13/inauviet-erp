import { EditOutlined, InboxOutlined, LockOutlined, MinusCircleOutlined, PlusOutlined, UnlockOutlined } from '@ant-design/icons';
import { Alert, App, AutoComplete, Button, DatePicker, Descriptions, Flex, Form, Input, InputNumber, List, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography, Upload } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import type { Schemas } from '../../api/client';
import { useLocations, useMonthLocks, usePartners, useSymbols, useWarehouseMutations, useWhMaterials } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDateTime } from '../../lib/format';
import { cm, PageHead, PARTNER_KIND, qty, STATUS, type DieStatus } from './common';

/** Danh mục riêng của kho: vật tư và khổ, đối tác, vị trí kệ, ký hiệu khuôn, chốt tháng, nhập bảng khuôn Excel */
export function WarehouseCatalogPage() {
  const can = useCan();
  return (
    <Flex vertical gap={16}>
      <PageHead title="Danh mục kho" />
      <Tabs
        items={[
          { key: 'materials', label: 'Vật tư & khổ', children: <Materials /> },
          { key: 'partners', label: 'Đối tác', children: <Partners /> },
          { key: 'locations', label: 'Vị trí kệ', children: <Locations /> },
          { key: 'symbols', label: 'Ký hiệu khuôn', children: <Symbols /> },
          { key: 'locks', label: 'Chốt tồn tháng', children: <MonthLocks /> },
          ...(can('warehouse.manage') ? [{ key: 'import', label: 'Nhập bảng khuôn Excel', children: <ImportDies /> }] : []),
        ]}
      />
    </Flex>
  );
}

const ok = (message: { success: (s: string) => void }, close: () => void) => () => (message.success('Đã lưu'), close());

type Material = Schemas['WhMaterialDto'];
type MaterialForm = { group: string; name: string; unit: string; hasSizes: boolean; isActive: boolean; minQty?: number | null; sizes: Array<{ id?: string; widthCm?: number; lengthCm?: number; minQty?: number | null; isActive?: boolean }> };

function Materials() {
  const can = useCan();
  const { data, isFetching } = useWhMaterials();
  const [editing, setEditing] = useState<Material | 'new' | null>(null);
  return (
    <Flex vertical gap={12}>
      {can('warehouse.manage') && <Button type="primary" icon={<PlusOutlined />} style={{ alignSelf: 'flex-start' }} onClick={() => setEditing('new')}>Thêm vật tư</Button>}
      <Table<Material>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        locale={{ emptyText: 'Chưa có vật tư. Ví dụ: nhóm Giấy, "Giấy ngoại IC 145", đơn vị tờ, các khổ 18 x 50,5 và 27 x 23.' }}
        columns={[
          { title: 'Nhóm', dataIndex: 'group', width: 120 },
          { title: 'Vật tư', dataIndex: 'name', render: (v: string, m) => <span style={{ opacity: m.isActive ? 1 : 0.5 }}>{v}{!m.isActive && ' (ngừng dùng)'}</span> },
          { title: 'ĐVT', dataIndex: 'unit', width: 70 },
          {
            title: 'Khổ (cm) · tồn',
            key: 's',
            render: (_, m) =>
              m.hasSizes ? (
                <Flex wrap gap={4}>
                  {m.items.map((i) => (
                    <Tag key={i.id} color={i.low ? 'red' : undefined} style={{ opacity: i.isActive ? 1 : 0.5 }}>{cm(i.widthCm)} x {cm(i.lengthCm)} · {qty(i.qty)}</Tag>
                  ))}
                </Flex>
              ) : (
                `Không theo khổ · tồn ${qty(m.items[0]?.qty ?? 0)}`
              ),
          },
          { key: 'e', width: 60, render: (_, m) => can('warehouse.manage') && <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(m)} aria-label={`Sửa ${m.name}`} /> },
        ]}
      />
      {editing && <MaterialModal material={editing === 'new' ? null : editing} groups={[...new Set((data ?? []).map((m) => m.group))]} onClose={() => setEditing(null)} />}
    </Flex>
  );
}

function MaterialModal({ material, groups, onClose }: { material: Material | null; groups: string[]; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<MaterialForm>();
  const { saveMaterial } = useWarehouseMutations();
  const hasSizes = Form.useWatch('hasSizes', form);
  const initial: MaterialForm = material
    ? {
        group: material.group,
        name: material.name,
        unit: material.unit,
        hasSizes: material.hasSizes,
        isActive: material.isActive,
        minQty: material.hasSizes ? null : (material.items[0]?.minQty ?? null),
        sizes: material.hasSizes ? material.items.map((i) => ({ id: i.id, widthCm: i.widthCm, lengthCm: i.lengthCm, minQty: i.minQty, isActive: i.isActive })) : [],
      }
    : { group: groups[0] ?? 'Giấy', name: '', unit: 'tờ', hasSizes: true, isActive: true, sizes: [{}] };
  const submit = (v: MaterialForm) =>
    saveMaterial.mutate(
      {
        id: material?.id,
        group: v.group,
        name: v.name,
        unit: v.unit,
        hasSizes: v.hasSizes,
        isActive: v.isActive,
        sizes: v.hasSizes
          ? v.sizes.map((s) => ({ id: s.id, widthCm: s.widthCm ?? 0, lengthCm: s.lengthCm ?? 0, minQty: s.minQty ?? null, isActive: s.isActive ?? true }))
          : [{ id: material?.hasSizes === false ? material.items[0]?.id : undefined, widthCm: 0, lengthCm: 0, minQty: v.minQty ?? null }],
      },
      { onSuccess: ok(message, onClose), onError: (e) => message.error(errorMessage(e)) },
    );
  return (
    <Modal open width={680} title={material ? `Sửa ${material.name}` : 'Thêm vật tư'} okText="Lưu" cancelText="Đóng" onCancel={onClose} onOk={() => form.submit()} confirmLoading={saveMaterial.isPending} destroyOnHidden>
      <Form<MaterialForm> form={form} layout="vertical" initialValues={initial} onFinish={submit}>
        <Flex wrap gap={12}>
          <Form.Item name="group" label="Nhóm" rules={[{ required: true }]}>
            <AutoComplete style={{ width: 150 }} options={[...new Set([...groups, 'Giấy', 'Màng', 'Mực', 'Keo', 'Phụ liệu'])].map((g) => ({ value: g }))} />
          </Form.Item>
          <Form.Item name="name" label="Tên vật tư" rules={[{ required: true }]} style={{ flex: 1, minWidth: 220 }}>
            <Input placeholder="Giấy ngoại IC 145" />
          </Form.Item>
          <Form.Item name="unit" label="Đơn vị" rules={[{ required: true }]}>
            <AutoComplete style={{ width: 90 }} options={['tờ', 'kg', 'cuộn', 'm', 'lít', 'cái'].map((u) => ({ value: u }))} />
          </Form.Item>
        </Flex>
        <Flex gap={24}>
          <Form.Item name="hasSizes" label="Theo khổ" valuePropName="checked">
            <Switch disabled={!!material} />
          </Form.Item>
          <Form.Item name="isActive" label="Đang dùng" valuePropName="checked">
            <Switch />
          </Form.Item>
          {!hasSizes && (
            <Form.Item name="minQty" label="Tồn tối thiểu">
              <InputNumber min={0} />
            </Form.Item>
          )}
        </Flex>
        {hasSizes && (
          <Form.List name="sizes">
            {(fields, { add, remove }) => (
              <Flex vertical gap={4}>
                <Typography.Text type="secondary">Mỗi khổ một dòng (rộng x dài, cm). "27x23" và "27 x 23" là một khổ. Khổ đã có phiếu thì không sửa số, chỉ tắt đi.</Typography.Text>
                {fields.map((f) => {
                  const saved = !!form.getFieldValue(['sizes', f.name, 'id']);
                  return (
                    <Flex key={f.key} gap={8} align="start">
                      <Form.Item name={[f.name, 'widthCm']} style={{ marginBottom: 8 }} rules={[{ required: true, message: 'Rộng' }]}>
                        <InputNumber min={0.1} decimalSeparator="," placeholder="Rộng" style={{ width: 100 }} />
                      </Form.Item>
                      <span style={{ lineHeight: '32px' }}>x</span>
                      <Form.Item name={[f.name, 'lengthCm']} style={{ marginBottom: 8 }} rules={[{ required: true, message: 'Dài' }]}>
                        <InputNumber min={0.1} decimalSeparator="," placeholder="Dài" style={{ width: 100 }} />
                      </Form.Item>
                      <Form.Item name={[f.name, 'minQty']} style={{ marginBottom: 8 }}>
                        <InputNumber min={0} placeholder="Tồn tối thiểu" style={{ width: 140 }} />
                      </Form.Item>
                      {saved ? (
                        <Form.Item name={[f.name, 'isActive']} valuePropName="checked" style={{ marginBottom: 8 }}>
                          <Switch checkedChildren="Dùng" unCheckedChildren="Tắt" />
                        </Form.Item>
                      ) : (
                        <Button type="text" icon={<MinusCircleOutlined />} onClick={() => remove(f.name)} aria-label="Bỏ khổ" />
                      )}
                    </Flex>
                  );
                })}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ isActive: true })} style={{ alignSelf: 'flex-start' }}>Thêm khổ</Button>
              </Flex>
            )}
          </Form.List>
        )}
      </Form>
    </Modal>
  );
}

function Partners() {
  const can = useCan();
  const { message } = App.useApp();
  const { data, isFetching } = usePartners();
  const { savePartner } = useWarehouseMutations();
  const [editing, setEditing] = useState<Schemas['PartnerDto'] | 'new' | null>(null);
  const [form] = Form.useForm<Schemas['PartnerInputDto']>();
  return (
    <Flex vertical gap={12}>
      {can('warehouse.manage') && <Button type="primary" icon={<PlusOutlined />} style={{ alignSelf: 'flex-start' }} onClick={() => setEditing('new')}>Thêm đối tác</Button>}
      <Table<Schemas['PartnerDto']>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={false}
        locale={{ emptyText: 'Chưa có đối tác (xưởng bế, nơi làm khuôn, nhà cung cấp giấy...)' }}
        columns={[
          { title: 'Tên', dataIndex: 'name', render: (v: string, p) => <span style={{ opacity: p.isActive ? 1 : 0.5 }}>{v}</span> },
          { title: 'Loại', dataIndex: 'kind', width: 150, render: (k: Schemas['WhPartnerKind']) => PARTNER_KIND[k] },
          { title: 'Điện thoại', dataIndex: 'phone', width: 130 },
          { title: 'Khuôn đang giữ', dataIndex: 'diesHeld', width: 130, align: 'right' },
          { title: 'Ghi chú', dataIndex: 'note' },
          { key: 'e', width: 60, render: (_, p) => can('warehouse.manage') && <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(p)} aria-label={`Sửa ${p.name}`} /> },
        ]}
      />
      {editing && (
        <Modal
          open
          title={editing === 'new' ? 'Thêm đối tác' : `Sửa ${editing.name}`}
          okText="Lưu"
          cancelText="Đóng"
          onCancel={() => setEditing(null)}
          onOk={() => form.submit()}
          confirmLoading={savePartner.isPending}
          destroyOnHidden
        >
          <Form
            form={form}
            layout="vertical"
            initialValues={editing === 'new' ? { kind: 'DIE_SHOP', isActive: true } : { ...editing }}
            onFinish={(v) =>
              savePartner.mutate(
                { id: editing === 'new' ? undefined : editing.id, name: v.name, kind: v.kind, phone: v.phone || null, note: v.note || null, isActive: v.isActive },
                { onSuccess: ok(message, () => setEditing(null)), onError: (e) => message.error(errorMessage(e)) },
              )
            }
          >
            <Form.Item name="name" label="Tên" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="kind" label="Loại"><Select options={Object.entries(PARTNER_KIND).map(([value, label]) => ({ value, label }))} /></Form.Item>
            <Form.Item name="phone" label="Điện thoại"><Input /></Form.Item>
            <Form.Item name="note" label="Ghi chú"><Input /></Form.Item>
            <Form.Item name="isActive" label="Đang hợp tác" valuePropName="checked"><Switch /></Form.Item>
          </Form>
        </Modal>
      )}
    </Flex>
  );
}

function Locations() {
  const can = useCan();
  const { message } = App.useApp();
  const { data, isFetching } = useLocations();
  const { saveLocation } = useWarehouseMutations();
  const [code, setCode] = useState('');
  return (
    <Flex vertical gap={12}>
      <Typography.Text type="secondary">Mã kệ nên theo dạng Tầng-Kệ-Ô, ví dụ T4-K02-O03, để thủ kho tìm khuôn nhanh.</Typography.Text>
      {can('warehouse.manage') && (
        <Space.Compact style={{ maxWidth: 360 }}>
          <Input id="location-code" placeholder="Mã vị trí mới" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button
            type="primary"
            disabled={!code.trim()}
            loading={saveLocation.isPending}
            onClick={() => saveLocation.mutate({ code: code.trim() }, { onSuccess: () => (setCode(''), message.success('Đã thêm vị trí')), onError: (e) => message.error(errorMessage(e)) })}
          >
            Thêm
          </Button>
        </Space.Compact>
      )}
      <Table<Schemas['LocationDto']>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={false}
        locale={{ emptyText: 'Chưa có vị trí' }}
        columns={[
          { title: 'Mã vị trí', dataIndex: 'code', render: (v: string, l) => <span style={{ opacity: l.isActive ? 1 : 0.5 }}>{v}</span> },
          { title: 'Số khuôn', dataIndex: 'dies', width: 110, align: 'right' },
          { title: 'Ghi chú', dataIndex: 'note' },
          {
            title: 'Đang dùng',
            key: 'a',
            width: 110,
            render: (_, l) => (
              <Switch size="small" checked={l.isActive} disabled={!can('warehouse.manage')} onChange={(isActive) => saveLocation.mutate({ id: l.id, code: l.code, note: l.note, isActive }, { onError: (e) => message.error(errorMessage(e)) })} />
            ),
          },
        ]}
      />
    </Flex>
  );
}

function Symbols() {
  const can = useCan();
  const { message } = App.useApp();
  const { data, isFetching } = useSymbols();
  const { saveSymbol } = useWarehouseMutations();
  const [form] = Form.useForm<{ code: string; name: string }>();
  return (
    <Flex vertical gap={12}>
      <Typography.Text type="secondary">Mã khuôn = ký hiệu + số thứ tự (TUI-001), cấp một lần và không đổi. Mã đã dùng không cấp lại.</Typography.Text>
      {can('warehouse.manage') && (
        <Form form={form} layout="inline" onFinish={(v) => saveSymbol.mutate({ code: v.code.toUpperCase(), name: v.name }, { onSuccess: () => (form.resetFields(), message.success('Đã lưu ký hiệu')), onError: (e) => message.error(errorMessage(e)) })}>
          <Form.Item name="code" rules={[{ required: true, pattern: /^[A-Za-z]{2,5}$/, message: '2–5 chữ cái' }]}><Input placeholder="Ký hiệu, ví dụ HOP" style={{ width: 170 }} /></Form.Item>
          <Form.Item name="name" rules={[{ required: true }]}><Input placeholder="Tên, ví dụ Hộp giấy" style={{ width: 220 }} /></Form.Item>
          <Button type="primary" htmlType="submit" loading={saveSymbol.isPending}>Thêm / sửa</Button>
        </Form>
      )}
      <Table<Schemas['SymbolDto']>
        rowKey="code"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={false}
        columns={[
          { title: 'Ký hiệu', dataIndex: 'code', width: 100 },
          { title: 'Tên', dataIndex: 'name' },
          { title: 'Số khuôn', dataIndex: 'dies', width: 100, align: 'right' },
          { title: 'Mã cấp tiếp', key: 'n', width: 130, render: (_, s) => `${s.code}-${String(s.lastNo + 1).padStart(3, '0')}` },
          {
            title: 'Đang dùng',
            key: 'a',
            width: 110,
            render: (_, s) => <Switch size="small" checked={s.isActive} disabled={!can('warehouse.manage')} onChange={(isActive) => saveSymbol.mutate({ code: s.code, name: s.name, isActive })} />,
          },
        ]}
      />
    </Flex>
  );
}

function MonthLocks() {
  const can = useCan();
  const { message } = App.useApp();
  const { data } = useMonthLocks();
  const { lockMonth, unlockMonth } = useWarehouseMutations();
  const [month, setMonth] = useState<Dayjs | null>(dayjs().subtract(1, 'month'));
  return (
    <Flex vertical gap={12} style={{ maxWidth: 640 }}>
      <Typography.Text type="secondary">Chốt tồn tháng xong thì không lập, không huỷ phiếu kho có ngày trong tháng đó nữa, để số tồn đã báo cáo không bị thay đổi. Chốt của kho độc lập với khoá sổ kế toán.</Typography.Text>
      {can('warehouse.manage') && (
        <Space>
          <DatePicker id="lock-month" picker="month" format="MM/YYYY" value={month} onChange={setMonth} allowClear={false} />
          <Button type="primary" icon={<LockOutlined />} loading={lockMonth.isPending} onClick={() => month && lockMonth.mutate(month.format('YYYY-MM'), { onSuccess: () => message.success(`Đã chốt tháng ${month.format('MM/YYYY')}`), onError: (e) => message.error(errorMessage(e)) })}>
            Chốt tồn tháng
          </Button>
        </Space>
      )}
      <List
        size="small"
        bordered
        dataSource={data}
        locale={{ emptyText: 'Chưa chốt tháng nào' }}
        renderItem={(l) => (
          <List.Item
            actions={
              can('warehouse.manage')
                ? [
                    <Popconfirm key="u" title={`Mở lại tháng ${l.month.slice(5)}/${l.month.slice(0, 4)}?`} okText="Mở lại" cancelText="Không" onConfirm={() => unlockMonth.mutate(l.month)}>
                      <Button size="small" icon={<UnlockOutlined />}>Mở lại</Button>
                    </Popconfirm>,
                  ]
                : []
            }
          >
            <strong>Tháng {l.month.slice(5)}/{l.month.slice(0, 4)}</strong>
            <Typography.Text type="secondary" style={{ marginLeft: 12 }}>{l.lockedBy}, {formatDateTime(String(l.lockedAt))}</Typography.Text>
          </List.Item>
        )}
      />
    </Flex>
  );
}

function ImportDies() {
  const { message } = App.useApp();
  const { importDies } = useWarehouseMutations();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Schemas['ImportReportDto'] | null>(null);
  const run = (dryRun: boolean) =>
    file &&
    importDies.mutate(
      { file, dryRun },
      {
        onSuccess: (r) => {
          setReport(r);
          if (!dryRun) message.success(`Đã nhập ${r.dies} khuôn`);
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  return (
    <Flex vertical gap={12} style={{ maxWidth: 900 }}>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        Chọn file Excel quản lý khuôn đang dùng (sheet DANH_SACH_KHUON; NHAP_LIEU được giữ làm lịch sử). Bấm Xem trước để kiểm tra, rồi Nhập. Chạy lại không tạo trùng: mã đã có sẽ bỏ qua.
      </Typography.Paragraph>
      <Upload.Dragger
        accept=".xlsx"
        maxCount={1}
        beforeUpload={(f) => {
          setFile(f);
          setReport(null);
          return false;
        }}
        onRemove={() => (setFile(null), setReport(null))}
      >
        <p className="ant-upload-drag-icon"><InboxOutlined /></p>
        <p>Kéo file .xlsx vào đây hoặc bấm để chọn</p>
      </Upload.Dragger>
      <Space>
        <Button disabled={!file} loading={importDies.isPending && importDies.variables?.dryRun} onClick={() => run(true)}>Xem trước</Button>
        <Popconfirm title={`Nhập ${report?.dies ?? ''} khuôn vào phần mềm?`} okText="Nhập" cancelText="Không" disabled={!report?.dryRun || !report.dies} onConfirm={() => run(false)}>
          <Button type="primary" disabled={!report?.dryRun || !report.dies} loading={importDies.isPending && importDies.variables?.dryRun === false}>Nhập</Button>
        </Popconfirm>
      </Space>
      {report && (
        <Flex vertical gap={12}>
          <Alert
            type={report.dryRun ? 'info' : 'success'}
            title={report.dryRun ? 'Xem trước — chưa ghi gì' : 'Đã nhập xong'}
            description={`${report.dies} khuôn mới${report.skippedExisting ? `, ${report.skippedExisting} mã đã có bỏ qua` : ''}; ${report.history} dòng lịch sử giao dịch.`}
          />
          <Descriptions
            size="small"
            bordered
            column={1}
            items={[
              { label: 'Theo trạng thái', children: Object.entries(report.byStatus).map(([s, n]) => `${STATUS[s as DieStatus]?.label ?? s}: ${n}`).join(' · ') || '—' },
              { label: 'Đối tác sẽ tạo', children: report.partnersCreated.join(', ') || '—' },
              { label: 'Vị trí sẽ tạo', children: report.locationsCreated.join(', ') || '—' },
            ]}
          />
          <Table<Schemas['ImportIssueDto']>
            rowKey={(r) => `${r.row}-${r.message}`}
            size="small"
            dataSource={report.issues}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            title={() => `${report.issues.length} điểm cần xem (khuôn cần xác nhận sẽ hiện ở bộ lọc "Cần xác nhận" sau khi nhập)`}
            columns={[
              { title: 'Dòng', dataIndex: 'row', width: 70 },
              { title: 'Mã', dataIndex: 'code', width: 100 },
              { title: 'Nội dung', dataIndex: 'message' },
            ]}
          />
        </Flex>
      )}
    </Flex>
  );
}
