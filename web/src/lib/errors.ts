import { ApiError } from '../api/client';

/** Vietnamese text for the API's stable error codes. Unknown codes fall back to the API message. */
const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'Phiên đăng nhập đã hết. Hãy đăng nhập lại.',
  INVALID_CREDENTIALS: 'Sai tên đăng nhập hoặc mật khẩu.',
  LOGIN_LOCKED: 'Nhập sai quá nhiều lần. Thử lại sau 15 phút hoặc nhờ quản trị viên đặt lại mật khẩu.',
  ACCOUNT_DISABLED: 'Tài khoản đã bị khoá. Liên hệ quản trị viên.',
  PASSWORD_CHANGE_REQUIRED: 'Bạn cần đổi mật khẩu tạm trước khi tiếp tục.',
  WRONG_PASSWORD: 'Mật khẩu hiện tại chưa đúng.',
  SAME_PASSWORD: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
  PERMISSION_DENIED: 'Bạn không có quyền làm việc này. Nhờ quản trị viên cấp thêm quyền nếu cần.',
  USERNAME_EXISTS: 'Tên đăng nhập này đã có người dùng.',
  INVALID_USERNAME: 'Tên đăng nhập chỉ gồm chữ thường không dấu, số, dấu chấm, gạch ngang (3–32 ký tự).',
  ADMIN_ONLY: 'Chỉ quản trị viên mới làm được việc này với tài khoản quản trị.',
  LAST_ADMIN: 'Phải còn ít nhất một quản trị viên đang hoạt động. Thêm quản trị viên khác trước.',
  SELF_LOCK: 'Không thể tự khoá tài khoản của mình.',
  SELF_ROLE: 'Không thể tự đổi nhóm quyền của mình.',
  SELF_RESET: 'Dùng mục "Đổi mật khẩu" để đổi mật khẩu của chính bạn.',
  ROLE_NOT_FOUND: 'Không tìm thấy nhóm quyền.',
  ROLE_NAME_EXISTS: 'Đã có nhóm quyền trùng tên.',
  ROLE_IN_USE: 'Còn tài khoản trong nhóm này. Chuyển họ sang nhóm khác trước khi xoá.',
  SYSTEM_ROLE: 'Nhóm Quản trị viên có sẵn, không sửa hoặc xoá được.',
  OWN_ROLE: 'Không thể sửa nhóm quyền của chính mình. Nhờ quản trị viên.',
  VALIDATION_FAILED: 'Thông tin nhập chưa hợp lệ. Kiểm tra lại các ô được đánh dấu.',
  INVALID_DATE: 'Ngày không hợp lệ.',
  INVALID_PHONE: 'Số điện thoại không hợp lệ.',
  PHONE_EXISTS: 'Số điện thoại này đã thuộc về một khách hàng khác.',
  EMAIL_EXISTS: 'Email này đã thuộc tài khoản khác.',
  PLANNED_QTY_EXCEEDS_ORDER: 'Số lượng lên chuyến vượt quá số lượng đặt.',
  DELIVERED_EXCEEDS_PLANNED: 'Số lượng giao vượt quá số đã lên chuyến. Sửa chuyến trước.',
  NOTHING_DELIVERED: 'Chưa giao được gì trong chuyến này. Hãy huỷ chuyến hoặc đổi ngày.',
  LINE_HAS_DELIVERIES: 'Mặt hàng này đã có trong chuyến giao, không xoá được. Bỏ khỏi chuyến trước.',
  LINE_NOT_IN_ORDER: 'Mặt hàng không thuộc đơn này.',
  INVALID_LINE_INDEX: 'Chuyến giao chọn một mặt hàng không có trong đơn.',
  ORDER_CANCELLED: 'Đơn đã huỷ, không sửa được nữa.',
  ORDER_COMPLETED: 'Đơn đã hoàn thành, không huỷ được.',
  INVALID_STATUS: 'Không thể làm việc này ở trạng thái hiện tại.',
  DELIVERY_HAS_PAYMENTS: 'Chuyến này đã có khoản thu. Huỷ khoản thu trước.',
  DELIVERY_NOT_IN_ORDER: 'Chuyến giao không thuộc đơn này.',
  ALREADY_VOIDED: 'Khoản này đã được huỷ trước đó.',
  ORDER_NOT_FOUND: 'Không tìm thấy đơn hàng.',
  CUSTOMER_NOT_FOUND: 'Không tìm thấy khách hàng.',
  DELIVERY_NOT_FOUND: 'Không tìm thấy chuyến giao.',
  LINE_SIZE_REQUIRED: 'Sản phẩm tính theo m² cần nhập chiều rộng và chiều cao (tối đa 100 m).',
  LINE_PRICE_REQUIRED: 'Dòng nhập tay cần có đơn giá.',
  LINE_DESCRIPTION_REQUIRED: 'Chọn sản phẩm hoặc nhập tên hạng mục.',
  PRODUCT_NOT_FOUND: 'Không tìm thấy sản phẩm trong danh mục.',
  PRODUCT_NAME_TAKEN: 'Đã có sản phẩm trùng tên.',
  PRODUCT_UNIT_REQUIRED: 'Sản phẩm tính theo số lượng cần đơn vị tính (cái, bộ, hộp…).',
  QUOTE_NOT_FOUND: 'Không tìm thấy báo giá.',
  QUOTE_CLOSED: 'Báo giá đã chốt thành đơn, không sửa được nữa.',
  QUOTE_LOST: 'Báo giá đang ở trạng thái "Khách không lấy". Mở lại trước khi sửa.',
  QUOTE_NOT_LOST: 'Chỉ mở lại được báo giá khách không lấy.',
  DESIGN_AWAITING_FEEDBACK: 'Maket trước đang chờ khách phản hồi. Ghi phản hồi trước khi gửi bản mới.',
  DESIGN_FEEDBACK_CLOSED: 'Phiên bản này đã có phản hồi hoặc không phải bản mới nhất.',
  DESIGN_NOT_FINALIZED: 'Đánh dấu đã hoàn thiện file in trước khi khoá thiết kế.',
  PRODUCTION_DONE: 'Lệnh sản xuất đã xong, chuyển sang giao hàng.',
  PRODUCTION_NOT_DONE: 'Xưởng chưa báo xong lệnh sản xuất.',
  NOT_FULLY_DELIVERED: 'Chưa giao đủ hàng, chưa ký nghiệm thu được.',
  ORDER_ACCEPTED: 'Đơn đã ký nghiệm thu, không sửa chuyến giao được nữa.',
  USER_NOT_FOUND: 'Không tìm thấy tài khoản hoặc tài khoản đã khoá.',
};

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const base = MESSAGES[err.code];
    if (err.code === 'PLANNED_QTY_EXCEEDS_ORDER' && Array.isArray(err.body.details?.lines)) {
      const lines = (err.body.details!.lines as Array<{ description: string; planned: number; ordered: number }>)
        .map((l) => `${l.description}: lên chuyến ${l.planned}, đặt ${l.ordered}`)
        .join('; ');
      return `${base} ${lines}`;
    }
    if (err.code === 'WEAK_PASSWORD') return err.message;
    if (err.code === 'VALIDATION_FAILED' && Array.isArray(err.body.details?.errors)) {
      return `${base} (${(err.body.details!.errors as string[]).join('; ')})`;
    }
    return base ?? err.message;
  }
  if (err instanceof TypeError) return 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
  return 'Đã có lỗi. Thử lại sau.';
}
