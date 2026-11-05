import { CheckCircleFilled, LockOutlined, PlayCircleOutlined, WarningOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Col, Flex, Popconfirm, Row, Statistic, Steps, Tag, Typography } from 'antd';
import { Link } from 'react-router';
import { useAccountingMutations, useOverview } from '../../api/accounting';
import { useCan } from '../../lib/access';
import { errorMessage } from '../../lib/errors';
import { formatDateTime, formatVnd } from '../../lib/format';
import { AccountingPage, monthLabel, Rows, STEP_LABEL, type Period } from './common';

/** "Tổng quan & khoá sổ": balances at a glance and the month-end checklist */
export function AccountingOverviewPage() {
  return <AccountingPage title="Tổng quan & khoá sổ">{(period) => <Overview period={period} />}</AccountingPage>;
}

function Overview({ period }: { period: Period }) {
  const can = useCan();
  const { message } = App.useApp();
  const { data, isLoading } = useOverview(period.id);
  const { runStep, close } = useAccountingMutations();
  const kpi = data?.kpi;
  const label = monthLabel(period.month);
  const firstPending = data?.steps.findIndex((s) => !s.done) ?? -1;

  return (
    <Flex vertical gap={16}>
      <Row gutter={[12, 12]}>
        <Kpi title="Tiền mặt (111)" value={kpi?.cashVnd} />
        <Kpi title="Tiền gửi ngân hàng (112)" value={kpi?.bankVnd} />
        <Kpi title="Phải thu khách (131)" value={kpi?.receivableVnd} />
        <Kpi title="Phải trả NCC (331)" value={kpi?.payableVnd} />
        <Kpi title="Tồn kho NVL (152)" value={kpi?.stockVnd} />
        <Kpi title={`Lợi nhuận ${label}${data?.period.provisional ? ' (tạm tính)' : ''}`} value={kpi?.profitVnd} highlight />
      </Row>

      {data?.period.previousOpen && period.status === 'OPEN' && (
        <Alert type="warning" showIcon message="Kỳ trước chưa khoá sổ" description="Khoá sổ các kỳ trước theo thứ tự, rồi mới chạy các bước cuối kỳ của kỳ này." />
      )}

      <Card
        title={`Khoá sổ cuối kỳ ${label}`}
        loading={isLoading}
        extra={
          period.status === 'CLOSED' ? (
            <Tag icon={<LockOutlined />}>Đã khoá {formatDateTime(data?.period.closedAt)} · {data?.period.closedByName}</Tag>
          ) : null
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          Chạy lần lượt 5 bước, rồi khoá sổ. Khi có chứng từ mới ghi vào kỳ sau khi đã chạy (trừ khoản thu và trả nợ), các bước sẽ tự đặt lại để chạy lại cho đúng số liệu.
        </Typography.Paragraph>
        <Steps
          orientation="vertical"
          current={firstPending === -1 ? 5 : firstPending}
          items={(data?.steps ?? []).map((s, i) => ({
            title: (
              <Flex gap={12} align="center" wrap>
                <span>
                  {i + 1}. {STEP_LABEL[s.step]}
                </span>
                {s.canRun && can('accounting.close') && (
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    loading={runStep.isPending && runStep.variables?.step === s.step}
                    onClick={() =>
                      runStep.mutate(
                        { id: period.id, step: s.step },
                        { onSuccess: () => message.success(`Đã chạy: ${STEP_LABEL[s.step]}`), onError: (e) => message.error(errorMessage(e)) },
                      )
                    }
                  >
                    Chạy
                  </Button>
                )}
              </Flex>
            ),
            status: s.done ? 'finish' : s.canRun ? 'process' : 'wait',
            icon: s.done ? <CheckCircleFilled style={{ color: '#2f7d4f' }} /> : undefined,
            content: (
              <Typography.Text type="secondary">
                {s.summary}
                {s.doneAt ? ` · ${formatDateTime(s.doneAt)}` : ''}
              </Typography.Text>
            ),
          }))}
        />
        {period.status === 'OPEN' && can('accounting.close') && (
          <Popconfirm
            title={`Khoá sổ kỳ ${label}?`}
            description="Số dư cuối kỳ và tồn kho được chuyển sang kỳ sau. Sau khi khoá, chứng từ của kỳ này không sửa được nữa (trừ khi mở lại kỳ)."
            okText="Khoá sổ"
            cancelText="Thôi"
            disabled={!data?.canClose}
            onConfirm={() => close.mutate(period.id, { onSuccess: () => message.success(`Đã khoá sổ kỳ ${label}`), onError: (e) => message.error(errorMessage(e)) })}
          >
            <Button type="primary" danger icon={<LockOutlined />} disabled={!data?.canClose} loading={close.isPending}>
              Khoá sổ kỳ {label}
            </Button>
          </Popconfirm>
        )}
      </Card>

      {!!data?.pendingIssues.length && (
        <Card
          title={
            <span>
              <WarningOutlined style={{ color: '#d48806' }} /> Đơn đang sản xuất chưa có phiếu xuất kho ({data.pendingIssues.length})
            </span>
          }
          extra={can('accounting.post') && <Link to={`/accounting/stock?ky=${period.month}`}>Lập phiếu xuất</Link>}
        >
          <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
            Giá vốn của đơn được tính từ vật tư đã xuất cho đơn. Đơn chưa có phiếu xuất sẽ có giá vốn bằng 0 khi nghiệm thu.
          </Typography.Paragraph>
          <Rows
            items={data.pendingIssues}
            rowKey={(o) => o.orderId}
            render={(o) => (
              <>
                <Link to={`/orders/${o.orderId}`}>{o.orderCode}</Link>
                <span style={{ flex: 1 }}>
                  {o.customerName} · {o.summary}
                </span>
                <Typography.Text type="secondary">{o.productionCode}</Typography.Text>
              </>
            )}
          />
        </Card>
      )}
    </Flex>
  );
}

function Kpi({ title, value, highlight }: { title: string; value: number | undefined; highlight?: boolean }) {
  return (
    <Col xs={12} md={8} xl={4}>
      <Card size="small" style={{ height: '100%' }}>
        <Statistic
          title={title}
          value={value === undefined ? '…' : formatVnd(value)}
          styles={{ content: { fontSize: 18, color: highlight && value !== undefined ? (value < 0 ? '#cf1322' : '#2f7d4f') : undefined } }}
        />
      </Card>
    </Col>
  );
}
