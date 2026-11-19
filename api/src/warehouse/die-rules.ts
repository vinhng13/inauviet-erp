import type { WhDieAction, WhDieStatus } from '../generated/prisma/enums';

/**
 * Thao tác tại chỗ: khuôn không đổi nơi nên không cần phiếu. Đổi nơi (kho ↔ xưởng, kho ↔ kho, xưởng ↔ xưởng)
 * phải lập phiếu giao nhận và được thủ kho xác nhận.
 */
export type MoveAction = 'KEEP' | 'PASS' | 'DEFECT' | 'DISPOSE' | 'MOVE' | 'REUSE';
export const MOVE_ACTIONS: MoveAction[] = ['KEEP', 'PASS', 'DEFECT', 'DISPOSE', 'MOVE', 'REUSE'];

interface Transition {
  from: WhDieStatus[];
  to: WhDieStatus | 'SAME';
  /** where the die must be: in a kho, at a workshop, or either */
  at: 'KHO' | 'PARTNER' | 'ANY';
}

export const TRANSITIONS: Record<MoveAction, Transition> = {
  KEEP: { from: ['IN_USE'], to: 'READY', at: 'PARTNER' }, // bế xong, xưởng giữ lại khuôn
  REUSE: { from: ['READY', 'IN_USE'], to: 'IN_USE', at: 'PARTNER' }, // bế lệnh mới tại xưởng đang giữ khuôn
  PASS: { from: ['CHECKING', 'DEFECT'], to: 'READY', at: 'KHO' }, // kiểm đạt, lên kệ
  DEFECT: { from: ['CHECKING', 'READY', 'IN_USE', 'REPAIRING'], to: 'DEFECT', at: 'ANY' }, // lỗi (hoặc hỏng)
  DISPOSE: { from: ['READY', 'DEFECT', 'BROKEN', 'CHECKING'], to: 'DISPOSED', at: 'KHO' },
  MOVE: { from: ['READY', 'CHECKING', 'DEFECT'], to: 'SAME', at: 'KHO' }, // đổi kệ trong kho
};

export function allowedActions(status: WhDieStatus, atPartner: boolean, pending: boolean): MoveAction[] {
  if (pending) return [];
  return MOVE_ACTIONS.filter((a) => {
    const t = TRANSITIONS[a];
    return t.from.includes(status) && (t.at === 'ANY' || (t.at === 'PARTNER') === atPartner);
  });
}

export const STATUS_LABEL: Record<WhDieStatus, string> = {
  READY: 'Sẵn sàng',
  IN_USE: 'Đang bế',
  CHECKING: 'Chờ kiểm',
  REPAIRING: 'Đang sửa',
  DEFECT: 'Lỗi',
  BROKEN: 'Hỏng',
  DISPOSED: 'Thanh lý',
  TRANSIT: 'Đang chuyển',
  INCOMING: 'Khuôn mới, chờ nhận',
};

export const ACTION_LABEL: Record<WhDieAction, string> = {
  CREATE: 'Tạo khuôn',
  ISSUE: 'Xuất khuôn',
  KEEP: 'Bế xong, xưởng giữ',
  RETURN: 'Trả về, chờ kiểm',
  PASS: 'Kiểm đạt, lên kệ',
  DEFECT: 'Báo lỗi',
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
};

/**
 * Ai xác nhận phiếu giao nhận: phía nào là kho thì thủ kho kho đó xác nhận (xuất khi đi, nhận khi đến).
 * Xưởng → xưởng không qua kho nào: thủ kho kho quản lý khuôn xác nhận thay, coi như bước xuất.
 */
export function batchStates(fromIsKho: boolean, toIsKho: boolean): { out: 'PENDING' | 'NONE'; in: 'PENDING' | 'NONE' } {
  return { out: fromIsKho || !toIsKho ? 'PENDING' : 'NONE', in: toIsKho ? 'PENDING' : 'NONE' };
}

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
