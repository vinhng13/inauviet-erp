import type { WhDieAction, WhDieStatus } from '../generated/prisma/enums';

/**
 * Quy trình khuôn: tạo khuôn mới (Đang làm khuôn) → kiểm tra (Đạt / Không đạt) → bế khuôn (Đang bế, chuyển tới xưởng bế).
 * Ngoài ra: chuyển kho (kho A → kho B, hoặc về kho). Thao tác tại chỗ: kiểm tra đạt (PASS), không đạt / báo lỗi (DEFECT),
 * đổi kệ, thanh lý. Mọi thao tác có hiệu lực ngay, ai có quyền quản lý khuôn cũng làm được.
 */
export type MoveAction = 'PASS' | 'DEFECT' | 'DISPOSE' | 'MOVE';
export const MOVE_ACTIONS: MoveAction[] = ['PASS', 'DEFECT', 'DISPOSE', 'MOVE'];

interface Transition {
  from: WhDieStatus[];
  to: WhDieStatus | 'SAME';
}

export const TRANSITIONS: Record<MoveAction, Transition> = {
  PASS: { from: ['MAKING', 'REPAIRING', 'CHECKING', 'DEFECT'], to: 'READY' }, // kiểm tra: đạt
  DEFECT: { from: ['MAKING', 'REPAIRING', 'CHECKING', 'READY', 'IN_USE'], to: 'DEFECT' }, // kiểm tra: không đạt / báo lỗi
  DISPOSE: { from: ['READY', 'DEFECT', 'BROKEN', 'CHECKING'], to: 'DISPOSED' },
  MOVE: { from: ['READY', 'CHECKING', 'DEFECT'], to: 'SAME' }, // đổi kệ (kho có kệ)
};

/** Thao tác tại chỗ được phép theo trạng thái (kho nào cũng như nhau: Âu Việt hay kho ngoài) */
export function allowedActions(status: WhDieStatus, pending: boolean): MoveAction[] {
  if (pending) return [];
  return MOVE_ACTIONS.filter((a) => TRANSITIONS[a].from.includes(status));
}

/** Chỉ khuôn đã kiểm đạt (hoặc đang bế ở xưởng khác) mới đi bế được */
export const CAN_GO_CUT: WhDieStatus[] = ['READY', 'IN_USE'];

/**
 * Trạng thái khuôn sau khi chuyển, theo thao tác (không theo nơi đến):
 * - bế khuôn: đang bế;
 * - gửi sửa: đang làm vẫn đang làm, còn lại là đang sửa;
 * - chuyển kho: khuôn đang bế thì về sẵn sàng, còn lại giữ nguyên.
 */
export function statusAfterMove(cur: WhDieStatus, purpose: 'CUT' | 'REPAIR' | null | undefined): WhDieStatus {
  if (purpose === 'CUT') return 'IN_USE';
  if (purpose === 'REPAIR') return cur === 'MAKING' ? 'MAKING' : 'REPAIRING';
  return cur === 'IN_USE' ? 'READY' : cur;
}

export const STATUS_LABEL: Record<WhDieStatus, string> = {
  READY: 'Đạt, sẵn sàng',
  IN_USE: 'Đang bế',
  CHECKING: 'Chờ kiểm',
  REPAIRING: 'Đang sửa',
  DEFECT: 'Không đạt',
  BROKEN: 'Hỏng',
  DISPOSED: 'Thanh lý',
  TRANSIT: 'Đang chuyển',
  INCOMING: 'Khuôn mới, chờ nhận',
  MAKING: 'Đang làm khuôn',
};

export const ACTION_LABEL: Record<WhDieAction, string> = {
  CREATE: 'Tạo khuôn',
  ISSUE: 'Xuất khuôn',
  KEEP: 'Bế xong, xưởng giữ',
  RETURN: 'Trả về, chờ kiểm',
  PASS: 'Kiểm tra: đạt',
  DEFECT: 'Kiểm tra: không đạt / báo lỗi',
  SEND_REPAIR: 'Chuyển sửa',
  BACK_REPAIR: 'Trả từ sửa',
  DISPOSE: 'Thanh lý',
  MOVE: 'Chuyển vị trí',
  EDIT: 'Sửa thông tin',
  IMPORT: 'Nạp từ Excel',
  REQUEST: 'Lập phiếu giao nhận',
  SEND: 'Xác nhận xuất',
  RECEIVE: 'Xác nhận đã nhận',
  REJECT: 'Phiếu bị từ chối / huỷ',
  REUSE: 'Bế lệnh mới tại xưởng',
  COUNT: 'Kiểm kê',
  TRANSFER: 'Chuyển khuôn',
};


/** "24x24x12.5", "24 x 24" → các chiều (cm); chữ khác → null */
export function sizeQuery(q: string): number[] | null {
  const m = q.trim().match(/^(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)(?:\s*[x×*]\s*(\d+(?:[.,]\d+)?))?\s*(?:cm)?$/i);
  return m ? [m[1], m[2], m[3]].filter(Boolean).map((v) => Number(v.replace(',', '.'))) : null;
}

/** Mỗi chiều cần tìm khớp một chiều của khuôn, lệch tối đa tol cm, không cần đúng thứ tự dài – rộng – cao */
export function sizeMatches(want: number[], have: Array<number | null>, tol = 0.5): boolean {
  const h = have.filter((v): v is number => v !== null).sort((a, b) => a - b);
  const used = new Set<number>();
  return [...want].sort((a, b) => a - b).every((v) => {
    const i = h.findIndex((x, j) => !used.has(j) && Math.abs(x - v) <= tol + 1e-9);
    if (i < 0) return false;
    used.add(i);
    return true;
  });
}

// ───────────── Đọc dữ liệu gõ tay (Excel cũ, ô nhập) ─────────────

const num = (s: string) => Number(s.replace(',', '.'));

/** "30x31,5x15" → 3 số; "32 x 24" → 2 số; còn lại giữ dạng chữ */
export function parseSize(raw: string | null | undefined): {
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  sizeText: string | null;
} {
  const text = (raw ?? '').trim();
  const empty = { lengthCm: null, widthCm: null, heightCm: null, sizeText: null };
  if (!text) return empty;
  const dims = '(\\d+(?:[.,]\\d+)?)\\s*[x×*]\\s*(\\d+(?:[.,]\\d+)?)(?:\\s*[x×*]\\s*(\\d+(?:[.,]\\d+)?))?';
  const m = text.match(new RegExp(`^${dims}\\s*(?:cm|c)?$`, 'i'));
  if (m) return { lengthCm: num(m[1]), widthCm: num(m[2]), heightCm: m[3] ? num(m[3]) : null, sizeText: null };
  // "Túi lịch 65x43": one size inside other words → keep the words, search by the numbers
  const all = [...text.matchAll(new RegExp(dims, 'gi'))];
  if (all.length === 1) {
    const f = all[0];
    return { lengthCm: num(f[1]), widthCm: num(f[2]), heightCm: f[3] ? num(f[3]) : null, sizeText: text };
  }
  return { ...empty, sizeText: text };
}

/** Tách ghi chú tự do thành hướng, số mảnh, số sản phẩm trên khuôn; phần còn lại giữ làm ghi chú */
export function parseDieNotes(...notes: Array<string | null | undefined>): {
  orientation: 'PORTRAIT' | 'LANDSCAPE' | null;
  pieces: number | null;
  ups: number | null;
  note: string | null;
} {
  let orientation: 'PORTRAIT' | 'LANDSCAPE' | null = null;
  let pieces: number | null = null;
  let ups: number | null = null;
  const rest: string[] = [];
  for (const raw of notes) {
    let text = (raw ?? '').trim();
    if (!text) continue;
    if (/^dọc$/i.test(text)) {
      orientation = 'PORTRAIT';
      continue;
    }
    if (/^ngang$/i.test(text)) {
      orientation = 'LANDSCAPE';
      continue;
    }
    const p = text.match(/(\d+)\s*mảnh/i);
    if (p) {
      pieces = Number(p[1]);
      text = text.replace(p[0], '').trim();
    }
    const u = text.match(/(\d+)\s*[\p{L} ]{0,20}?\/\s*1\s*khuôn/iu);
    if (u) {
      ups = Number(u[1]);
      text = text.replace(u[0], '').trim();
    }
    text = text.replace(/^[,;\-\s]+|[,;\-\s]+$/g, '');
    if (text) rest.push(text);
  }
  return { orientation, pieces, ups, note: rest.length ? rest.join('; ') : null };
}

/** Khổ giấy "21,5 x 32" → [21.5, 32] */
export function parseSheetSize(raw: string): [number, number] | null {
  const m = raw.trim().match(/^(\d+(?:[.,]\d+)?)\s*[x×*]\s*(\d+(?:[.,]\d+)?)$/i);
  return m ? [num(m[1]), num(m[2])] : null;
}

/** 21.5 → "21,5" */
export function fmtCm(v: number): string {
  return String(Math.round(v * 100) / 100).replace('.', ',');
}

/** Nhãn một dòng lịch sử: lần chuyển khuôn gọi theo nơi đến (bế khuôn, chuyển kho, gửi sửa) */
export function moveLabel(action: WhDieAction, toStatus: WhDieStatus | null): string {
  if (action !== 'TRANSFER') return ACTION_LABEL[action];
  if (toStatus === 'IN_USE') return 'Bế khuôn';
  if (toStatus === 'REPAIRING') return 'Gửi sửa';
  return 'Chuyển kho';
}
