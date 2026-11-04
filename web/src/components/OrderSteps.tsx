import { CheckCircleOutlined, LockOutlined, PrinterOutlined, SendOutlined } from '@ant-design/icons';
import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Empty,
  Flex,
  Form,
  Input,
  Modal,
  Radio,
  Segmented,
  Select,
  Space,
  Steps,
  Table,
  Tag,
  Typography,
} from 'antd';
import dayjs from 'dayjs';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Schemas } from '../api/client';
import { useDesigners, useOrderActions } from '../api/hooks';
import { useCan } from '../lib/access';
import { errorMessage } from '../lib/errors';
import { formatDate, formatDateTime, formatQty, formatVnd } from '../lib/format';
import { APPROVAL_CHANNELS, DESIGN_FEEDBACK, PRODUCTION_STAGE, PRODUCTION_STAGES, STATUS_STEP, STEPS } from '../lib/status';
import { openDoc } from '../lib/download';
import { ReasonModal } from './ReasonModal';

type Order = Schemas['OrderDetailDto'];
type Version = Schemas['DesignVersionDto'];

/** Opens the PDF of a document in a new tab, where the browser prints or saves it. */
export const printDoc = openDoc;

/** Furthest step the order got to (a cancelled order keeps the step it was cancelled at). */
function reachedStep(o: Order): number {
  if (o.status !== 'CANCELLED') return Math.min(STATUS_STEP[o.status], 6);
  if (o.production?.doneAt || o.deliveries.some((d) => d.status === 'DELIVERED')) return 6;
  if (o.production) return 5;
  if (o.design.approvedAt) return 4;
  if (o.confirmedAt && o.needsDesign) return 3;
  return 2;
}

/** The 6-step stepper and the panel of the selected step. */
export function OrderSteps({ order }: { order: Order }) {
  const reached = reachedStep(order);
  const [view, setView] = useState<number | null>(null);
  const selected = view ?? reached;
  const skipDesign = order.needsDesign === false;
  const done = order.status === 'COMPLETED';

  const items = STEPS.map((s) => {
    const skipped = skipDesign && (s.n === 3 || s.n === 4);
    const status: 'finish' | 'process' | 'wait' = done || s.n < reached ? 'finish' : s.n === reached ? 'process' : 'wait';
    const description = skipped ? 'Bỏ qua · file sẵn' : status === 'finish' ? 'Xong' : status === 'process' ? 'Đang ở bước này' : 'Chưa tới';
    return { title: s.label, content: description, status: order.status === 'CANCELLED' && status === 'process' ? ('error' as const) : status, disabled: false };
  });

  return (
    <Card size="small">
      <Steps
        size="small"
        current={selected - 1}
        onChange={(i) => setView(i + 1)}
        items={items.map((it, i) => ({ ...it, style: i + 1 === selected ? undefined : { opacity: 0.85 } }))}
        responsive
        style={{ marginBottom: 16 }}
      />
      <StepPanel order={order} step={selected} reached={reached} />
    </Card>
  );
}

function StepPanel({ order, step, reached }: { order: Order; step: number; reached: number }) {
  const title = STEPS[step - 1];
  const skipped = order.needsDesign === false && (step === 3 || step === 4);
  let body: ReactNode;
  if (step > reached && order.status !== 'COMPLETED') body = <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Đơn chưa tới bước này" />;
  else if (skipped) body = <Alert type="info" showIcon title="Khách có file in sẵn, đơn bỏ qua bước thiết kế và chuyển thẳng sang sản xuất." />;
  else if (step === 1) body = <QuoteStep order={order} />;
  else if (step === 2) body = <ConfirmStep order={order} />;
  else if (step === 3) body = <DesignStep order={order} />;
  else if (step === 4) body = <FinalizeStep order={order} />;
  else if (step === 5) body = <ProductionStep order={order} />;
  else body = <AcceptanceStep order={order} />;
  return (
    <div style={{ borderTop: '1px solid #eef1f4', paddingTop: 12 }}>
      <Typography.Text strong style={{ fontSize: 15 }}>
        Bước {step} · {title.label}
      </Typography.Text>
      <Typography.Text type="secondary"> — {title.title}</Typography.Text>
      <div style={{ marginTop: 12 }}>{body}</div>
    </div>
  );
}

function useRun() {
  const { message } = App.useApp();
  return async (p: Promise<unknown>, ok: string): Promise<boolean> => {
    try {
      await p;
      message.success(ok);
      return true;
    } catch (err) {
      message.error(errorMessage(err));
      return false;
    }
  };
}

function NoPermission({ text }: { text: string }) {
  return <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{text}</Typography.Paragraph>;
}

// ───────────── Step 1 ─────────────

function QuoteStep({ order }: { order: Order }) {
  const can = useCan();
  if (!order.quote) return <Alert type="info" showIcon title="Đơn nhập trực tiếp, không đi từ báo giá." />;
  return (
    <Flex wrap gap={12} align="center">
      <span>
        Chốt từ báo giá <Link to={`/quotes/${order.quote.id}`}>{order.quote.code}</Link>
        {can('money.view') && order.quote.totalVnd !== undefined ? ` · ${formatVnd(order.quote.totalVnd)}` : ''}
      </span>
      {can('quotes.view') && can('money.view') && (
        <Button size="small" icon={<PrinterOutlined />} onClick={() => printDoc('quote', order.quote!.id)}>
          In báo giá
        </Button>
      )}
    </Flex>
  );
}

// ───────────── Step 2 ─────────────

function ConfirmStep({ order }: { order: Order }) {
  const can = useCan();
  const run = useRun();
  const actions = useOrderActions(order.id);
  const [needs, setNeeds] = useState<boolean | null>(order.needsDesign);
  const active = order.status === 'CONFIRMED';

  if (!active) {
    return (
      <Descriptions
        size="small"
        column={{ xs: 1, sm: 2 }}
        items={[
          { label: 'Xác nhận lúc', children: formatDateTime(order.confirmedAt) },
          { label: 'Thiết kế', children: order.needsDesign === false ? 'Khách có file sẵn' : order.needsDesign ? 'Cần thiết kế' : '—' },
        ]}
      />
    );
  }
  if (!can('orders.update')) return <NoPermission text="Đơn đang chờ kinh doanh xác nhận hàng hoá với khách." />;
  return (
    <Flex vertical gap={12}>
      <Typography.Paragraph style={{ margin: 0 }}>
        Kiểm tra hàng hoá với khách (đổi sản phẩm, số lượng ở “Khác → Sửa hàng hoá”; mọi thay đổi so với báo giá được ghi lại). Sau đó chọn đơn có cần thiết kế không.
      </Typography.Paragraph>
      <Radio.Group
        value={needs}
        onChange={(e) => setNeeds(e.target.value as boolean)}
        options={[
          { value: true, label: 'Cần thiết kế (bước 3–4)' },
          { value: false, label: 'Khách có file in sẵn → sản xuất luôn' },
        ]}
      />
      <Space wrap>
        <Button
          type="primary"
          icon={<CheckCircleOutlined />}
          disabled={needs === null}
          loading={actions.confirm.isPending}
          onClick={() => needs !== null && run(actions.confirm.mutateAsync(needs), needs ? 'Đã xác nhận, chuyển sang thiết kế' : 'Đã xác nhận, đã tạo lệnh sản xuất')}
        >
          Xác nhận đơn
        </Button>
        {can('money.view') && (
          <Button icon={<PrinterOutlined />} onClick={() => printDoc('order', order.id)}>
            In đơn hàng để khách ký
          </Button>
        )}
      </Space>
    </Flex>
  );
}

// ───────────── Step 3 ─────────────

function VersionsTable({ versions }: { versions: Version[] }) {
  if (versions.length === 0) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa gửi maket nào" />;
  return (
    <Table<Version>
      size="small"
      rowKey="id"
      pagination={false}
      dataSource={[...versions].reverse()}
      columns={[
        { title: 'Bản', dataIndex: 'version', width: 60, render: (v: number) => <strong>v{v}</strong> },
        { title: 'Gửi lúc', dataIndex: 'sentAt', width: 150, render: formatDateTime },
        { title: 'Nội dung', dataIndex: 'note', render: (v: string | null, r) => <>{v ?? '—'}<div style={{ fontSize: 12, opacity: 0.65 }}>{r.createdByName}</div></> },
        {
          title: 'Phản hồi của khách',
          key: 'fb',
          render: (_, r) => (
            <>
              <Tag color={DESIGN_FEEDBACK[r.feedback].color}>{DESIGN_FEEDBACK[r.feedback].label}</Tag>
              {r.feedbackNote && <div style={{ fontSize: 13 }}>{r.feedbackNote}</div>}
              {r.feedbackAt && <div style={{ fontSize: 12, opacity: 0.65 }}>{formatDateTime(r.feedbackAt)}</div>}
            </>
          ),
        },
      ]}
    />
  );
}

function DesignerPicker({ order, disabled }: { order: Order; disabled: boolean }) {
  const can = useCan();
  const run = useRun();
  const actions = useOrderActions(order.id);
  const { data } = useDesigners(can('design.assign'));
  if (!can('design.assign') || disabled) return <span>{order.design.designer?.fullName ?? 'Chưa giao'}</span>;
  return (
    <Select
      id="designer-select"
      style={{ minWidth: 220 }}
      allowClear
      placeholder="Chọn người thiết kế"
      value={order.design.designer?.id}
      loading={actions.assignDesigner.isPending}
      options={[
        ...(data ?? []).map((d) => ({ value: d.id, label: d.fullName, openOrders: d.openOrders })),
        // Keep the current designer selectable even if their account no longer does design work
        ...(order.design.designer && !(data ?? []).some((d) => d.id === order.design.designer!.id)
          ? [{ value: order.design.designer.id, label: order.design.designer.fullName, openOrders: 0 }]
          : []),
      ]}
      optionRender={(o) => (
        <Flex justify="space-between" gap={8}>
          <span>{o.data.label}</span>
          {o.data.openOrders ? <Typography.Text type="secondary">{o.data.openOrders} đơn</Typography.Text> : null}
        </Flex>
      )}
      onChange={(v?: string) => run(actions.assignDesigner.mutateAsync(v ?? null), v ? 'Đã giao thiết kế' : 'Đã bỏ người thiết kế')}
    />
  );
}

function DesignStep({ order }: { order: Order }) {
  const can = useCan();
  const run = useRun();
  const actions = useOrderActions(order.id);
  const [modal, setModal] = useState<null | 'send' | 'changes' | 'approve'>(null);
  const versions = order.design.versions;
  const last = versions[versions.length - 1];
  const active = order.status === 'DESIGNING';
  const canWork = can('design.work') && active;
  const waiting = last?.feedback === 'PENDING';
  const next = (last?.version ?? 0) + 1;

  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={12} align="center">
        <Typography.Text type="secondary">Người thiết kế:</Typography.Text>
        <DesignerPicker order={order} disabled={!active && order.status !== 'DESIGN_FINALIZING'} />
        {versions.length > 1 && <Tag>{versions.filter((v) => v.feedback === 'CHANGES_REQUESTED').length} lần sửa</Tag>}
      </Flex>
      <VersionsTable versions={versions} />
      {active && !can('design.work') && <NoPermission text="Chỉ nhóm Thiết kế ghi được maket và phản hồi của khách." />}
      {canWork && (
        <Space wrap>
          {!waiting && (
            <Button type="primary" icon={<SendOutlined />} onClick={() => setModal('send')}>
              Đã gửi maket v{next}
            </Button>
          )}
          {waiting && (
            <>
              <Button onClick={() => setModal('changes')}>Khách yêu cầu sửa v{last.version}</Button>
              <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => setModal('approve')}>
                Khách duyệt v{last.version}
              </Button>
            </>
          )}
          {versions.length > 0 && (
            <Button icon={<PrinterOutlined />} onClick={() => printDoc('design', order.id)}>
              In phiếu duyệt thiết kế
            </Button>
          )}
        </Space>
      )}

      <NoteModal
        open={modal === 'send'}
        title={`Ghi nhận đã gửi maket v${next}`}
        label="Nội dung / kênh gửi"
        placeholder={next === 1 ? 'Gửi maket qua Zalo' : 'Gửi bản sửa qua Zalo'}
        loading={actions.sendDesign.isPending}
        onCancel={() => setModal(null)}
        onSubmit={async (note) => (await run(actions.sendDesign.mutateAsync({ note }), `Đã ghi nhận gửi maket v${next}`)) && setModal(null)}
      />
      <NoteModal
        open={modal === 'changes'}
        title={`Khách yêu cầu sửa v${last?.version ?? ''}`}
        label="Khách muốn sửa gì"
        loading={actions.designFeedback.isPending}
        onCancel={() => setModal(null)}
        onSubmit={async (note) =>
          last && (await run(actions.designFeedback.mutateAsync({ versionId: last.id, body: { approved: false, note } }), 'Đã ghi yêu cầu sửa')) && setModal(null)
        }
      />
      {modal === 'approve' && last && (
        <ApproveModal
          order={order}
          version={last}
          loading={actions.designFeedback.isPending}
          onCancel={() => setModal(null)}
          onSubmit={async (body) => (await run(actions.designFeedback.mutateAsync({ versionId: last.id, body: { approved: true, ...body } }), `Khách đã duyệt v${last.version}`)) && setModal(null)}
        />
      )}
    </Flex>
  );
}

function NoteModal(props: { open: boolean; title: string; label: string; placeholder?: string; loading: boolean; onCancel: () => void; onSubmit: (note?: string) => void }) {
  const [note, setNote] = useState('');
  return (
    <Modal
      open={props.open}
      title={props.title}
      okText="Lưu"
      cancelText="Đóng"
      confirmLoading={props.loading}
      destroyOnHidden
      afterOpenChange={(o) => o && setNote('')}
      onCancel={props.onCancel}
      onOk={() => props.onSubmit(note.trim() || undefined)}
    >
      <label htmlFor="note-modal-text">{props.label}</label>
      <Input.TextArea id="note-modal-text" rows={3} value={note} placeholder={props.placeholder} onChange={(e) => setNote(e.target.value)} maxLength={1000} style={{ marginTop: 6 }} />
    </Modal>
  );
}

function ApproveModal({ order, version, loading, onCancel, onSubmit }: { order: Order; version: Version; loading: boolean; onCancel: () => void; onSubmit: (b: { channel: string; approvedByName: string; note?: string }) => void }) {
  const [form] = Form.useForm<{ channel: string; approvedByName: string; note?: string }>();
  return (
    <Modal open title={`Khách duyệt maket v${version.version}`} okText="Xác nhận duyệt" cancelText="Đóng" confirmLoading={loading} onCancel={onCancel} onOk={() => form.validateFields().then((v) => onSubmit({ ...v, note: v.note?.trim() || undefined }))}>
      <Form form={form} layout="vertical" initialValues={{ channel: 'Zalo', approvedByName: order.customer.name }}>
        <Form.Item name="channel" label="Khách duyệt qua" rules={[{ required: true }]}>
          <Segmented id="approve-channel" options={APPROVAL_CHANNELS} />
        </Form.Item>
        <Form.Item name="approvedByName" label="Người duyệt bên khách" rules={[{ required: true, whitespace: true, message: 'Nhập tên người duyệt' }]}>
          <Input id="approve-by" maxLength={200} />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea id="approve-note" rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ───────────── Step 4 ─────────────

function FinalizeStep({ order }: { order: Order }) {
  const can = useCan();
  const run = useRun();
  const actions = useOrderActions(order.id);
  const [unapprove, setUnapprove] = useState(false);
  const d = order.design;
  const active = order.status === 'DESIGN_FINALIZING';
  const canWork = active && can('design.work');

  return (
    <Flex vertical gap={12}>
      <Descriptions
        size="small"
        column={{ xs: 1, sm: 2, lg: 3 }}
        items={[
          { label: 'Bản duyệt', children: d.approvedVersion ? `Maket v${d.approvedVersion}` : '—' },
          { label: 'Ngày duyệt', children: formatDateTime(d.approvedAt) },
          { label: 'Người thiết kế', children: d.designer?.fullName ?? '—' },
          {
            label: 'Kênh duyệt',
            children: canWork ? (
              <Segmented
                size="small"
                value={d.approvalChannel ?? undefined}
                options={APPROVAL_CHANNELS}
                onChange={(v) => run(actions.updateApproval.mutateAsync({ channel: String(v) }), 'Đã lưu kênh duyệt')}
              />
            ) : (
              (d.approvalChannel ?? '—')
            ),
          },
          {
            label: 'Người duyệt',
            children: canWork ? (
              <Typography.Text editable={{ onChange: (v) => v.trim() && v.trim() !== d.approvedByName && run(actions.updateApproval.mutateAsync({ approvedByName: v.trim() }), 'Đã lưu người duyệt') }}>
                {d.approvedByName ?? ''}
              </Typography.Text>
            ) : (
              (d.approvedByName ?? '—')
            ),
          },
          { label: 'Khoá thiết kế', children: d.lockedAt ? <Tag color="green">Đã khoá {formatDateTime(d.lockedAt)}</Tag> : <Tag>Chưa khoá</Tag> },
        ]}
      />
      {active && !can('design.work') && <NoPermission text="Chờ nhóm Thiết kế hoàn thiện file in và khoá thiết kế." />}
      {canWork && (
        <>
          <Checkbox
            id="design-finalized"
            checked={!!d.finalizedAt}
            disabled={actions.updateApproval.isPending}
            onChange={(e) => run(actions.updateApproval.mutateAsync({ finalized: e.target.checked }), e.target.checked ? 'Đã đánh dấu hoàn thiện' : 'Đã bỏ đánh dấu hoàn thiện')}
          >
            File in đã hoàn thiện đúng theo bản khách duyệt
          </Checkbox>
          <Space wrap>
            <Button
              type="primary"
              icon={<LockOutlined />}
              disabled={!d.finalizedAt}
              loading={actions.lockDesign.isPending}
              onClick={() => run(actions.lockDesign.mutateAsync(), 'Đã khoá thiết kế và tạo lệnh sản xuất')}
            >
              Khoá thiết kế → tạo lệnh sản xuất
            </Button>
            <Button onClick={() => setUnapprove(true)}>Khách đổi ý, sửa tiếp</Button>
            <Button icon={<PrinterOutlined />} onClick={() => printDoc('design', order.id)}>
              In phiếu duyệt thiết kế
            </Button>
          </Space>
        </>
      )}
      <ReasonModal
        open={unapprove}
        title="Khách muốn sửa sau khi đã duyệt?"
        description={`Bản v${d.approvedVersion ?? ''} chuyển thành “Khách yêu cầu sửa”, đơn quay lại bước 3.`}
        okText="Quay lại thiết kế"
        loading={actions.unapprove.isPending}
        onCancel={() => setUnapprove(false)}
        onSubmit={async (reason) => (await run(actions.unapprove.mutateAsync(reason), 'Đã đưa đơn về bước thiết kế')) && setUnapprove(false)}
      />
    </Flex>
  );
}

// ───────────── Step 5 ─────────────

function ProductionStep({ order }: { order: Order }) {
  const can = useCan();
  const run = useRun();
  const actions = useOrderActions(order.id);
  const p = order.production;
  if (!p) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có lệnh sản xuất" />;
  const active = order.status === 'IN_PRODUCTION';
  const canWork = active && can('production.update');
  const index = p.stage ? PRODUCTION_STAGES.indexOf(p.stage) : 0;
  const next = PRODUCTION_STAGES[index + 1];
  const source = order.needsDesign === false || !order.design.approvedVersion ? 'File khách gửi' : `Maket v${order.design.approvedVersion} đã duyệt`;

  return (
    <Flex vertical gap={12}>
      <Descriptions
        size="small"
        column={{ xs: 1, sm: 2, lg: 4 }}
        items={[
          { label: 'Lệnh sản xuất', children: <strong>{p.code ?? '—'}</strong> },
          { label: 'In theo', children: source },
          {
            label: 'Hạn xưởng',
            children: canWork ? (
              <DatePicker
                size="small"
                id="production-due"
                format="DD/MM/YYYY"
                allowClear={false}
                value={p.dueDate ? dayjs(p.dueDate) : null}
                onChange={(d) => d && run(actions.updateProduction.mutateAsync({ dueDate: d.format('YYYY-MM-DD') }), 'Đã đổi hạn xưởng')}
              />
            ) : (
              formatDate(p.dueDate)
            ),
          },
          {
            label: 'Ưu tiên',
            children: canWork ? (
              <Segmented
                size="small"
                value={p.priority}
                options={[
                  { value: 'NORMAL', label: 'Thường' },
                  { value: 'URGENT', label: 'Gấp' },
                ]}
                onChange={(v) => run(actions.updateProduction.mutateAsync({ priority: v as Schemas['Priority'] }), 'Đã đổi mức ưu tiên')}
              />
            ) : p.priority === 'URGENT' ? (
              <Tag color="red">Gấp</Tag>
            ) : (
              'Thường'
            ),
          },
        ]}
      />
      <Steps
        size="small"
        type="inline"
        current={index}
        status={p.stage === 'DONE' ? 'finish' : 'process'}
        items={PRODUCTION_STAGES.map((s) => ({ title: PRODUCTION_STAGE[s] }))}
      />
      {p.doneAt && <Alert type="success" showIcon title={`Xưởng đã giao hàng sang khâu giao lúc ${formatDateTime(p.doneAt)}`} />}
      {active && !can('production.update') && <NoPermission text="Xưởng đang làm. Chỉ nhóm Sản xuất cập nhật được công đoạn." />}
      <Space wrap>
        {canWork && next && (
          <Button type="primary" loading={actions.advance.isPending} onClick={() => run(actions.advance.mutateAsync(undefined), `Đã chuyển sang “${PRODUCTION_STAGE[next]}”`)}>
            Cập nhật: {PRODUCTION_STAGE[next]}
          </Button>
        )}
        {canWork && p.stage === 'DONE' && (
          <Button type="primary" loading={actions.handover.isPending} onClick={() => run(actions.handover.mutateAsync(), 'Đã chuyển sang giao hàng')}>
            Chuyển giao hàng
          </Button>
        )}
        <Button icon={<PrinterOutlined />} onClick={() => printDoc('lsx', order.id)}>
          In lệnh sản xuất
        </Button>
      </Space>
    </Flex>
  );
}

// ───────────── Step 6 ─────────────

function AcceptanceStep({ order }: { order: Order }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const trips = order.deliveries.filter((d) => d.status !== 'CANCELLED');
  const delivered = trips.filter((d) => d.status === 'DELIVERED').length;
  const left = order.lines.reduce((s, l) => s + Math.max(0, l.quantity - l.deliveredQty), 0);
  const a = order.acceptance;

  return (
    <Flex vertical gap={12}>
      <Flex wrap gap={16}>
        <span>
          Chuyến giao: <strong>{delivered}</strong> / {trips.length} đã giao
        </span>
        <span>{order.fullyDelivered ? <Tag color="green">Đã giao đủ</Tag> : <Tag color="orange">Còn {formatQty(left)} chưa giao</Tag>}</span>
        <span>Chi tiết chuyến ở thẻ “Giao hàng” bên dưới.</span>
      </Flex>
      {a ? (
        <Alert
          type="success"
          showIcon
          title={`Khách đã ký biên bản nghiệm thu ${formatDateTime(a.acceptedAt)}${a.acceptedByName ? ` · ${a.acceptedByName}` : ''}`}
          description={a.note ?? undefined}
        />
      ) : order.status === 'DELIVERING' && !order.fullyDelivered ? (
        <Alert type="info" showIcon title="Giao đủ hàng rồi mới ký được biên bản nghiệm thu." />
      ) : null}
      <Space wrap>
        {!a && order.status === 'DELIVERING' && can('deliveries.accept') && (
          <Button type="primary" icon={<CheckCircleOutlined />} disabled={!order.fullyDelivered} onClick={() => setOpen(true)}>
            Khách đã ký nghiệm thu
          </Button>
        )}
        <Button icon={<PrinterOutlined />} onClick={() => printDoc('acceptance', order.id)}>
          In biên bản nghiệm thu
        </Button>
      </Space>
      {open && (
        <AcceptOrderModal
          orderId={order.id}
          code={order.code}
          names={[order.customer.name, ...order.deliveries.map((d) => d.receiverName ?? '')]}
          onClose={() => setOpen(false)}
        />
      )}
    </Flex>
  );
}

/** Record the signed acceptance report (biên bản nghiệm thu). Used on the order page and the delivery list. */
export function AcceptOrderModal({ orderId, code, names, onClose }: { orderId: string; code: string; names: string[]; onClose: () => void }) {
  const run = useRun();
  const { accept } = useOrderActions(orderId);
  const [form] = Form.useForm<{ signedBy: string; note?: string }>();
  const options = [...new Set(names.filter(Boolean))];
  return (
    <Modal
      open
      title={`Biên bản nghiệm thu ${code}`}
      okText="Hoàn tất đơn"
      cancelText="Đóng"
      confirmLoading={accept.isPending}
      onCancel={onClose}
      onOk={() =>
        form.validateFields().then(async (v) => {
          if (await run(accept.mutateAsync({ signedBy: v.signedBy.trim(), note: v.note?.trim() || undefined }), `Đơn ${code} đã hoàn tất`)) onClose();
        })
      }
    >
      <Typography.Paragraph>Ghi nhận khách đã ký biên bản nghiệm thu. Đơn chuyển sang “Hoàn thành” và không sửa chuyến giao được nữa.</Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={{ signedBy: options[options.length - 1] ?? '' }}>
        <Form.Item name="signedBy" label="Người ký bên khách" rules={[{ required: true, whitespace: true, message: 'Nhập người ký' }]}>
          <AutoComplete id="accept-by" options={options.map((n) => ({ value: n }))} />
        </Form.Item>
        <Form.Item name="note" label="Ghi chú">
          <Input.TextArea id="accept-note" rows={2} maxLength={1000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
