import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, Card, DatePicker, Flex, Form, Input, InputNumber, Modal, Popconfirm, Progress, Radio, Select, Space, Switch, Table, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState } from 'react';
import { useAccountingMutations, useAssets, useSuppliers } from '../../api/accounting';
import type { Schemas } from '../../api/client';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatVnd, vndInputProps } from '../../lib/format';
import { AccountingPage, COST_ACCOUNTS, monthLabel, PAY_METHOD, VAT_OPTIONS, type Period, type VatRate } from './common';

/** "TSCĐ & CCDC": fixed assets depreciated straight-line, tools allocated over their months */
export function AccountingAssetsPage() {
  const can = useCan();
  const [adding, setAdding] = useState(false);
  return (
    <AccountingPage
      title="TSCĐ & CCDC"
      extra={(p) => p.status === 'OPEN' && can('accounting.post') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>Thêm tài sản</Button>}
    >
      {(period) => (
        <>
          <Assets period={period} />
          {adding && <AssetModal period={period} onClose={() => setAdding(false)} />}
        </>
      )}
    </AccountingPage>
  );
}

function Assets({ period }: { period: Period }) {
  const { data, isFetching } = useAssets(period.id);
  const label = monthLabel(period.month);
  return (
    <Flex vertical gap={16}>
      <Card size="small" title={`Tài sản cố định (khấu hao kỳ ${label}: ${formatVnd(data?.depreciationVnd ?? 0)})`}>
        <AssetTable rows={data?.assets} loading={isFetching} period={period} />
      </Card>
      <Card size="small" title={`Công cụ dụng cụ (phân bổ kỳ ${label}: ${formatVnd(data?.allocationVnd ?? 0)})`}>
        <AssetTable rows={data?.tools} loading={isFetching} period={period} />
      </Card>
    </Flex>
  );
}

function AssetTable({ rows, loading, period }: { rows?: Schemas['AssetRowDto'][]; loading: boolean; period: Period }) {
  const can = useCan();
  const { message } = App.useApp();
  const { deleteAsset } = useAccountingMutations();
  return (
    <Table<Schemas['AssetRowDto']>
      rowKey="id"
      size="small"
      loading={loading}
      dataSource={rows}
      pagination={false}
      scroll={{ x: 1000 }}
      locale={{ emptyText: 'Chưa có' }}
      columns={[
        { title: 'Mã', dataIndex: 'code', width: 80 },
        { title: 'Tên', dataIndex: 'name' },
        { title: 'Nguyên giá', dataIndex: 'costVnd', width: 140, align: 'right', render: formatVnd },
        { title: 'Từ kỳ', dataIndex: 'startMonth', width: 90, render: monthLabel },
        { title: 'Tính vào', dataIndex: 'expenseAccount', width: 80 },
        { title: 'Mỗi tháng', dataIndex: 'monthlyVnd', width: 130, align: 'right', render: formatVnd },
        { title: 'Đã tính', key: 'c', width: 170, render: (_, r) => <Progress percent={Math.round((r.monthsCharged / r.months) * 100)} size="small" format={() => `${r.monthsCharged}/${r.months} th`} /> },
        { title: 'Luỹ kế', dataIndex: 'chargedVnd', width: 140, align: 'right', render: formatVnd },
        { title: 'Còn lại', dataIndex: 'remainingVnd', width: 140, align: 'right', render: formatVnd },
        {
          title: '',
          key: 'a',
          width: 50,
          render: (_, r) =>
            period.status === 'OPEN' &&
            can('accounting.post') && (
              <Popconfirm
                title={`Xoá ${r.code}?`}
                description="Chỉ xoá được tài sản chưa trích ở kỳ đã khoá. Bút toán mua (nếu có) cũng bị xoá."
                okText="Xoá"
                cancelText="Thôi"
                onConfirm={() => deleteAsset.mutate(r.id, { onSuccess: () => message.success('Đã xoá'), onError: (e) => message.error(errorMessage(e)) })}
              >
                <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Xoá ${r.code}`} />
              </Popconfirm>
            ),
        },
      ]}
    />
  );
}

interface AssetForm {
  kind: Schemas['AssetKind'];
  name: string;
  costVnd: number;
  start: Dayjs;
  months: number;
  expenseAccount: string;
  bought: boolean;
  date: Dayjs;
  method: Schemas['PayMethod'];
  vatRate: VatRate;
  supplierId?: string;
}

function AssetModal({ period, onClose }: { period: Period; onClose: () => void }) {
  const { message } = App.useApp();
  const { createAsset } = useAccountingMutations();
  const suppliers = useSuppliers();
  const [form] = Form.useForm<AssetForm>();
  const bought = Form.useWatch('bought', form) ?? true;
  const kind = Form.useWatch('kind', form) ?? 'FIXED_ASSET';
  const method = Form.useWatch('method', form);
  const date = dayjs().format('YYYY-MM') === period.month ? dayjs() : dayjs(`${period.month}-01`);
  return (
    <Modal
      open
      width={640}
      title="Thêm TSCĐ / CCDC"
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={createAsset.isPending}
      onCancel={onClose}
      destroyOnHidden
      onOk={() =>
        form.validateFields().then((v) =>
          createAsset.mutate(
            {
              kind: v.kind,
              name: v.name.trim(),
              costVnd: v.costVnd,
              startMonth: v.start.format('YYYY-MM'),
              months: v.months,
              expenseAccount: v.expenseAccount as Schemas['CreateAssetDto']['expenseAccount'],
              purchase: v.bought ? { date: v.date.format('YYYY-MM-DD'), method: v.method, vatRate: v.vatRate, supplierId: v.supplierId } : undefined,
            },
            { onSuccess: () => { message.success('Đã thêm'); onClose(); }, onError: (e) => message.error(errorMessage(e)) },
          ),
        )
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ kind: 'FIXED_ASSET', start: dayjs(`${period.month}-01`), months: 36, expenseAccount: '154', bought: true, date, method: 'BANK', vatRate: 8 }}
      >
        <Form.Item name="kind">
          <Radio.Group optionType="button" options={[{ value: 'FIXED_ASSET', label: 'Tài sản cố định (211 → 214)' }, { value: 'TOOL', label: 'Công cụ dụng cụ (242)' }]} />
        </Form.Item>
        <Form.Item name="name" label="Tên" rules={[{ required: true, whitespace: true, message: 'Nhập tên' }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Space wrap>
          <Form.Item name="costVnd" label="Nguyên giá (chưa thuế)" rules={[{ required: true, message: 'Nhập nguyên giá' }]}>
            <InputNumber {...vndInputProps} min={1} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="start" label={kind === 'TOOL' ? 'Phân bổ từ kỳ' : 'Khấu hao từ kỳ'} rules={[{ required: true }]}>
            <DatePicker picker="month" format="MM/YYYY" allowClear={false} />
          </Form.Item>
          <Form.Item name="months" label="Số tháng" rules={[{ required: true }]}>
            <InputNumber min={1} max={600} style={{ width: 100 }} />
          </Form.Item>
          <Form.Item name="expenseAccount" label="Tính vào chi phí">
            <Select options={COST_ACCOUNTS} style={{ width: 230 }} />
          </Form.Item>
        </Space>
        <Form.Item name="bought" valuePropName="checked" label="Mua trong kỳ (ghi bút toán mua)" extra="Tắt nếu tài sản đã có trước khi bắt đầu sổ: nguyên giá và hao mòn đã nằm trong số dư đầu kỳ.">
          <Switch />
        </Form.Item>
        {bought && (
          <Space wrap>
            <Form.Item name="date" label="Ngày mua" rules={[{ required: true }]}>
              <DatePicker format="DD/MM/YYYY" allowClear={false} />
            </Form.Item>
            <Form.Item name="method" label="Thanh toán">
              <Select style={{ width: 170 }} options={Object.entries(PAY_METHOD).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
            <Form.Item name="vatRate" label="Thuế GTGT">
              <Select style={{ width: 90 }} options={VAT_OPTIONS} />
            </Form.Item>
            <Form.Item name="supplierId" label="Nhà cung cấp" rules={[{ required: method === 'CREDIT', message: 'Mua chịu cần chọn nhà cung cấp' }]}>
              <Select allowClear showSearch optionFilterProp="label" style={{ width: 240 }} options={(suppliers.data ?? []).filter((s) => s.isActive).map((s) => ({ value: s.id, label: s.name }))} />
            </Form.Item>
          </Space>
        )}
        <Typography.Text type="secondary">Mỗi tháng trích đều; tháng cuối nhận phần lẻ cho tròn nguyên giá.</Typography.Text>
      </Form>
    </Modal>
  );
}
