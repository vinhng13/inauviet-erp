import { EditOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, Col, DatePicker, Flex, Form, Input, InputNumber, Modal, Radio, Row, Segmented, Select, Space, Statistic, Switch, Table, Tag, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAccountingMutations, useCashBook, useSuppliers } from '../../api/accounting';
import type { Schemas } from '../../api/client';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatVnd, vndInputProps } from '../../lib/format';
import { AccountingPage, COST_ACCOUNTS, money, monthLabel, PeriodClosedNote, VAT_OPTIONS, type Period } from './common';

type Account = 'all' | '111' | '112';

/** "Thu – chi": cash and bank book, expense vouchers and how each expense category splits */
export function AccountingCashPage() {
  const can = useCan();
  const [paying, setPaying] = useState(false);
  return (
    <AccountingPage
      title="Thu – chi"
      extra={(p) =>
        p.status === 'OPEN' && can('accounting.post') ? (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setPaying(true)}>
            Lập phiếu chi
          </Button>
        ) : null
      }
    >
      {(period) => (
        <>
          <CashBook period={period} />
          {paying && <CashPaymentModal period={period} onClose={() => setPaying(false)} />}
        </>
      )}
    </AccountingPage>
  );
}

function CashBook({ period }: { period: Period }) {
  const [account, setAccount] = useState<Account>('all');
  const { data, isFetching } = useCashBook(period.id, account);
  return (
    <Flex vertical gap={16}>
      <PeriodClosedNote period={period} />
      <Row gutter={[12, 12]}>
        {[
          ['Tồn đầu kỳ', data?.openingVnd],
          ['Tổng thu', data?.inVnd],
          ['Tổng chi', data?.outVnd],
          ['Tồn cuối kỳ', data?.closingVnd],
        ].map(([t, v]) => (
          <Col key={t as string} xs={12} md={6}>
            <Card size="small">
              <Statistic title={t as string} value={v === undefined ? '…' : formatVnd(v as number)} styles={{ content: { fontSize: 18 } }} />
            </Card>
          </Col>
        ))}
      </Row>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Segmented<Account>
          value={account}
          onChange={setAccount}
          options={[
            { value: 'all', label: 'Tiền mặt + ngân hàng' },
            { value: '111', label: 'Tiền mặt (111)' },
            { value: '112', label: 'Ngân hàng (112)' },
          ]}
        />
        <Typography.Text type="secondary">
          Khoản thu của khách ghi ở <Link to="/payments">Thanh toán & công nợ</Link> và tự vào sổ.
        </Typography.Text>
      </Flex>
      <Table<Schemas['CashRowDto']>
        rowKey={(r) => `${r.entryId}-${r.account}-${r.balanceVnd}`}
        size="small"
        loading={isFetching}
        dataSource={data?.rows}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
        locale={{ emptyText: `Chưa có thu chi trong kỳ ${monthLabel(period.month)}` }}
        columns={[
          { title: 'Ngày', dataIndex: 'date', width: 110, render: formatDate },
          { title: 'Chứng từ', dataIndex: 'code', width: 140 },
          { title: 'Diễn giải', key: 'd', render: (_, r) => <>{r.description}{r.orderCode && <Typography.Text type="secondary"> · {r.orderCode}</Typography.Text>}</> },
          { title: 'TK', dataIndex: 'account', width: 60 },
          { title: 'Thu', dataIndex: 'inVnd', width: 140, align: 'right', render: money },
          { title: 'Chi', dataIndex: 'outVnd', width: 140, align: 'right', render: money },
          { title: 'Tồn', dataIndex: 'balanceVnd', width: 150, align: 'right', render: formatVnd },
        ]}
      />
      <Categories categories={data?.categories ?? []} />
    </Flex>
  );
}

type Category = Schemas['CategorySumDto'];

function Categories({ categories }: { categories: Category[] }) {
  const can = useCan();
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  return (
    <Card
      size="small"
      title="Khoản mục chi phí"
      extra={can('accounting.close') && <Button size="small" icon={<PlusOutlined />} onClick={() => setEditing('new')}>Thêm khoản mục</Button>}
    >
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        Mỗi phiếu chi theo khoản mục được chia vào 154 (sản xuất chung), 6421 (bán hàng), 6422 (quản lý) theo tỷ lệ dưới đây.
      </Typography.Paragraph>
      <Table<Category>
        rowKey="id"
        size="small"
        dataSource={categories}
        pagination={false}
        scroll={{ x: 640 }}
        rowClassName={(c) => (c.isActive ? '' : 'row-voided')}
        columns={[
          { title: 'Khoản mục', dataIndex: 'name' },
          { title: 'Phân bổ', key: 's', render: (_, c) => <Space size={4} wrap>{c.split.map((p) => <Tag key={p.account}>{p.account}: {p.percent}%</Tag>)}</Space> },
          { title: 'Đã chi trong kỳ', dataIndex: 'amountVnd', width: 160, align: 'right', render: money },
          {
            title: '',
            key: 'a',
            width: 60,
            render: (_, c) => can('accounting.close') && <Button size="small" type="text" icon={<EditOutlined />} aria-label={`Sửa ${c.name}`} onClick={() => setEditing(c)} />,
          },
        ]}
      />
      {editing && <CategoryModal category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function CategoryModal({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const { message } = App.useApp();
  const { saveCategory } = useAccountingMutations();
  const [form] = Form.useForm<Schemas['SaveCategoryDto']>();
  const split = Form.useWatch('split', form) ?? [];
  const total = split.reduce((s, p) => s + (p?.percent ?? 0), 0);
  return (
    <Modal
      open
      title={category ? `Sửa khoản mục: ${category.name}` : 'Thêm khoản mục chi phí'}
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={saveCategory.isPending}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then((body) =>
          saveCategory.mutate({ id: category?.id, body }, { onSuccess: () => { message.success('Đã lưu khoản mục'); onClose(); }, onError: (e) => message.error(errorMessage(e)) }),
        )
      }
      destroyOnHidden
    >
      <Form form={form} layout="vertical" initialValues={category ?? { name: '', split: [{ account: '6422', percent: 100 }], isActive: true }}>
        <Form.Item name="name" label="Tên khoản mục" rules={[{ required: true, whitespace: true, message: 'Nhập tên' }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.List name="split">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f) => (
                <Space key={f.key} align="baseline">
                  <Form.Item name={[f.name, 'account']} rules={[{ required: true, message: 'Chọn TK' }]}>
                    <Select options={COST_ACCOUNTS} style={{ width: 230 }} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'percent']} rules={[{ required: true, message: 'Nhập %' }]}>
                    <InputNumber min={0} max={100} suffix="%" style={{ width: 110 }} />
                  </Form.Item>
                  {fields.length > 1 && <MinusCircleOutlined onClick={() => remove(f.name)} aria-label="Bỏ dòng" />}
                </Space>
              ))}
              {fields.length < 3 && <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ account: undefined, percent: 0 })}>Thêm tài khoản</Button>}
            </>
          )}
        </Form.List>
        <Typography.Paragraph type={total === 100 ? 'secondary' : 'danger'} style={{ marginTop: 8 }}>
          Tổng: {total}% {total !== 100 && '(phải bằng 100%)'}
        </Typography.Paragraph>
        <Form.Item name="isActive" label="Đang dùng" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

interface PaymentForm {
  target: 'expense' | 'supplier';
  date: Dayjs;
  description: string;
  categoryId?: string;
  supplierId?: string;
  amountVnd: number;
  vatRate: number;
  method: 'CASH' | 'BANK';
}

function CashPaymentModal({ period, onClose }: { period: Period; onClose: () => void }) {
  const { message } = App.useApp();
  const { createCashPayment } = useAccountingMutations();
  const cash = useCashBook(period.id, 'all');
  const suppliers = useSuppliers();
  const [form] = Form.useForm<PaymentForm>();
  const target = Form.useWatch('target', form) ?? 'expense';
  const amount = Form.useWatch('amountVnd', form) ?? 0;
  const vat = Form.useWatch('vatRate', form) ?? 0;
  const defaultDate = dayjs().format('YYYY-MM') === period.month ? dayjs() : dayjs(`${period.month}-01`).endOf('month');
  return (
    <Modal
      open
      title="Lập phiếu chi"
      okText="Ghi phiếu chi"
      cancelText="Đóng"
      confirmLoading={createCashPayment.isPending}
      onCancel={onClose}
      destroyOnHidden
      onOk={() =>
        form.validateFields().then((v) =>
          createCashPayment.mutate(
            {
              date: v.date.format('YYYY-MM-DD'),
              description: v.description.trim(),
              categoryId: v.target === 'expense' ? v.categoryId : undefined,
              supplierId: v.target === 'supplier' ? v.supplierId : undefined,
              amountVnd: v.amountVnd,
              vatRate: (v.target === 'expense' ? v.vatRate : 0) as Schemas['CreateCashPaymentDto']['vatRate'],
              method: v.method,
            },
            { onSuccess: () => { message.success('Đã ghi phiếu chi'); onClose(); }, onError: (e) => message.error(errorMessage(e)) },
          ),
        )
      }
    >
      <Form form={form} layout="vertical" initialValues={{ target: 'expense', date: defaultDate, vatRate: 0, method: 'CASH' }}>
        <Form.Item name="target">
          <Radio.Group optionType="button" options={[{ value: 'expense', label: 'Chi phí' }, { value: 'supplier', label: 'Trả nợ nhà cung cấp' }]} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="date" label="Ngày chi" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="method" label="Chi bằng">
            <Radio.Group options={[{ value: 'CASH', label: 'Tiền mặt' }, { value: 'BANK', label: 'Chuyển khoản' }]} />
          </Form.Item>
        </Space>
        {target === 'expense' ? (
          <Form.Item name="categoryId" label="Khoản mục" rules={[{ required: true, message: 'Chọn khoản mục' }]}>
            <Select
              options={(cash.data?.categories ?? []).filter((c) => c.isActive).map((c) => ({ value: c.id, label: `${c.name} (${c.split.map((p) => `${p.account} ${p.percent}%`).join(', ')})` }))}
            />
          </Form.Item>
        ) : (
          <Form.Item name="supplierId" label="Nhà cung cấp" rules={[{ required: true, message: 'Chọn nhà cung cấp' }]}>
            <Select showSearch optionFilterProp="label" options={(suppliers.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code} · ${s.name}` }))} />
          </Form.Item>
        )}
        <Form.Item name="description" label="Diễn giải" rules={[{ required: true, whitespace: true, message: 'Nhập diễn giải' }]}>
          <Input maxLength={300} placeholder={target === 'expense' ? 'Tiền điện tháng 10' : 'Trả tiền decal PN-2610-0003'} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="amountVnd" label={target === 'expense' ? 'Số tiền trước thuế' : 'Số tiền'} rules={[{ required: true, message: 'Nhập số tiền' }]}>
            <InputNumber {...vndInputProps} min={1} style={{ width: 200 }} />
          </Form.Item>
          {target === 'expense' && (
            <Form.Item name="vatRate" label="Thuế GTGT">
              <Select options={VAT_OPTIONS} style={{ width: 100 }} />
            </Form.Item>
          )}
        </Space>
        {target === 'expense' && vat > 0 && (
          <Typography.Text type="secondary">
            Thuế {formatVnd(Math.round((amount * vat) / 100))} · tổng chi {formatVnd(amount + Math.round((amount * vat) / 100))}
          </Typography.Text>
        )}
      </Form>
    </Modal>
  );
}
