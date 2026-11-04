import type { Schemas } from '../api/client';

type OrderStatus = Schemas['OrderStatus'];
type DeliveryStatus = Schemas['DeliveryStatus'];
type PaymentStatus = Schemas['PaymentStatus'];
type PaymentMethod = Schemas['PaymentMethod'];

/** One place for every status label and colour, so a status looks the same on every screen. */
export const ORDER_STATUS: Record<OrderStatus, { label: string; color: string }> = {
  CONFIRMED: { label: 'Chốt đơn', color: 'blue' },
  DESIGNING: { label: 'Thiết kế', color: 'purple' },
  DESIGN_FINALIZING: { label: 'Hoàn thiện TK', color: 'magenta' },
  IN_PRODUCTION: { label: 'Sản xuất', color: 'gold' },
  DELIVERING: { label: 'Giao hàng', color: 'cyan' },
  COMPLETED: { label: 'Hoàn thành', color: 'green' },
  CANCELLED: { label: 'Đã huỷ', color: 'default' },
};

/** The 6 steps of an order (step 1 is the quote). */
export const STEPS = [
  { n: 1, label: 'Báo giá', title: 'Lập, gửi, chốt báo giá' },
  { n: 2, label: 'Chốt đơn', title: 'Xác nhận hàng hoá với khách' },
  { n: 3, label: 'Thiết kế', title: 'Gửi maket, nhận phản hồi' },
  { n: 4, label: 'Hoàn thiện TK', title: 'Khách duyệt, khoá thiết kế' },
  { n: 5, label: 'Sản xuất', title: 'Lệnh sản xuất, xưởng' },
  { n: 6, label: 'Giao hàng', title: 'Giao, ký biên bản nghiệm thu' },
] as const;

/** Step reached by an order status (7 = completed) */
export const STATUS_STEP: Record<OrderStatus, number> = {
  CONFIRMED: 2,
  DESIGNING: 3,
  DESIGN_FINALIZING: 4,
  IN_PRODUCTION: 5,
  DELIVERING: 6,
  COMPLETED: 7,
  CANCELLED: 0,
};

export const PRODUCTION_STAGE: Record<Schemas['ProductionStage'], string> = {
  RECEIVED: 'Nhận lệnh',
  PRINTING: 'In',
  FINISHING: 'Gia công',
  QC: 'Kiểm tra',
  DONE: 'Xong',
};
export const PRODUCTION_STAGES = Object.keys(PRODUCTION_STAGE) as Array<Schemas['ProductionStage']>;

export const DESIGN_FEEDBACK: Record<Schemas['DesignFeedback'], { label: string; color: string }> = {
  PENDING: { label: 'Chờ khách phản hồi', color: 'blue' },
  CHANGES_REQUESTED: { label: 'Khách yêu cầu sửa', color: 'orange' },
  APPROVED: { label: 'Khách đồng ý', color: 'green' },
};

export const APPROVAL_CHANNELS = ['Zalo', 'Email', 'Trực tiếp'];

export const QUOTE_STATUS: Record<Schemas['QuoteStatus'], { label: string; color: string }> = {
  DRAFT: { label: 'Nháp', color: 'default' },
  SENT: { label: 'Đã gửi khách', color: 'blue' },
  WON: { label: 'Đã chốt', color: 'green' },
  LOST: { label: 'Khách không lấy', color: 'red' },
};

export const DELIVERY_STATUS: Record<DeliveryStatus, { label: string; color: string }> = {
  SCHEDULED: { label: 'Chờ giao', color: 'blue' },
  DELIVERED: { label: 'Đã giao', color: 'green' },
  CANCELLED: { label: 'Đã huỷ', color: 'default' },
};

export const PAYMENT_STATUS: Record<PaymentStatus, { label: string; color: string } | null> = {
  NONE: null,
  UNPAID: { label: 'Chưa thanh toán', color: 'red' },
  PARTLY_PAID: { label: 'Thanh toán một phần', color: 'orange' },
  PAID: { label: 'Đã thanh toán', color: 'green' },
};

export const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  CASH: 'Tiền mặt',
  BANK_TRANSFER: 'Chuyển khoản',
  OTHER: 'Khác',
};


export const ACTIVITY_LABEL: Record<string, string> = {
  QUOTE_CREATED: 'Lập báo giá',
  QUOTE_UPDATED: 'Sửa báo giá',
  ORDER_CREATED: 'Tạo đơn',
  ORDER_UPDATED: 'Sửa thông tin đơn',
  LINES_CHANGED: 'Sửa hàng hoá',
  STATUS_CHANGED: 'Đổi trạng thái',
  DELIVERY_PLANNED: 'Lên chuyến giao',
  DELIVERY_UPDATED: 'Sửa chuyến giao',
  DELIVERY_DELIVERED: 'Giao xong',
  DELIVERY_REOPENED: 'Mở lại chuyến giao',
  DELIVERY_CANCELLED: 'Huỷ chuyến giao',
  PAYMENT_RECORDED: 'Ghi nhận thanh toán',
  PAYMENT_VOIDED: 'Huỷ khoản thanh toán',
  ORDER_CONFIRMED: 'Xác nhận đơn',
  DESIGNER_ASSIGNED: 'Giao thiết kế',
  DESIGN_SENT: 'Gửi maket',
  DESIGN_CHANGES: 'Khách yêu cầu sửa maket',
  DESIGN_APPROVED: 'Khách duyệt maket',
  DESIGN_APPROVAL_UPDATED: 'Cập nhật duyệt thiết kế',
  DESIGN_REOPENED: 'Mở lại thiết kế',
  DESIGN_LOCKED: 'Khoá thiết kế',
  PRODUCTION_STARTED: 'Tạo lệnh sản xuất',
  PRODUCTION_UPDATED: 'Sửa lệnh sản xuất',
  PRODUCTION_STAGE: 'Xưởng cập nhật',
  PRODUCTION_HANDOVER: 'Xưởng giao hàng xong',
  ORDER_ACCEPTED: 'Khách ký nghiệm thu',
};
