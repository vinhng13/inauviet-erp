import { DeleteOutlined, EditOutlined, ExportOutlined, ImportOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, DatePicker, Flex, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAccountingMutations, useMaterials, useStock, useSuppliers } from '../../api/accounting';
import type { Schemas } from '../../api/client';
import { useOrders } from '../../api/hooks';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatQty, formatVnd, vndInputProps } from '../../lib/format';
import { AccountingPage, money, monthLabel, PAY_METHOD, PeriodClosedNote, VAT_OPTIONS, type Period, type VatRate } from './common';

type Modal = 'receipt' | 'issue' | null;

/** "Kho NVL": stock by material (monthly weighted average), receipts, issues, materials and suppliers */
export function AccountingStockPage() {
  const can = useCan();
  const [open, setOpen] = useState<Modal>(null);
  return (
    <AccountingPage
      title="Kho nguyên vật liệu"
      extra={(p) =>
        p.status === 'OPEN' && can('accounting.post') ? (
          <Space>
            <Button icon={<ImportOutlined />} onClick={() => setOpen('receipt')}>Phiếu nhập</Button>
            <Button type="primary" icon={<ExportOutlined />} onClick={() => setOpen('issue')}>Phiếu xuất</Button>
          </Space>
        ) : null
      }
    >
      {(period) => (
        <>
          <Stock period={period} />
          {open === 'receipt' && <ReceiptModal period={period} onClose={() => setOpen(null)} />}
          {open === 'issue' && <IssueModal period={period} onClose={() => setOpen(null)} />}
        </>
      )}
    </AccountingPage>
  );
}

const defaultDate = (period: Period) => (dayjs().format('YYYY-MM') === period.month ? dayjs() : dayjs(`${period.month}-01`).endOf('month'));

function Stock({ period }: { period: Period }) {
  const can = useCan();
  const { message } = App.useApp();
  const { data, isFetching } = useStock(period.id);
  const { deleteReceipt, deleteIssue } = useAccountingMutations();
  const editable = !!data?.editable && can('accounting.post');
  const lineList = (lines: Schemas['ReceiptLineDto'][]) => lines.map((l) => `${l.materialName} ${formatQty(l.qty)} ${l.unit}`).join(', ');
  const del = (fn: typeof deleteReceipt, id: string) => fn.mutate(id, { onSuccess: () => message.success('Đã xoá phiếu'), onError: (e) => message.error(errorMessage(e)) });

  return (
    <Flex vertical gap={12}>
      <PeriodClosedNote period={period} />
      <Tabs
        items={[
          {
            key: 'stock',
            label: 'Tồn kho',
            children: (
              <Flex vertical gap={8}>
                <Typography.Text type="secondary">
                  {data?.priced
                    ? `Đã tính giá xuất kho bình quân cả kỳ ${monthLabel(period.month)}.`
                    : 'Giá xuất đang tạm tính theo bình quân đến thời điểm xuất; bước "Tính giá xuất kho" cuối kỳ sẽ tính lại theo bình quân cả kỳ.'}
                </Typography.Text>
                <Table<Schemas['StockRowDto']>
                  rowKey="materialId"
                  size="small"
                  loading={isFetching}
                  dataSource={data?.rows}
                  pagination={false}
                  scroll={{ x: 1100 }}
                  columns={[
                    { title: 'Mã', dataIndex: 'code', width: 110, fixed: 'left' },
                    { title: 'Vật tư', dataIndex: 'name', width: 200 },
                    { title: 'ĐVT', dataIndex: 'unit', width: 60 },
                    { title: 'Tồn đầu', key: 'oq', width: 90, align: 'right', render: (_, r) => formatQty(r.openQty) },
                    { title: 'Nhập', key: 'iq', width: 90, align: 'right', render: (_, r) => formatQty(r.inQty) },
                    { title: 'Giá trị nhập', dataIndex: 'inVnd', width: 130, align: 'right', render: money },
                    { title: 'Xuất', key: 'xq', width: 90, align: 'right', render: (_, r) => formatQty(r.outQty) },
                    { title: 'Giá trị xuất', dataIndex: 'outVnd', width: 130, align: 'right', render: money },
                    { title: 'Tồn cuối', key: 'eq', width: 100, align: 'right', render: (_, r) => <strong style={{ color: r.endQty < 0 ? '#cf1322' : undefined }}>{formatQty(r.endQty)}</strong> },
                    { title: 'Giá trị tồn', dataIndex: 'endVnd', width: 140, align: 'right', render: formatVnd },
                    { title: data?.priced ? 'Đơn giá BQ' : 'Đơn giá tạm', dataIndex: 'priceVnd', width: 120, align: 'right', render: formatVnd },
                  ]}
                  summary={(rows) => (
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={5}><strong>Tổng</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={5} align="right">{formatVnd(rows.reduce((s, r) => s + r.inVnd, 0))}</Table.Summary.Cell>
                      <Table.Summary.Cell index={6} />
                      <Table.Summary.Cell index={7} align="right">{formatVnd(rows.reduce((s, r) => s + r.outVnd, 0))}</Table.Summary.Cell>
                      <Table.Summary.Cell index={8} />
                      <Table.Summary.Cell index={9} align="right"><strong>{formatVnd(rows.reduce((s, r) => s + r.endVnd, 0))}</strong></Table.Summary.Cell>
                      <Table.Summary.Cell index={10} />
                    </Table.Summary.Row>
                  )}
                />
              </Flex>
            ),
          },
          {
            key: 'receipts',
            label: `Phiếu nhập (${data?.receipts.length ?? 0})`,
            children: (
              <Table<Schemas['ReceiptDto']>
                rowKey="id"
                size="small"
                dataSource={data?.receipts}
                pagination={{ pageSize: 30, hideOnSinglePage: true }}
                scroll={{ x: 960 }}
                locale={{ emptyText: 'Chưa có phiếu nhập' }}
                columns={[
                  { title: 'Ngày', dataIndex: 'date', width: 110, render: formatDate },
                  { title: 'Số phiếu', dataIndex: 'code', width: 140 },
                  { title: 'Nhà cung cấp', dataIndex: 'supplierName', width: 200 },
                  { title: 'Vật tư', key: 'l', render: (_, r) => lineList(r.lines) },
                  { title: 'Tiền hàng', dataIndex: 'valueVnd', width: 130, align: 'right', render: formatVnd },
                  { title: 'Thuế', key: 'v', width: 120, align: 'right', render: (_, r) => <>{money(r.vatVnd)} <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.vatRate}%</Typography.Text></> },
                  { title: 'Thanh toán', dataIndex: 'payMethod', width: 150, render: (m: Schemas['PayMethod']) => PAY_METHOD[m] },
                  {
                    title: '',
                    key: 'a',
                    width: 50,
                    render: (_, r) =>
                      editable && (
                        <Popconfirm title={`Xoá ${r.code}?`} okText="Xoá" cancelText="Thôi" onConfirm={() => del(deleteReceipt, r.id)}>
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Xoá ${r.code}`} />
                        </Popconfirm>
                      ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'issues',
            label: `Phiếu xuất (${data?.issues.length ?? 0})`,
            children: (
              <Table<Schemas['IssueDto']>
                rowKey="id"
                size="small"
                dataSource={data?.issues}
                pagination={{ pageSize: 30, hideOnSinglePage: true }}
                scroll={{ x: 900 }}
                locale={{ emptyText: 'Chưa có phiếu xuất' }}
                columns={[
                  { title: 'Ngày', dataIndex: 'date', width: 110, render: formatDate },
                  { title: 'Số phiếu', dataIndex: 'code', width: 140 },
                  {
                    title: 'Cho đơn',
                    key: 'o',
                    width: 220,
                    render: (_, r) => (r.orderId ? <><Link to={`/orders/${r.orderId}`}>{r.orderCode}</Link><div style={{ fontSize: 12, opacity: 0.65 }}>{r.customerName}</div></> : <Tag>Dùng chung (SX chung)</Tag>),
                  },
                  { title: 'Vật tư', key: 'l', render: (_, r) => lineList(r.lines) },
                  { title: 'Giá trị', dataIndex: 'valueVnd', width: 130, align: 'right', render: formatVnd },
                  {
                    title: '',
                    key: 'a',
                    width: 50,
                    render: (_, r) =>
                      editable && (
                        <Popconfirm title={`Xoá ${r.code}?`} okText="Xoá" cancelText="Thôi" onConfirm={() => del(deleteIssue, r.id)}>
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Xoá ${r.code}`} />
                        </Popconfirm>
                      ),
                  },
                ]}
              />
            ),
          },
          { key: 'materials', label: 'Danh mục vật tư', children: <Materials /> },
          { key: 'suppliers', label: 'Nhà cung cấp', children: <Suppliers /> },
        ]}
      />
    </Flex>
  );
}

interface LineForm {
  materialId?: string;
  qty?: number;
  priceVnd?: number;
}

function ReceiptModal({ period, onClose }: { period: Period; onClose: () => void }) {
  const { message } = App.useApp();
  const { createReceipt } = useAccountingMutations();
  const suppliers = useSuppliers();
  const materials = useMaterials();
  const [form] = Form.useForm<{ date: Dayjs; supplierId: string; payMethod: Schemas['PayMethod']; vatRate: VatRate; note?: string; lines: LineForm[] }>();
  const lines = Form.useWatch('lines', form) ?? [];
  const vat = Form.useWatch('vatRate', form) ?? 8;
  const value = lines.reduce((s, l) => s + Math.round((l?.qty ?? 0) * (l?.priceVnd ?? 0)), 0);
  return (
    <Modal
      open
      width={760}
      title="Phiếu nhập kho"
      okText="Ghi phiếu nhập"
      cancelText="Đóng"
      confirmLoading={createReceipt.isPending}
      onCancel={onClose}
      destroyOnHidden
      onOk={() =>
        form.validateFields().then((v) =>
          createReceipt.mutate(
            { date: v.date.format('YYYY-MM-DD'), supplierId: v.supplierId, payMethod: v.payMethod, vatRate: v.vatRate, note: v.note?.trim() || undefined, lines: v.lines.map((l) => ({ materialId: l.materialId!, qty: l.qty!, priceVnd: l.priceVnd! })) },
            { onSuccess: () => { message.success('Đã ghi phiếu nhập'); onClose(); }, onError: (e) => message.error(errorMessage(e)) },
          ),
        )
      }
    >
      <Form form={form} layout="vertical" initialValues={{ date: defaultDate(period), payMethod: 'CREDIT', vatRate: 8, lines: [{}] }}>
        <Space wrap>
          <Form.Item name="date" label="Ngày nhập" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="supplierId" label="Nhà cung cấp" rules={[{ required: true, message: 'Chọn nhà cung cấp' }]}>
            <Select showSearch optionFilterProp="label" style={{ width: 280 }} options={(suppliers.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))} />
          </Form.Item>
          <Form.Item name="payMethod" label="Thanh toán">
            <Select style={{ width: 170 }} options={Object.entries(PAY_METHOD).map(([value, label]) => ({ value, label }))} />
          </Form.Item>
          <Form.Item name="vatRate" label="Thuế GTGT">
            <Select style={{ width: 90 }} options={VAT_OPTIONS} />
          </Form.Item>
        </Space>
        <MaterialLines materials={materials.data ?? []} withPrice />
        <Form.Item name="note" label="Ghi chú">
          <Input maxLength={300} />
        </Form.Item>
        <Typography.Text>
          Tiền hàng <strong>{formatVnd(value)}</strong> · thuế {formatVnd(Math.round((value * vat) / 100))} · tổng <strong>{formatVnd(value + Math.round((value * vat) / 100))}</strong>
        </Typography.Text>
      </Form>
    </Modal>
  );
}

function MaterialLines({ materials, withPrice, onHand }: { materials: Schemas['MaterialDto'][]; withPrice?: boolean; onHand?: Map<string, number> }) {
  return (
    <Form.List name="lines">
      {(fields, { add, remove }) => (
        <Flex vertical gap={0}>
          {fields.map((f, i) => (
            <Space key={f.key} align="baseline" wrap>
              <Form.Item name={[f.name, 'materialId']} label={i === 0 ? 'Vật tư' : undefined} rules={[{ required: true, message: 'Chọn vật tư' }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 300 }}
                  options={materials.filter((m) => m.isActive).map((m) => ({ value: m.id, label: `${m.code} · ${m.name} (${m.unit})${onHand ? ` · tồn ${formatQty(onHand.get(m.id) ?? 0)}` : ''}` }))}
                />
              </Form.Item>
              <Form.Item name={[f.name, 'qty']} label={i === 0 ? 'Số lượng' : undefined} rules={[{ required: true, message: 'Nhập SL' }]}>
                <InputNumber min={0.001} precision={3} style={{ width: 120 }} />
              </Form.Item>
              {withPrice && (
                <Form.Item name={[f.name, 'priceVnd']} label={i === 0 ? 'Đơn giá' : undefined} rules={[{ required: true, message: 'Nhập giá' }]}>
                  <InputNumber {...vndInputProps} style={{ width: 160 }} />
                </Form.Item>
              )}
              {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} aria-label="Bỏ dòng" />}
            </Space>
          ))}
          <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} style={{ width: 200, marginBottom: 16 }}>
            Thêm vật tư
          </Button>
        </Flex>
      )}
    </Form.List>
  );
}

function IssueModal({ period, onClose }: { period: Period; onClose: () => void }) {
  const { message } = App.useApp();
  const { createIssue } = useAccountingMutations();
  const materials = useMaterials();
  const stock = useStock(period.id);
  const [q, setQ] = useState('');
  const orders = useOrders({ q: q || undefined, pageSize: 20 });
  const onHand = new Map((stock.data?.rows ?? []).map((r) => [r.materialId, r.endQty]));
  const [form] = Form.useForm<{ date: Dayjs; orderId?: string; note?: string; lines: LineForm[] }>();
  return (
    <Modal
      open
      width={720}
      title="Phiếu xuất kho cho sản xuất"
      okText="Ghi phiếu xuất"
      cancelText="Đóng"
      confirmLoading={createIssue.isPending}
      onCancel={onClose}
      destroyOnHidden
      onOk={() =>
        form.validateFields().then((v) =>
          createIssue.mutate(
            { date: v.date.format('YYYY-MM-DD'), orderId: v.orderId || undefined, note: v.note?.trim() || undefined, lines: v.lines.map((l) => ({ materialId: l.materialId!, qty: l.qty! })) },
            { onSuccess: () => { message.success('Đã ghi phiếu xuất'); onClose(); }, onError: (e) => message.error(errorMessage(e)) },
          ),
        )
      }
    >
      <Form form={form} layout="vertical" initialValues={{ date: defaultDate(period), lines: [{}] }}>
        <Space wrap>
          <Form.Item name="date" label="Ngày xuất" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="orderId" label="Cho đơn hàng" extra="Bỏ trống nếu là vật tư dùng chung (tính vào chi phí sản xuất chung)">
            <Select
              allowClear
              showSearch
              filterOption={false}
              onSearch={setQ}
              placeholder="Tìm mã đơn, khách"
              style={{ width: 360 }}
              options={(orders.data?.items ?? []).filter((o) => o.status !== 'CANCELLED').map((o) => ({ value: o.id, label: `${o.code} · ${o.customerName} · ${o.summary}` }))}
            />
          </Form.Item>
        </Space>
        <MaterialLines materials={materials.data ?? []} onHand={onHand} />
        <Form.Item name="note" label="Ghi chú">
          <Input maxLength={300} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function Materials() {
  const can = useCan();
  const { data, isLoading } = useMaterials();
  const [editing, setEditing] = useState<Schemas['MaterialDto'] | 'new' | null>(null);
  return (
    <Flex vertical gap={8}>
      {can('accounting.post') && <Button icon={<PlusOutlined />} onClick={() => setEditing('new')} style={{ alignSelf: 'flex-start' }}>Thêm vật tư</Button>}
      <Table<Schemas['MaterialDto']>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        rowClassName={(m) => (m.isActive ? '' : 'row-voided')}
        columns={[
          { title: 'Mã', dataIndex: 'code', width: 140 },
          { title: 'Tên vật tư', dataIndex: 'name' },
          { title: 'ĐVT', dataIndex: 'unit', width: 80 },
          { title: '', key: 'a', width: 60, render: (_, m) => can('accounting.post') && <Button size="small" type="text" icon={<EditOutlined />} aria-label={`Sửa ${m.code}`} onClick={() => setEditing(m)} /> },
        ]}
      />
      {editing && <MaterialModal material={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Flex>
  );
}

function MaterialModal({ material, onClose }: { material: Schemas['MaterialDto'] | null; onClose: () => void }) {
  const { message } = App.useApp();
  const { saveMaterial } = useAccountingMutations();
  const [form] = Form.useForm<Schemas['SaveMaterialDto']>();
  return (
    <Modal
      open
      title={material ? `Sửa vật tư ${material.code}` : 'Thêm vật tư'}
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={saveMaterial.isPending}
      onCancel={onClose}
      destroyOnHidden
      onOk={() => form.validateFields().then((body) => saveMaterial.mutate({ id: material?.id, body }, { onSuccess: () => { message.success('Đã lưu vật tư'); onClose(); }, onError: (e) => message.error(errorMessage(e)) }))}
    >
      <Form form={form} layout="vertical" initialValues={material ?? { isActive: true }}>
        <Form.Item name="code" label="Mã vật tư" rules={[{ required: true, whitespace: true, message: 'Nhập mã' }]}>
          <Input maxLength={30} placeholder="VT-DPP" />
        </Form.Item>
        <Form.Item name="name" label="Tên vật tư" rules={[{ required: true, whitespace: true, message: 'Nhập tên' }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="unit" label="Đơn vị tính" rules={[{ required: true, whitespace: true, message: 'Nhập ĐVT' }]}>
          <Input maxLength={20} placeholder="m², tấm, lít…" />
        </Form.Item>
        <Form.Item name="isActive" label="Đang dùng" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function Suppliers() {
  const can = useCan();
  const { data, isLoading } = useSuppliers();
  const [editing, setEditing] = useState<Schemas['SupplierDto'] | 'new' | null>(null);
  return (
    <Flex vertical gap={8}>
      {can('accounting.post') && <Button icon={<PlusOutlined />} onClick={() => setEditing('new')} style={{ alignSelf: 'flex-start' }}>Thêm nhà cung cấp</Button>}
      <Table<Schemas['SupplierDto']>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: 700 }}
        rowClassName={(s) => (s.isActive ? '' : 'row-voided')}
        columns={[
          { title: 'Mã', dataIndex: 'code', width: 110 },
          { title: 'Tên', dataIndex: 'name' },
          { title: 'Điện thoại', dataIndex: 'phone', width: 130 },
          { title: 'MST', dataIndex: 'taxCode', width: 130 },
          { title: 'Địa chỉ', dataIndex: 'address' },
          { title: '', key: 'a', width: 60, render: (_, s) => can('accounting.post') && <Button size="small" type="text" icon={<EditOutlined />} aria-label={`Sửa ${s.name}`} onClick={() => setEditing(s)} /> },
        ]}
      />
      {editing && <SupplierModal supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Flex>
  );
}

function SupplierModal({ supplier, onClose }: { supplier: Schemas['SupplierDto'] | null; onClose: () => void }) {
  const { message } = App.useApp();
  const { saveSupplier } = useAccountingMutations();
  const [form] = Form.useForm<Schemas['SaveSupplierDto']>();
  return (
    <Modal
      open
      title={supplier ? `Sửa nhà cung cấp ${supplier.code}` : 'Thêm nhà cung cấp'}
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={saveSupplier.isPending}
      onCancel={onClose}
      destroyOnHidden
      onOk={() => form.validateFields().then((body) => saveSupplier.mutate({ id: supplier?.id, body }, { onSuccess: () => { message.success('Đã lưu nhà cung cấp'); onClose(); }, onError: (e) => message.error(errorMessage(e)) }))}
    >
      <Form form={form} layout="vertical" initialValues={supplier ? { ...supplier, phone: supplier.phone ?? undefined, taxCode: supplier.taxCode ?? undefined, address: supplier.address ?? undefined } : { isActive: true }}>
        <Form.Item name="name" label="Tên nhà cung cấp" rules={[{ required: true, whitespace: true, message: 'Nhập tên' }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="phone" label="Điện thoại">
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="taxCode" label="Mã số thuế">
            <Input maxLength={20} />
          </Form.Item>
        </Space>
        <Form.Item name="address" label="Địa chỉ">
          <Input maxLength={300} />
        </Form.Item>
        <Form.Item name="isActive" label="Đang giao dịch" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}
