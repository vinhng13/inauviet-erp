import { PlusOutlined } from '@ant-design/icons';
import { App, AutoComplete, Button, Flex, Form, Input, InputNumber, Modal, Radio, Segmented, Switch, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import type { Schemas } from '../api/client';
import { useProductMutations, useProducts } from '../api/hooks';
import { useCan } from '../lib/access';
import { errorMessage } from '../lib/errors';
import { formatVnd, vndInputProps } from '../lib/format';

type Product = Schemas['ProductDto'];
type FormValues = { name: string; category: string; pricingMode: Schemas['PricingMode']; unit?: string; unitPriceVnd: number; isActive: boolean; note?: string };

/** Product catalog ("Danh mục sản phẩm"): what can be quoted, and the list price. */
export function ProductsPage() {
  const can = useCan();
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [q, setQ] = useState('');
  const { data, isFetching } = useProducts(filter === 'active' ? { active: true } : {});
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const manage = can('products.manage');
  const showMoney = can('money.view');
  const rows = (data ?? []).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || p.category.toLowerCase().includes(q.toLowerCase()));

  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Sản phẩm
        </Typography.Title>
        {manage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            Thêm sản phẩm
          </Button>
        )}
      </Flex>
      <Flex wrap gap={12} align="center">
        <Input.Search id="products-search" placeholder="Tên hoặc nhóm sản phẩm" allowClear onSearch={(v) => setQ(v.trim())} onChange={(e) => !e.target.value && setQ('')} style={{ width: 300 }} />
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as 'active' | 'all')}
          options={[
            { value: 'active', label: 'Đang bán' },
            { value: 'all', label: 'Tất cả' },
          ]}
        />
      </Flex>
      <Table<Product>
        rowKey="id"
        size="middle"
        loading={isFetching}
        dataSource={rows}
        pagination={false}
        scroll={{ x: 760 }}
        onRow={(p) => (manage ? { onClick: () => setEditing(p), style: { cursor: 'pointer' } } : {})}
        columns={[
          { title: 'Tên sản phẩm', dataIndex: 'name', render: (v: string, p) => (p.isActive ? <strong>{v}</strong> : <Typography.Text type="secondary">{v}</Typography.Text>) },
          { title: 'Nhóm', dataIndex: 'category', width: 160 },
          { title: 'Tính giá', dataIndex: 'pricingMode', width: 170, render: (v: Product['pricingMode']) => (v === 'AREA' ? 'Theo m² (rộng × cao)' : 'Theo số lượng') },
          { title: 'ĐVT', dataIndex: 'unit', width: 80 },
          ...(showMoney ? [{ title: 'Đơn giá', dataIndex: 'unitPriceVnd', width: 140, align: 'right' as const, render: (v: number) => formatVnd(v) }] : []),
          { title: 'Trạng thái', dataIndex: 'isActive', width: 120, render: (v: boolean) => (v ? <Tag color="green">Đang bán</Tag> : <Tag>Ngừng bán</Tag>) },
        ]}
      />
      {editing && <ProductModal product={editing === 'new' ? null : editing} categories={[...new Set((data ?? []).map((p) => p.category))]} onClose={() => setEditing(null)} />}
    </Flex>
  );
}

function ProductModal({ product, categories, onClose }: { product: Product | null; categories: string[]; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const { create, update } = useProductMutations();
  const mode = Form.useWatch('pricingMode', form) ?? product?.pricingMode ?? 'AREA';

  async function save() {
    const v = await form.validateFields();
    const body = { ...v, unit: v.pricingMode === 'AREA' ? undefined : v.unit?.trim(), note: v.note?.trim() || undefined };
    try {
      if (product) await update.mutateAsync({ id: product.id, ...body });
      else await create.mutateAsync(body);
      message.success('Đã lưu sản phẩm');
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  return (
    <Modal
      open
      title={product ? `Sửa sản phẩm · ${product.name}` : 'Thêm sản phẩm'}
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={create.isPending || update.isPending}
      onCancel={onClose}
      onOk={save}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={
          product
            ? { name: product.name, category: product.category, pricingMode: product.pricingMode, unit: product.pricingMode === 'UNIT' ? product.unit : undefined, unitPriceVnd: product.unitPriceVnd, isActive: product.isActive, note: product.note ?? undefined }
            : { pricingMode: 'AREA', isActive: true }
        }
      >
        <Form.Item name="name" label="Tên sản phẩm" rules={[{ required: true, whitespace: true, message: 'Nhập tên' }]}>
          <Input id="product-name" maxLength={200} autoFocus />
        </Form.Item>
        <Form.Item name="category" label="Nhóm" rules={[{ required: true, whitespace: true, message: 'Nhập nhóm' }]}>
          <AutoComplete id="product-category" options={categories.map((c) => ({ value: c }))} placeholder="Decal, Bạt, Biển & hộp đèn, Standee…" />
        </Form.Item>
        <Form.Item name="pricingMode" label="Cách tính giá">
          <Radio.Group
            id="product-mode"
            options={[
              { value: 'AREA', label: 'Theo m² (nhập rộng × cao khi báo giá)' },
              { value: 'UNIT', label: 'Theo số lượng' },
            ]}
          />
        </Form.Item>
        {mode === 'UNIT' && (
          <Form.Item name="unit" label="Đơn vị tính" rules={[{ required: true, whitespace: true, message: 'Nhập đơn vị' }]}>
            <Input id="product-unit" placeholder="cái, bộ, hộp…" maxLength={20} />
          </Form.Item>
        )}
        <Form.Item name="unitPriceVnd" label={mode === 'AREA' ? 'Đơn giá (đồng / m²)' : 'Đơn giá (đồng / đơn vị)'} rules={[{ required: true, message: 'Nhập đơn giá' }]} extra="Đổi giá không ảnh hưởng báo giá, đơn hàng đã lập.">
          <InputNumber id="product-price" {...vndInputProps} min={1} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea id="product-note" rows={2} maxLength={1000} />
        </Form.Item>
        <Form.Item name="isActive" label="Đang bán" valuePropName="checked" extra="Sản phẩm ngừng bán không hiện khi lập báo giá mới.">
          <Switch id="product-active" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
