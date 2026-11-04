import { App, Form, Modal, Typography } from 'antd';
import type { Schemas } from '../api/client';
import { useOrderActions } from '../api/hooks';
import { errorMessage } from '../lib/errors';
import { formatVnd } from '../lib/format';
import { useCan } from '../lib/access';
import { LineItemsEditor, linesTotal, useProductMap, type LineValue } from './LineItemsEditor';

/**
 * Edit order lines (step 2: confirm with the customer). Swap a product, change size or quantity: no approval,
 * every change is written to the order history and compared with the quote. A line on a trip can't be removed,
 * and its quantity can't go below what is planned.
 */
export function LinesModal({ open, order, onClose }: { open: boolean; order: Schemas['OrderDetailDto']; onClose: () => void }) {
  // A fresh form on every opening, filled from the current order.
  return open ? <LinesDialog order={order} onClose={onClose} /> : null;
}

function LinesDialog({ order, onClose }: { order: Schemas['OrderDetailDto']; onClose: () => void }) {
  const { message } = App.useApp();
  const [form] = Form.useForm<{ lines: LineValue[] }>();
  const { replaceLines } = useOrderActions(order.id);
  const showMoney = useCan()('money.view');
  const { byId } = useProductMap();
  const lines = Form.useWatch('lines', form);
  const planned = new Map(order.lines.map((l) => [l.id, l.plannedQty]));


  async function save() {
    const v = await form.validateFields();
    const body: Schemas['ReplaceLinesDto'] = {
      lines: v.lines.map((l) => {
        const product = l.productId ? byId.get(l.productId) : undefined;
        const area = product ? product.pricingMode === 'AREA' : l.widthM != null && l.heightM != null;
        return {
          id: l.id,
          productId: l.productId ?? null,
          description: (l.description ?? '').trim(),
          spec: l.spec?.trim() || undefined,
          unit: l.unit?.trim() || undefined,
          quantity: l.quantity ?? 1,
          widthM: area ? (l.widthM ?? null) : null,
          heightM: area ? (l.heightM ?? null) : null,
          areaPriceVnd: area ? (l.price ?? null) : null,
          unitPriceVnd: area ? undefined : (l.price ?? (product ? undefined : null)),
        };
      }),
    };
    try {
      await replaceLines.mutateAsync(body);
      message.success('Đã lưu hàng hoá');
      onClose();
    } catch (err) {
      message.error(errorMessage(err));
    }
  }

  return (
    <Modal open width={1100} title={`Sửa hàng hoá · ${order.code}`} okText="Lưu" cancelText="Đóng" confirmLoading={replaceLines.isPending} onCancel={onClose} onOk={save} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          lines: order.lines.map((l) => ({
            id: l.id,
            productId: l.productId ?? undefined,
            description: l.widthM !== null ? l.baseName : l.description,
            spec: l.spec ?? undefined,
            unit: l.unit ?? undefined,
            widthM: l.widthM ?? undefined,
            heightM: l.heightM ?? undefined,
            quantity: l.quantity,
            price: (l.widthM !== null ? l.areaPriceVnd : l.unitPriceVnd) ?? undefined,
          })),
        }}
      >
        <LineItemsEditor
          form={form}
          showMoney={showMoney}
          idPrefix="edit-line"
          minQty={(l) => (l.id ? (planned.get(l.id) ?? 1) : 1)}
          canRemove={(l) => !l.id || (planned.get(l.id) ?? 0) === 0}
        />
        {showMoney && (
          <Typography.Paragraph style={{ textAlign: 'right', marginTop: 12, marginBottom: 0 }}>
            Tổng mới: <strong>{formatVnd(linesTotal(lines, byId))}</strong> · trước khi sửa {formatVnd(order.totalVnd)}
          </Typography.Paragraph>
        )}
      </Form>
    </Modal>
  );
}
