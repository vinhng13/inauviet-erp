import { PlusOutlined } from '@ant-design/icons';
import { App, Button, Col, Divider, Form, Input, Modal, Row, Select } from 'antd';
import { useState } from 'react';
import { ApiError, type Schemas } from '../api/client';
import { useCustomer, useCustomerMutations, useCustomers } from '../api/hooks';
import { errorMessage } from '../lib/errors';
import { useCan } from '../lib/access';

interface Props {
  value?: string;
  onChange?: (id: string, customer?: Schemas['CustomerDto']) => void;
}

/** Search customers by name, company or phone; create a new one without leaving the form. */
export function CustomerSelect({ value, onChange }: Props) {
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, isFetching } = useCustomers({ q: q || undefined, pageSize: 20 });
  const canCreate = useCan()('customers.create');
  const listed = data?.items ?? [];
  // A preset value (editing, or ?customerId=) may not be in the first search page: load it so the name shows.
  const missing = !!value && !listed.some((c) => c.id === value);
  const { data: selected } = useCustomer(missing ? value! : '', missing);
  const items = missing && selected ? [selected as Schemas['CustomerDto'], ...listed] : listed;

  return (
    <>
      <Select
        id="customerId"
        showSearch
        value={value}
        placeholder="Tìm theo tên, công ty hoặc số điện thoại"
        filterOption={false}
        onSearch={setQ}
        loading={isFetching}
        onChange={(id: string) => onChange?.(id, items.find((c) => c.id === id))}
        options={items.map((c) => ({
          value: c.id,
          label: `${c.name}${c.companyName ? ` · ${c.companyName}` : ''} · ${c.phone}`,
        }))}
        notFoundContent={q ? 'Không tìm thấy khách hàng' : 'Gõ để tìm'}
        popupRender={(menu) => (
          <>
            {menu}
            {canCreate && (
              <>
                <Divider style={{ margin: '8px 0' }} />
                <Button type="text" icon={<PlusOutlined />} block onClick={() => setCreating(true)}>
                  Thêm khách hàng mới
                </Button>
              </>
            )}
          </>
        )}
      />
      <CustomerFormModal
        open={creating}
        initialName={q}
        onClose={() => setCreating(false)}
        onSaved={(c) => {
          setCreating(false);
          onChange?.(c.id, c);
        }}
      />
    </>
  );
}

interface FormModalProps {
  open: boolean;
  customer?: Schemas['CustomerDto'];
  initialName?: string;
  onClose: () => void;
  onSaved: (c: Schemas['CustomerDto']) => void;
}

export function CustomerFormModal({ open, customer, initialName, onClose, onSaved }: FormModalProps) {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<Schemas['CreateCustomerDto']>();
  const { create, update } = useCustomerMutations();
  const saving = create.isPending || update.isPending;

  async function save() {
    const values = await form.validateFields();
    try {
      const saved = customer ? await update.mutateAsync({ id: customer.id, body: values }) : await create.mutateAsync(values);
      message.success(customer ? 'Đã lưu khách hàng' : `Đã thêm khách hàng ${saved.code}`);
      onSaved(saved);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'PHONE_EXISTS' && !customer) {
        const existing = err.body.details?.customer as Schemas['CustomerDto'] | undefined;
        if (existing) {
          modal.confirm({
            title: 'Số điện thoại đã có',
            content: `${existing.phone} thuộc về ${existing.code} ${existing.name}${existing.companyName ? ` (${existing.companyName})` : ''}. Dùng khách hàng này?`,
            okText: 'Dùng khách này',
            cancelText: 'Sửa lại',
            onOk: () => onSaved(existing),
          });
          return;
        }
      }
      message.error(errorMessage(err));
    }
  }

  return (
    <Modal
      open={open}
      title={customer ? `Sửa ${customer.code}` : 'Thêm khách hàng'}
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={saving}
      destroyOnHidden
      onCancel={onClose}
      onOk={save}
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={customer ?? { name: initialName && !/^\d/.test(initialName) ? initialName : undefined, phone: initialName && /^\d/.test(initialName) ? initialName : undefined }}
      >
        <Form.Item name="name" label="Tên khách / người liên hệ" rules={[{ required: true, whitespace: true, message: 'Nhập tên' }]}>
          <Input id="cust-name" maxLength={200} autoFocus />
        </Form.Item>
        <Form.Item name="phone" label="Số điện thoại" rules={[{ required: true, message: 'Nhập số điện thoại' }]}>
          <Input id="cust-phone" maxLength={20} inputMode="tel" />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={15}>
            <Form.Item name="companyName" label="Công ty">
              <Input id="cust-company" maxLength={200} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={9}>
            <Form.Item name="taxCode" label="Mã số thuế">
              <Input id="cust-tax" maxLength={20} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="address" label="Địa chỉ giao hàng mặc định">
          <Input id="cust-address" maxLength={500} />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea id="cust-note" rows={2} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
