import { EditOutlined, InboxOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Alert, App, AutoComplete, Button, Descriptions, Flex, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography, Upload } from 'antd';
import { useState } from 'react';
import type { Schemas } from '../../api/client';
import { useLocations, usePartners, useSymbols, useWarehouseMutations, useWarehouses, useWhMaterials, useWhPeople } from '../../api/warehouse';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { cm, PageHead, PARTNER_KIND, qty, STATUS, type DieStatus } from './common';
import { pager } from '../../lib/paging';

/** Danh mục riêng của kho: kho và thủ kho, vật tư (quy cách, đơn vị tính), đối tác, vị trí kệ, ký hiệu khuôn, chốt tháng, nhập bảng khuôn Excel */
export function WarehouseCatalogPage() {
  const can = useCan();
  return (
    <Flex vertical gap={16}>
      <PageHead title="Danh mục kho" />
      <Tabs
        items={[
          { key: 'warehouses', label: 'Kho', children: <Warehouses /> },
          { key: 'materials', label: 'Vật tư', children: <Materials /> },
          { key: 'partners', label: 'Đối tác', children: <Partners /> },
          { key: 'locations', label: 'Vị trí kệ', children: <Locations /> },
          { key: 'symbols', label: 'Ký hiệu khuôn', children: <Symbols /> },
          ...(can('warehouse.manage')
            ? [
                { key: 'import-paper', label: 'Nhập tồn giấy Excel', children: <ImportPaper /> },
                { key: 'import', label: 'Nhập bảng khuôn Excel', children: <ImportDies /> },
              ]
            : []),
        ]}
      />
    </Flex>
  );
}

const ok = (message: { success: (s: string) => void }, close: () => void) => () => (message.success('Đã lưu'), close());

type Material = Schemas['WhMaterialDto'];
type Warehouse = Schemas['WarehouseDto'];

function Warehouses() {
  const can = useCan();
  const { data, isFetching } = useWarehouses();
  const [editing, setEditing] = useState<Warehouse | 'new' | null>(null);
  return (
    <Flex vertical gap={12}>
      <Typography.Text type="secondary">
        Mỗi kho có thủ kho riêng. Phiếu nhập / xuất / chuyển của kho chỉ làm thay đổi tồn khi thủ kho của kho đó xác nhận. Kho chưa có thủ kho: ai có quyền lập phiếu cũng xác nhận được.
      </Typography.Text>
      {can('warehouse.manage') && <Button type="primary" icon={<PlusOutlined />} style={{ alignSelf: 'flex-start' }} onClick={() => setEditing('new')}>Thêm kho</Button>}
      <Table<Warehouse>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={data}
        pagination={false}
        columns={[
          { title: 'Mã', dataIndex: 'code', width: 100, render: (v: string) => <Tag>{v}</Tag> },
          { title: 'Tên kho', dataIndex: 'name', render: (v: string, w) => <span style={{ opacity: w.isActive ? 1 : 0.5 }}>{v}{!w.isActive && ' (ngừng dùng)'}</span> },
          { title: 'Quản lý', dataIndex: 'kind', width: 150, render: (k: Warehouse['kind']) => (k === 'DIE' ? 'Khuôn (từng cái)' : 'Vật tư (số lượng)') },
          { title: 'Thủ kho', key: 'k', render: (_, w) => w.keepers.map((k) => k.fullName).join(', ') || <Typography.Text type="secondary">chưa chỉ định</Typography.Text> },
          { title: 'Địa chỉ', dataIndex: 'address', ellipsis: true },
          { title: 'Đang quản lý', key: 'n', width: 120, align: 'right', render: (_, w) => (w.kind === 'DIE' ? `${w.dies} khuôn` : `${w.materials} vật tư`) },
          { key: 'e', width: 60, render: (_, w) => can('warehouse.manage') && <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(w)} aria-label={`Sửa ${w.name}`} /> },
        ]}
      />
      {editing && <WarehouseModal warehouse={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Flex>
  );
}

function WarehouseModal({ warehouse, onClose }: { warehouse: Warehouse | null; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<Schemas['WarehouseInputDto']>();
  const people = useWhPeople();
  const { saveWarehouse } = useWarehouseMutations();
  return (
    <Modal open title={warehouse ? `Sửa ${warehouse.name}` : 'Thêm kho'} okText="Lưu" cancelText="Đóng" onCancel={onClose} onOk={() => form.submit()} confirmLoading={saveWarehouse.isPending} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={warehouse ? { ...warehouse, keeperIds: warehouse.keepers.map((k) => k.id) } : { kind: 'STOCK', isActive: true, keeperIds: [], sortOrder: 50 }}
        onFinish={(v) =>
          saveWarehouse.mutate(
            { id: warehouse?.id, code: v.code.toUpperCase(), name: v.name, address: v.address || null, note: v.note || null, kind: warehouse ? undefined : v.kind, isActive: v.isActive, sortOrder: v.sortOrder, keeperIds: v.keeperIds ?? [] },
            { onSuccess: ok(message, onClose), onError: (e) => message.error(errorMessage(e)) },
          )
        }
      >
        <Flex gap={12}>
          <Form.Item name="code" label="Mã kho" rules={[{ required: true, pattern: /^[A-Za-z0-9]{2,10}$/, message: '2–10 chữ hoặc số' }]} extra="Dùng trong số phiếu, ví dụ XK-GIAY-…">
            <Input style={{ width: 130 }} placeholder="GIAY" />
          </Form.Item>
          <Form.Item name="name" label="Tên kho" rules={[{ required: true }]} style={{ flex: 1 }}>
            <Input placeholder="Kho giấy" />
          </Form.Item>
        </Flex>
        <Form.Item name="address" label="Địa chỉ"><Input /></Form.Item>
        {!warehouse && (
          <Form.Item name="kind" label="Cách quản lý">
            <Select options={[{ value: 'STOCK', label: 'Theo số lượng (giấy, vật tư, hàng tồn…)' }, { value: 'DIE', label: 'Từng cái (khuôn)' }]} />
          </Form.Item>
        )}
        <Form.Item name="keeperIds" label="Thủ kho (xác nhận phiếu)">
          <Select mode="multiple" allowClear showSearch optionFilterProp="label" options={(people.data ?? []).map((p) => ({ value: p.id, label: p.fullName }))} />
        </Form.Item>
        <Flex gap={24}>
          <Form.Item name="sortOrder" label="Thứ tự hiển thị"><InputNumber min={0} style={{ width: 100 }} /></Form.Item>
          <Form.Item name="isActive" label="Đang dùng" valuePropName="checked"><Switch /></Form.Item>
        </Flex>
        <Form.Item name="note" label="Ghi chú"><Input /></Form.Item>
      </Form>
    </Modal>
  );
}

function Materials() {
  const can = useCan();
  const { data, isFetching } = useWhMaterials();
  const warehouses = useWarehouses();
  const [editing, setEditing] = useState<Material | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [kho, setKho] = useState<string>('all');
  const text = q.trim().toLowerCase();
  const rows = (data ?? []).filter((m) => (kho === 'all' || m.warehouseIds.includes(kho)) && (!text || `${m.code ?? ''} ${m.group} ${m.name}`.toLowerCase().includes(text)));
  const khoName = new Map((warehouses.data ?? []).map((w) => [w.id, w.code]));
  return (
    <Flex vertical gap={12}>
      <Typography.Text type="secondary">
        Một danh mục vật tư chung cho mọi kho. Mỗi vật tư có đơn vị cơ sở (tồn lưu theo đơn vị này), các quy cách / khổ, các đơn vị khác có hệ số quy đổi (đặt riêng được cho từng quy cách), và các kho có vật tư.
      </Typography.Text>
      <Flex wrap gap={12} align="center">
        {can('warehouse.manage') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>Thêm vật tư</Button>}
        <Input.Search id="material-search" placeholder="Mã, nhóm, tên" allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
        <Select value={kho} onChange={setKho} style={{ width: 200 }} options={[{ value: 'all', label: 'Mọi kho' }, ...(warehouses.data ?? []).filter((w) => w.kind === 'STOCK').map((w) => ({ value: w.id, label: w.name }))]} />
      </Flex>
      <Table<Material>
        rowKey="id"
        size="small"
        loading={isFetching}
        dataSource={rows}
        pagination={pager(rows?.length)}
        locale={{ emptyText: 'Chưa có vật tư. Ví dụ: nhóm GN, "Giấy ngoại IC 145", đơn vị tờ, khổ 18 x 50,5 và 27 x 23, đơn vị ram = 500 tờ.' }}
        columns={[
          { title: 'Mã', dataIndex: 'code', width: 90 },
          { title: 'Nhóm', dataIndex: 'group', width: 110 },
          { title: 'Vật tư', dataIndex: 'name', render: (v: string, m) => <span style={{ opacity: m.isActive ? 1 : 0.5 }}>{v}{!m.isActive && ' (ngừng dùng)'}</span> },
          { title: 'Đơn vị', key: 'u', width: 170, render: (_, m) => [m.unit, ...m.units.map((u) => `${u.name} = ${qty(u.factor)}${u.specLabel ? ` (${u.specLabel})` : ''}`)].join(' · ') },
          {
            title: 'Quy cách',
            key: 's',
            render: (_, m) =>
              m.hasSizes ? (
                <Flex wrap gap={4}>
                  {m.specs.map((p) => <Tag key={p.id} style={{ opacity: p.isActive ? 1 : 0.5 }}>{p.label}</Tag>)}
                </Flex>
              ) : (
                <Typography.Text type="secondary">Không theo khổ</Typography.Text>
              ),
          },
          { title: 'Tồn theo kho', key: 't', width: 180, render: (_, m) => m.warehouseIds.map((w) => `${khoName.get(w) ?? '?'}: ${qty(m.stocks.find((s) => s.warehouseId === w)?.qty ?? 0)}`).join(' · ') },
          { key: 'e', width: 60, render: (_, m) => can('warehouse.manage') && <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(m)} aria-label={`Sửa ${m.name}`} /> },
        ]}
      />
      {editing && <MaterialModal material={editing === 'new' ? null : editing} groups={[...new Set((data ?? []).map((m) => m.group))]} onClose={() => setEditing(null)} />}
    </Flex>
  );
}

type SpecRow = { id?: string; widthCm?: number; lengthCm?: number; isActive?: boolean };
type UnitRow = { id?: string; name?: string; factor?: number; spec?: string };
type MaterialForm = { code?: string; group: string; name: string; unit: string; hasSizes: boolean; isActive: boolean; warehouseIds: string[]; specs: SpecRow[]; units: UnitRow[] };
const specKey = (w?: number | null, l?: number | null) => `${w ?? 0}x${l ?? 0}`;
const specText = (w?: number | null, l?: number | null) => (w && l ? `${cm(w)} x ${cm(l)}` : w ? `khổ ${cm(w)}` : '');

function MaterialModal({ material, groups, onClose }: { material: Material | null; groups: string[]; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<MaterialForm>();
  const warehouses = useWarehouses();
  const { saveMaterial } = useWarehouseMutations();
  const hasSizes = Form.useWatch('hasSizes', form);
  const unit = Form.useWatch('unit', form);
  const specs = (Form.useWatch('specs', form) ?? []) as SpecRow[];
  const initial: MaterialForm = material
    ? {
        code: material.code ?? undefined,
        group: material.group,
        name: material.name,
        unit: material.unit,
        hasSizes: material.hasSizes,
        isActive: material.isActive,
        warehouseIds: material.warehouseIds,
        specs: material.hasSizes ? material.specs.map((p) => ({ id: p.id, widthCm: p.widthCm, lengthCm: p.lengthCm, isActive: p.isActive })) : [],
        units: material.units.map((u) => {
          const p = material.specs.find((x) => x.id === u.specId);
          return { id: u.id, name: u.name, factor: u.factor, spec: p ? specKey(p.widthCm, p.lengthCm) : '' };
        }),
      }
    : { group: groups[0] ?? 'Giấy', name: '', unit: 'tờ', hasSizes: true, isActive: true, warehouseIds: [], specs: [{}], units: [] };
  const submit = (v: MaterialForm) =>
    saveMaterial.mutate(
      {
        id: material?.id,
        code: v.code?.trim() || null,
        group: v.group,
        name: v.name,
        unit: v.unit,
        hasSizes: v.hasSizes,
        isActive: v.isActive,
        warehouseIds: v.warehouseIds ?? [],
        specs: v.hasSizes ? (v.specs ?? []).map((s) => ({ id: s.id, widthCm: s.widthCm ?? 0, lengthCm: s.lengthCm ?? 0, isActive: s.isActive ?? true })) : [],
        units: (v.units ?? [])
          .filter((u) => u.name && u.factor)
          .map((u) => {
            const [w, l] = u.spec ? u.spec.split('x').map(Number) : [null, null];
            return { id: u.id, name: u.name!, factor: u.factor!, widthCm: u.spec ? w : null, lengthCm: u.spec ? l : null };
          }),
      },
      { onSuccess: ok(message, onClose), onError: (e) => message.error(errorMessage(e)) },
    );
  const specOptions = [{ value: '', label: 'Mọi quy cách' }, ...specs.filter((s) => s.widthCm).map((s) => ({ value: specKey(s.widthCm, s.lengthCm), label: specText(s.widthCm, s.lengthCm) }))];
  return (
    <Modal open width={820} title={material ? `Sửa ${material.name}` : 'Thêm vật tư'} okText="Lưu" cancelText="Đóng" onCancel={onClose} onOk={() => form.submit()} confirmLoading={saveMaterial.isPending} destroyOnHidden>
      <Form<MaterialForm> form={form} layout="vertical" initialValues={initial} onFinish={submit}>
        <Flex wrap gap={12}>
          <Form.Item name="code" label="Mã vật tư">
            <Input style={{ width: 130 }} placeholder="GN-IC145" />
          </Form.Item>
          <Form.Item name="group" label="Nhóm" rules={[{ required: true }]}>
            <AutoComplete style={{ width: 150 }} options={[...new Set([...groups, 'Đề can', 'Giấy ngoại', 'Op', 'Bạt', 'Mực', 'Keo', 'Thành phẩm'])].map((g) => ({ value: g }))} />
          </Form.Item>
          <Form.Item name="name" label="Tên vật tư" rules={[{ required: true }]} style={{ flex: 1, minWidth: 220 }}>
            <Input placeholder="Giấy ngoại IC 145" />
          </Form.Item>
          <Form.Item name="unit" label="Đơn vị cơ sở" rules={[{ required: true }]} extra="Tồn lưu theo đơn vị này">
            <AutoComplete style={{ width: 110 }} options={['tờ', 'm', 'm²', 'kg', 'lít', 'cái', 'cuộn'].map((u) => ({ value: u }))} />
          </Form.Item>
        </Flex>
        <Form.Item name="warehouseIds" label="Có ở kho">
          <Select mode="multiple" allowClear options={(warehouses.data ?? []).filter((w) => w.kind === 'STOCK').map((w) => ({ value: w.id, label: w.name }))} placeholder="Chọn kho giữ vật tư này" />
        </Form.Item>
        <Flex gap={24}>
          <Form.Item name="hasSizes" label="Có quy cách / khổ" valuePropName="checked">
            <Switch disabled={!!material} />
          </Form.Item>
          <Form.Item name="isActive" label="Đang dùng" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Flex>
        {hasSizes && (
          <Form.List name="specs">
            {(fields, { add, remove }) => (
              <Flex vertical gap={4} style={{ marginBottom: 16 }}>
                <Typography.Text strong>Quy cách (cm)</Typography.Text>
                <Typography.Text type="secondary">Giấy: rộng × dài. Cuộn (bạt, decal cuộn): chỉ ghi khổ rộng, dài để trống. Quy cách đã có phiếu thì không sửa số được, chỉ tắt đi.</Typography.Text>
                {fields.map((f) => {
                  const saved = !!form.getFieldValue(['specs', f.name, 'id']);
                  return (
                    <Flex key={f.key} gap={8} align="start">
                      <Form.Item name={[f.name, 'widthCm']} style={{ marginBottom: 8 }} rules={[{ required: true, message: 'Rộng' }]}>
                        <InputNumber min={0.1} decimalSeparator="," placeholder="Rộng" style={{ width: 100 }} />
                      </Form.Item>
                      <span style={{ lineHeight: '32px' }}>x</span>
                      <Form.Item name={[f.name, 'lengthCm']} style={{ marginBottom: 8 }}>
                        <InputNumber min={0} decimalSeparator="," placeholder="Dài" style={{ width: 100 }} />
                      </Form.Item>
                      {saved ? (
                        <Form.Item name={[f.name, 'isActive']} valuePropName="checked" style={{ marginBottom: 8 }}>
                          <Switch checkedChildren="Dùng" unCheckedChildren="Tắt" />
                        </Form.Item>
                      ) : (
                        <Button type="text" icon={<MinusCircleOutlined />} onClick={() => remove(f.name)} aria-label="Bỏ quy cách" />
                      )}
                    </Flex>
                  );
                })}
                <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ isActive: true })} style={{ alignSelf: 'flex-start' }}>Thêm quy cách</Button>
              </Flex>
            )}
          </Form.List>
        )}
        <Form.List name="units">
          {(fields, { add, remove }) => (
            <Flex vertical gap={4}>
              <Typography.Text strong>Đơn vị tính khác</Typography.Text>
              <Typography.Text type="secondary">Ví dụ 1 ram = 500 {unit || 'tờ'}; riêng khổ bìa dày 1 ram = 250. Bạt: 1 cuộn khổ 3,2 m = 50 m. Đơn vị cơ sở ({unit || '…'}) luôn có sẵn.</Typography.Text>
              {fields.map((f) => (
                <Flex key={f.key} gap={8} align="start" wrap>
                  <span style={{ lineHeight: '32px' }}>1</span>
                  <Form.Item name={[f.name, 'name']} style={{ marginBottom: 8 }} rules={[{ required: true, message: 'Tên đơn vị' }]}>
                    <AutoComplete style={{ width: 110 }} placeholder="ram" options={['ram', 'cuộn', 'thùng', 'tấm', 'bộ', 'm²'].map((u) => ({ value: u }))} />
                  </Form.Item>
                  <span style={{ lineHeight: '32px' }}>=</span>
                  <Form.Item name={[f.name, 'factor']} style={{ marginBottom: 8 }} rules={[{ required: true, message: 'Hệ số' }]}>
                    <InputNumber min={0.0001} decimalSeparator="," style={{ width: 110 }} placeholder="500" suffix={unit} />
                  </Form.Item>
                  {hasSizes && (
                    <Form.Item name={[f.name, 'spec']} style={{ marginBottom: 8 }}>
                      <Select aria-label="Áp dụng cho" style={{ width: 170 }} options={specOptions} placeholder="Mọi quy cách" />
                    </Form.Item>
                  )}
                  <Button type="text" icon={<MinusCircleOutlined />} onClick={() => remove(f.name)} aria-label="Bỏ đơn vị" />
                </Flex>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ spec: '' })} style={{ alignSelf: 'flex-start' }}>Thêm đơn vị</Button>
            </Flex>
          )}
        </Form.List>
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
  const warehouses = useWarehouses();
  const khos = (warehouses.data ?? []).filter((w) => w.kind === 'DIE' && w.isActive);
  const [code, setCode] = useState('');
  const [kho, setKho] = useState<string | undefined>(undefined);
  const khoId = kho ?? khos[0]?.id;
  return (
    <Flex vertical gap={12}>
      <Typography.Text type="secondary">Mỗi kệ thuộc một kho khuôn. Mã kệ nên theo dạng Tầng-Kệ-Ô, ví dụ T4-K02-O03, để thủ kho tìm khuôn nhanh.</Typography.Text>
      {can('warehouse.manage') && (
        <Space.Compact style={{ maxWidth: 520 }}>
          <Select id="location-kho" value={khoId} onChange={setKho} style={{ width: 190 }} options={khos.map((k) => ({ value: k.id, label: k.name }))} />
          <Input id="location-code" placeholder="Mã vị trí mới" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button
            type="primary"
            disabled={!code.trim() || !khoId}
            loading={saveLocation.isPending}
            onClick={() => saveLocation.mutate({ code: code.trim(), warehouseId: khoId! }, { onSuccess: () => (setCode(''), message.success('Đã thêm vị trí')), onError: (e) => message.error(errorMessage(e)) })}
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
          { title: 'Kho', dataIndex: 'warehouseName', width: 180 },
          { title: 'Mã vị trí', dataIndex: 'code', render: (v: string, l) => <span style={{ opacity: l.isActive ? 1 : 0.5 }}>{v}</span> },
          { title: 'Số khuôn', dataIndex: 'dies', width: 110, align: 'right' },
          { title: 'Ghi chú', dataIndex: 'note' },
          {
            title: 'Đang dùng',
            key: 'a',
            width: 110,
            render: (_, l) => (
              <Switch size="small" checked={l.isActive} disabled={!can('warehouse.manage')} onChange={(isActive) => saveLocation.mutate({ id: l.id, warehouseId: l.warehouseId, code: l.code, note: l.note, isActive }, { onError: (e) => message.error(errorMessage(e)) })} />
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
            pagination={pager(report.issues?.length)}
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

/** Nhập bảng tồn giấy (Google Sheets "THEO DÕI GIẤY TỒN" tải về dạng .xlsx): danh mục + phiếu điều chỉnh đưa tồn về đúng bảng, chờ xác nhận */
function ImportPaper() {
  const { message } = App.useApp();
  const { importPaper } = useWarehouseMutations();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<Schemas['PaperImportReportDto'] | null>(null);
  const [dry, setDry] = useState(true);
  const run = (dryRun: boolean) =>
    file &&
    importPaper.mutate(
      { file, dryRun },
      {
        onSuccess: (r) => {
          setReport(r);
          setDry(dryRun);
          if (!dryRun) message.success(r.slipCode ? `Đã nhập; phiếu ${r.slipCode} chờ thủ kho xác nhận` : 'Tồn đã đúng bảng, không cần phiếu');
        },
        onError: (e) => message.error(errorMessage(e)),
      },
    );
  return (
    <Flex vertical gap={12} style={{ maxWidth: 1100 }}>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        Chọn bảng tồn giấy đang theo dõi (trên Google Sheets: Tệp → Tải xuống → Microsoft Excel). Phần mềm đọc sheet có cột Mã VT, Loại giấy, Khổ giấy, TỒN; tạo vật tư (đơn vị tờ, mã vật tư đúng Mã VT trong bảng) và quy cách theo khổ ở Kho giấy, rồi lập
        một phiếu điều chỉnh đưa tồn từng quy cách về đúng số trong bảng (lần đầu là phiếu "Tồn đầu"). Thủ kho Kho giấy vào Kho vật tư → Chờ xác nhận, xem lại và bấm Xác nhận thì tồn khớp bảng. Nhập lại bảng
        mới: phiếu theo bảng trước còn chờ sẽ được thay; đã xác nhận rồi thì phiếu mới chỉ ghi phần chênh. Dòng chưa đếm chỉ tạo quy cách, không đổi tồn.
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
        <Button disabled={!file} loading={importPaper.isPending && importPaper.variables?.dryRun} onClick={() => run(true)}>Xem trước</Button>
        <Popconfirm title="Nhập danh mục giấy và lập phiếu điều chỉnh theo bảng?" okText="Nhập" cancelText="Không" disabled={!report || !dry} onConfirm={() => run(false)}>
          <Button type="primary" disabled={!report || !dry} loading={importPaper.isPending && importPaper.variables?.dryRun === false}>Nhập</Button>
        </Popconfirm>
      </Space>
      {report && (
        <Flex vertical gap={12}>
          <Alert
            type={dry ? 'info' : 'success'}
            title={dry ? `Xem trước sheet "${report.sheet}" — chưa ghi gì` : report.slipCode ? `Đã nhập. Phiếu ${report.slipCode} chờ thủ kho Kho giấy xác nhận (Kho vật tư → Chờ xác nhận).` : 'Đã nhập danh mục; tồn đã đúng bảng'}
            description={`${report.rows} loại giấy × khổ; ${report.materialsCreated} vật tư mới, ${report.specsCreated} quy cách mới; ${report.counted} quy cách có số tồn, tổng ${report.totalQty.toLocaleString('vi-VN')} tờ; ${report.adjusted} quy cách cần điều chỉnh, ${report.unchanged} đã đúng${report.replacedSlips.length ? `; ${dry ? 'sẽ thay' : 'đã thay'} phiếu chờ ${report.replacedSlips.join(', ')}` : ''}.`}
          />
          {report.issues.length > 0 && (
            <Table<Schemas['ImportIssueDto']>
              rowKey={(r) => `${r.row}-${r.message}`}
              size="small"
              dataSource={report.issues}
              pagination={false}
              title={() => `${report.issues.length} điểm cần xem`}
              columns={[
                { title: 'Dòng', dataIndex: 'row', width: 70, render: (v: number) => v || '' },
                { title: 'Giấy', dataIndex: 'code', width: 260 },
                { title: 'Nội dung', dataIndex: 'message' },
              ]}
            />
          )}
          <Table<Schemas['PaperImportItemDto']>
            rowKey="row"
            size="small"
            dataSource={report.items}
            scroll={{ x: 1000 }}
            pagination={pager(report.items?.length)}
            columns={[
              { title: 'Dòng', dataIndex: 'row', width: 70 },
              { title: 'Mã VT', dataIndex: 'code', width: 80 },
              { title: 'Nhóm', dataIndex: 'group', width: 110 },
              { title: 'Loại giấy', dataIndex: 'name', width: 280 },
              { title: 'Khổ', dataIndex: 'size', width: 120 },
              { title: 'Tồn (tờ)', dataIndex: 'qty', width: 100, align: 'right', render: (v: number | null) => (v === null ? <Typography.Text type="secondary">chưa đếm</Typography.Text> : v.toLocaleString('vi-VN')) },
              { title: 'Đang có', dataIndex: 'onHand', width: 90, align: 'right', render: (v: number | null) => (v ?? 0).toLocaleString('vi-VN') },
              {
                title: 'Chênh',
                dataIndex: 'delta',
                width: 90,
                align: 'right',
                render: (v: number | null) => (v === null || v === 0 ? '' : <Typography.Text type={v < 0 ? 'danger' : 'success'}>{v > 0 ? `+${v.toLocaleString('vi-VN')}` : v.toLocaleString('vi-VN')}</Typography.Text>),
              },
              { title: 'Ghi chú', dataIndex: 'note' },
            ]}
          />
        </Flex>
      )}
    </Flex>
  );
}
