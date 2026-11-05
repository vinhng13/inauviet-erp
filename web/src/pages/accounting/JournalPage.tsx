import { DeleteOutlined, EditOutlined, MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { App, Button, DatePicker, Flex, Form, Input, InputNumber, Modal, Popconfirm, Segmented, Space, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useMemo, useState } from 'react';
import { useAccountingMutations, useJournal } from '../../api/accounting';
import type { Schemas } from '../../api/client';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDate, formatVnd, vndInputProps } from '../../lib/format';
import { AccountingPage, AccountSelect, Balance, money, PeriodClosedNote, type Period } from './common';

type Entry = Schemas['JournalEntryDto'];

const KIND_LABEL: Record<Schemas['EntryKind'], string> = {
  CUSTOMER_RECEIPT: 'Thu tiền',
  RECEIPT_VOID: 'Huỷ thu',
  REVENUE: 'Doanh thu',
  COGS: 'Giá vốn',
  PURCHASE: 'Nhập kho',
  ISSUE: 'Xuất kho',
  EXPENSE: 'Chi phí',
  SUPPLIER_PAYMENT: 'Trả NCC',
  ASSET_PURCHASE: 'Mua tài sản',
  DEPRECIATION: 'Khấu hao',
  ALLOCATION: 'Phân bổ',
  VAT_OFFSET: 'Khấu trừ thuế',
  CLOSING: 'Kết chuyển',
  MANUAL: 'Bút toán khác',
};

/** "Sổ & bút toán": general journal, trial balance, manual entries and corrections */
export function AccountingJournalPage() {
  const can = useCan();
  const [editing, setEditing] = useState<Entry | 'new' | null>(null);
  return (
    <AccountingPage
      title="Sổ & bút toán"
      extra={(p) => p.status === 'OPEN' && can('accounting.post') && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>Bút toán khác</Button>}
    >
      {(period) => (
        <>
          <Journal period={period} onEdit={setEditing} />
          {editing && <EntryModal period={period} entry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
        </>
      )}
    </AccountingPage>
  );
}

function Journal({ period, onEdit }: { period: Period; onEdit: (e: Entry) => void }) {
  const can = useCan();
  const { message } = App.useApp();
  const { data, isFetching } = useJournal(period.id);
  const { deleteEntry } = useAccountingMutations();
  const [kind, setKind] = useState<'all' | 'auto' | 'manual' | 'closing'>('all');
  const entries = useMemo(
    () =>
      (data?.entries ?? []).filter((e) =>
        kind === 'all' ? true : kind === 'manual' ? e.source === 'MANUAL' || e.edited : kind === 'closing' ? ['COGS', 'DEPRECIATION', 'ALLOCATION', 'VAT_OFFSET', 'CLOSING'].includes(e.kind) : e.source === 'AUTO',
      ),
    [data, kind],
  );

  return (
    <Flex vertical gap={12}>
      <PeriodClosedNote period={period} />
      <Tabs
        items={[
          {
            key: 'journal',
            label: `Nhật ký chung (${data?.entries.length ?? 0})`,
            children: (
              <Flex vertical gap={8}>
                <Segmented
                  value={kind}
                  onChange={setKind}
                  options={[
                    { value: 'all', label: 'Tất cả' },
                    { value: 'auto', label: 'Tự động' },
                    { value: 'manual', label: 'Nhập tay / đã sửa' },
                    { value: 'closing', label: 'Cuối kỳ' },
                  ]}
                />
                <Table<Entry>
                  rowKey="id"
                  size="small"
                  loading={isFetching}
                  dataSource={entries}
                  pagination={{ pageSize: 50, hideOnSinglePage: true }}
                  scroll={{ x: 1000 }}
                  expandable={{ expandRowByClick: true, expandedRowRender: (e) => <EntryLines entry={e} /> }}
                  columns={[
                    { title: 'Ngày', dataIndex: 'date', width: 105, render: formatDate },
                    { title: 'Số', dataIndex: 'code', width: 150 },
                    {
                      title: 'Diễn giải',
                      key: 'd',
                      render: (_, e) => (
                        <>
                          {e.description}
                          {e.orderCode && <Typography.Text type="secondary"> · {e.orderCode}</Typography.Text>}
                          {e.note && <div style={{ fontSize: 12, color: '#d48806' }}>{e.note}</div>}
                        </>
                      ),
                    },
                    {
                      title: 'Loại',
                      key: 'k',
                      width: 170,
                      render: (_, e) => (
                        <Space size={4} wrap>
                          <Tag color={e.source === 'MANUAL' ? 'purple' : undefined}>{KIND_LABEL[e.kind]}</Tag>
                          {e.edited && (
                            <Tooltip title={`${e.editedByName ?? ''}: ${e.editReason ?? ''}`}>
                              <Tag color="orange">đã sửa</Tag>
                            </Tooltip>
                          )}
                        </Space>
                      ),
                    },
                    { title: 'Định khoản', key: 'l', width: 230, render: (_, e) => <Typography.Text style={{ fontSize: 12 }}>{summarize(e.lines)}</Typography.Text> },
                    { title: 'Số tiền', dataIndex: 'totalVnd', width: 130, align: 'right', render: formatVnd },
                    {
                      title: '',
                      key: 'a',
                      width: 80,
                      render: (_, e) => (
                        <Space size={0} onClick={(ev) => ev.stopPropagation()}>
                          {e.canEdit && can(e.source === 'MANUAL' ? 'accounting.post' : 'accounting.close') && (
                            <Button size="small" type="text" icon={<EditOutlined />} aria-label={`Sửa ${e.code}`} onClick={() => onEdit(e)} />
                          )}
                          {e.canDelete && can('accounting.post') && (
                            <Popconfirm
                              title={`Xoá ${e.code}?`}
                              description={e.source === 'MANUAL' ? undefined : 'Chứng từ gốc (phiếu nhập/xuất/chi, tài sản) cũng bị xoá.'}
                              okText="Xoá"
                              cancelText="Thôi"
                              onConfirm={() => deleteEntry.mutate(e.id, { onSuccess: () => message.success('Đã xoá'), onError: (err) => message.error(errorMessage(err)) })}
                            >
                              <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={`Xoá ${e.code}`} />
                            </Popconfirm>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                />
              </Flex>
            ),
          },
          {
            key: 'tb',
            label: 'Cân đối số phát sinh',
            children: (
              <Table<Schemas['TrialBalanceRowDto']>
                rowKey="account"
                size="small"
                loading={isFetching}
                dataSource={data?.trialBalance}
                pagination={false}
                scroll={{ x: 900 }}
                columns={[
                  { title: 'TK', dataIndex: 'account', width: 80 },
                  { title: 'Tên tài khoản', dataIndex: 'name' },
                  { title: 'Số dư đầu kỳ', dataIndex: 'openingVnd', width: 170, align: 'right', render: (v: number) => <Balance value={v} /> },
                  { title: 'Phát sinh Nợ', dataIndex: 'debitVnd', width: 150, align: 'right', render: money },
                  { title: 'Phát sinh Có', dataIndex: 'creditVnd', width: 150, align: 'right', render: money },
                  { title: 'Số dư cuối kỳ', dataIndex: 'closingVnd', width: 170, align: 'right', render: (v: number) => <Balance value={v} /> },
                ]}
                summary={(rows) => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={3}><strong>Tổng phát sinh</strong></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right"><strong>{formatVnd(rows.reduce((s, r) => s + r.debitVnd, 0))}</strong></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right"><strong>{formatVnd(rows.reduce((s, r) => s + r.creditVnd, 0))}</strong></Table.Summary.Cell>
                    <Table.Summary.Cell index={5} />
                  </Table.Summary.Row>
                )}
              />
            ),
          },
        ]}
      />
    </Flex>
  );
}

function summarize(lines: Schemas['JournalLineDto'][]) {
  const dr = [...new Set(lines.filter((l) => l.debitVnd).map((l) => l.account))].join(', ');
  const cr = [...new Set(lines.filter((l) => l.creditVnd).map((l) => l.account))].join(', ');
  return `Nợ ${dr} / Có ${cr}`;
}

function EntryLines({ entry }: { entry: Entry }) {
  const table = (lines: Schemas['JournalLineDto'][]) => (
    <Table<Schemas['JournalLineDto']>
      rowKey={(l) => `${l.account}-${l.debitVnd}-${l.creditVnd}`}
      size="small"
      pagination={false}
      dataSource={lines}
      columns={[
        { title: 'Tài khoản', key: 'a', render: (_, l) => <span style={{ paddingInlineStart: l.creditVnd ? 24 : 0 }}>{l.account} · {l.accountName}</span> },
        { title: 'Nợ', dataIndex: 'debitVnd', width: 150, align: 'right', render: money },
        { title: 'Có', dataIndex: 'creditVnd', width: 150, align: 'right', render: money },
      ]}
    />
  );
  return (
    <Flex vertical gap={8} style={{ maxWidth: 720 }}>
      {table(entry.lines)}
      {entry.originalLines && (
        <>
          <Typography.Text type="secondary">
            Bút toán gốc trước khi sửa ({entry.editedByName}: {entry.editReason})
          </Typography.Text>
          {table(entry.originalLines)}
        </>
      )}
    </Flex>
  );
}

interface EntryForm {
  date: Dayjs;
  description: string;
  reason?: string;
  lines: Array<{ account?: string; debitVnd?: number; creditVnd?: number }>;
}

function EntryModal({ period, entry, onClose }: { period: Period; entry: Entry | null; onClose: () => void }) {
  const { message } = App.useApp();
  const { createEntry, updateEntry } = useAccountingMutations();
  const [form] = Form.useForm<EntryForm>();
  const lines = Form.useWatch('lines', form) ?? [];
  const debit = lines.reduce((s, l) => s + (l?.debitVnd ?? 0), 0);
  const credit = lines.reduce((s, l) => s + (l?.creditVnd ?? 0), 0);
  const auto = !!entry && entry.source === 'AUTO';
  const saving = createEntry.isPending || updateEntry.isPending;
  const defaultDate = dayjs().format('YYYY-MM') === period.month ? dayjs() : dayjs(`${period.month}-01`).endOf('month');
  const submit = (v: EntryForm) => {
    const body = { lines: v.lines.map((l) => ({ account: l.account!, debitVnd: l.debitVnd ?? 0, creditVnd: l.creditVnd ?? 0 })) };
    const done = { onSuccess: () => { message.success('Đã lưu bút toán'); onClose(); }, onError: (e: unknown) => message.error(errorMessage(e)) };
    if (entry) updateEntry.mutate({ id: entry.id, body: { ...body, description: auto ? undefined : v.description.trim(), reason: auto ? v.reason?.trim() : undefined } }, done);
    else createEntry.mutate({ ...body, date: v.date.format('YYYY-MM-DD'), description: v.description.trim() }, done);
  };
  return (
    <Modal
      open
      width={760}
      title={entry ? `Sửa bút toán ${entry.code}` : 'Bút toán khác (PKT)'}
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={saving}
      okButtonProps={{ disabled: debit !== credit || debit === 0 }}
      onCancel={onClose}
      destroyOnHidden
      onOk={() => form.validateFields().then(submit)}
    >
      {auto && (
        <Typography.Paragraph type="warning">
          Đây là bút toán tự động. Bút toán gốc được giữ lại để đối chiếu; cần ghi lý do sửa.
        </Typography.Paragraph>
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={
          entry
            ? { date: dayjs(entry.date), description: entry.description, lines: entry.lines.map((l) => ({ account: l.account, debitVnd: l.debitVnd || undefined, creditVnd: l.creditVnd || undefined })) }
            : { date: defaultDate, lines: [{}, {}] }
        }
      >
        <Space wrap align="start">
          <Form.Item name="date" label="Ngày" rules={[{ required: true }]}>
            <DatePicker format="DD/MM/YYYY" allowClear={false} disabled={!!entry} />
          </Form.Item>
          <Form.Item name="description" label="Diễn giải" rules={[{ required: true, whitespace: true, message: 'Nhập diễn giải' }]}>
            <Input maxLength={300} style={{ width: 420 }} disabled={auto} />
          </Form.Item>
        </Space>
        <Form.List name="lines">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f, i) => (
                <Space key={f.key} align="baseline" wrap>
                  <Form.Item name={[f.name, 'account']} label={i === 0 ? 'Tài khoản' : undefined} rules={[{ required: true, message: 'Chọn TK' }]}>
                    <AccountSelect style={{ width: 300 }} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'debitVnd']} label={i === 0 ? 'Nợ' : undefined}>
                    <InputNumber {...vndInputProps} style={{ width: 160 }} />
                  </Form.Item>
                  <Form.Item name={[f.name, 'creditVnd']} label={i === 0 ? 'Có' : undefined}>
                    <InputNumber {...vndInputProps} style={{ width: 160 }} />
                  </Form.Item>
                  {fields.length > 2 && <MinusCircleOutlined onClick={() => remove(f.name)} aria-label="Bỏ dòng" />}
                </Space>
              ))}
              <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({})} style={{ marginBottom: 12 }}>
                Thêm dòng
              </Button>
            </>
          )}
        </Form.List>
        <div>
          Tổng Nợ <strong>{formatVnd(debit)}</strong> · Tổng Có <strong>{formatVnd(credit)}</strong>{' '}
          {debit !== credit && <Typography.Text type="danger">· lệch {formatVnd(Math.abs(debit - credit))}</Typography.Text>}
        </div>
        {auto && (
          <Form.Item name="reason" label="Lý do sửa" rules={[{ required: true, whitespace: true, message: 'Nhập lý do' }]} style={{ marginTop: 12 }}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}
