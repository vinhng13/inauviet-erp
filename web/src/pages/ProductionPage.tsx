import { PrinterOutlined, ReloadOutlined } from '@ant-design/icons';
import { App, Button, Card, Empty, Flex, Tag, Tooltip, Typography, theme } from 'antd';
import { useNavigate } from 'react-router';
import type { Schemas } from '../api/client';
import { useOrderActions, useProduction } from '../api/hooks';
import { printDoc } from '../components/OrderSteps';
import { DocsDownload } from '../components/PrintMenu';
import { useCan } from '../lib/access';
import { errorMessage } from '../lib/errors';
import { formatQty, formatShortDate } from '../lib/format';
import { PRODUCTION_STAGE, PRODUCTION_STAGES } from '../lib/status';

type Item = Schemas['ProductionItemDto'];

/** Workshop board: one column per stage of the work order (lệnh sản xuất). No prices here. */
export function ProductionPage() {
  const { data, isFetching, refetch } = useProduction();
  const { token } = theme.useToken();
  const items = data ?? [];

  return (
    <Flex vertical gap={16}>
      <Flex wrap gap={12} align="center" justify="space-between">
        <Typography.Title level={3} style={{ margin: 0 }}>
          Sản xuất
        </Typography.Title>
        <Flex gap={12} align="center">
          <Typography.Text type="secondary">
            {items.length} lệnh · {items.filter((i) => i.production.priority === 'URGENT').length} gấp · {items.filter((i) => i.isLate).length} trễ hạn
          </Typography.Text>
          <Button icon={<ReloadOutlined spin={isFetching} />} onClick={() => refetch()}>
            Làm mới
          </Button>
        </Flex>
      </Flex>
      <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PRODUCTION_STAGES.length}, minmax(200px, 1fr))`, gap: 12, minWidth: 1050 }}>
          {PRODUCTION_STAGES.map((stage) => {
            const cards = items.filter((i) => (i.production.stage ?? 'RECEIVED') === stage);
            return (
              <div key={stage} style={{ background: token.colorFillQuaternary, borderRadius: token.borderRadiusLG, padding: 10, minHeight: 240 }}>
                <Flex justify="space-between" style={{ padding: '2px 4px 10px' }}>
                  <Typography.Text strong>{PRODUCTION_STAGE[stage]}</Typography.Text>
                  <Typography.Text type="secondary">{cards.length}</Typography.Text>
                </Flex>
                <Flex vertical gap={8}>
                  {cards.map((i) => (
                    <WorkCard key={i.id} item={i} />
                  ))}
                  {cards.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Trống" />}
                </Flex>
              </div>
            );
          })}
        </div>
      </div>
    </Flex>
  );
}

function WorkCard({ item: i }: { item: Item }) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const can = useCan();
  const actions = useOrderActions(i.id);
  const p = i.production;
  const index = PRODUCTION_STAGES.indexOf(p.stage ?? 'RECEIVED');
  const next = PRODUCTION_STAGES[index + 1];

  const go = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (next) {
        await actions.advance.mutateAsync(undefined);
        message.success(`${p.code ?? i.code}: ${PRODUCTION_STAGE[next]}`);
      } else {
        await actions.handover.mutateAsync();
        message.success(`${i.code} đã chuyển sang giao hàng`);
      }
    } catch (err) {
      message.error(errorMessage(err));
    }
  };

  return (
    <Card size="small" hoverable onClick={() => navigate(`/orders/${i.id}`)} styles={{ body: { padding: 12 } }}>
      <Flex justify="space-between" align="baseline" gap={8}>
        <Typography.Text strong style={{ whiteSpace: 'nowrap' }}>
          {p.code ?? i.code}
        </Typography.Text>
        <Typography.Text type={i.isLate ? 'danger' : 'secondary'} style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
          {i.isLate ? 'Trễ ' : 'Hạn '}
          {formatShortDate(p.dueDate)}
        </Typography.Text>
      </Flex>
      <div style={{ fontSize: 12, opacity: 0.7 }}>
        {i.code} · {i.customerName}
      </div>
      <ul style={{ margin: '6px 0 0', paddingInlineStart: 16, fontSize: 13 }}>
        {i.lines.map((l, k) => (
          <li key={k}>
            {l.description} × {formatQty(l.quantity)}
            {l.unit ? ` ${l.unit}` : ''}
            {l.spec && <div style={{ fontSize: 12, opacity: 0.65 }}>{l.spec}</div>}
          </li>
        ))}
      </ul>
      <Flex wrap gap={4} style={{ marginTop: 8 }} align="center">
        {p.priority === 'URGENT' && <Tag color="red">Gấp</Tag>}
        <Tag>{i.source}</Tag>
      </Flex>
      {p.note && <div style={{ fontSize: 12, marginTop: 4 }}>{p.note}</div>}
      <Flex gap={6} style={{ marginTop: 10 }} justify="space-between">
        {can('production.update') ? (
          <Button size="small" type="primary" loading={actions.advance.isPending || actions.handover.isPending} onClick={go}>
            {next ? `→ ${PRODUCTION_STAGE[next]}` : 'Chuyển giao hàng'}
          </Button>
        ) : (
          <span />
        )}
        <Flex gap={2}>
          <Tooltip title="Xem / in lệnh sản xuất">
            <Button
              size="small"
              type="text"
              icon={<PrinterOutlined />}
              aria-label="In lệnh sản xuất"
              onClick={(e) => {
                e.stopPropagation();
                printDoc('lsx', i.id);
              }}
            />
          </Tooltip>
          <DocsDownload docs={[{ kind: 'lsx', sourceId: i.id, label: 'Lệnh sản xuất' }]} code={p.code ?? i.code} />
        </Flex>
      </Flex>
    </Card>
  );
}
