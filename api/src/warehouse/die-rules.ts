import type { WhDieAction, WhDieStatus } from '../generated/prisma/enums';

/**
 * Vòng đời khuôn. Vị trí (kho Âu Việt / xưởng ngoài) tách khỏi trạng thái, nên khuôn gửi giữ ở xưởng
 * vẫn là READY tại xưởng đó; chỉ khuôn đã xuất cho một lần bế mới là IN_USE.
 */
export type MoveAction = Exclude<WhDieAction, 'CREATE' | 'EDIT' | 'IMPORT'>;

interface Transition {
  from: WhDieStatus[];
  to: WhDieStatus | 'SAME';
  /** where the die is afterwards */
  place: 'PARTNER' | 'HOME' | 'KEEP' | 'ANY';
}

export const TRANSITIONS: Record<MoveAction, Transition> = {
  ISSUE: { from: ['READY'], to: 'IN_USE', place: 'ANY' }, // ra xưởng bế ngoài, hoặc dùng tại xưởng Âu Việt
  KEEP: { from: ['IN_USE'], to: 'READY', place: 'KEEP' }, // bế xong, xưởng giữ lại khuôn
  RETURN: { from: ['IN_USE', 'READY'], to: 'CHECKING', place: 'HOME' }, // khuôn về kho, chờ kiểm
  PASS: { from: ['CHECKING'], to: 'READY', place: 'HOME' }, // kiểm đạt, lên kệ
  DEFECT: { from: ['CHECKING', 'READY', 'IN_USE'], to: 'DEFECT', place: 'KEEP' }, // lỗi (hoặc hỏng)
  SEND_REPAIR: { from: ['DEFECT', 'CHECKING'], to: 'REPAIRING', place: 'PARTNER' },
  BACK_REPAIR: { from: ['REPAIRING'], to: 'CHECKING', place: 'HOME' },
  DISPOSE: { from: ['READY', 'DEFECT', 'BROKEN', 'CHECKING'], to: 'DISPOSED', place: 'KEEP' },
  MOVE: { from: ['READY'], to: 'SAME', place: 'ANY' }, // đổi kệ, hoặc chuyển sang gửi giữ ở xưởng
};

export function allowedActions(status: WhDieStatus): MoveAction[] {
  return (Object.keys(TRANSITIONS) as MoveAction[]).filter((a) => TRANSITIONS[a].from.includes(status));
}

export const STATUS_LABEL: Record<WhDieStatus, string> = {
  READY: 'Sẵn sàng',
  IN_USE: 'Đang dùng',
  CHECKING: 'Chờ kiểm',
  REPAIRING: 'Đang sửa',
  DEFECT: 'Lỗi',
  BROKEN: 'Hỏng',
  DISPOSED: 'Thanh lý',
};

export const ACTION_LABEL: Record<WhDieAction, string> = {
  CREATE: 'Tạo khuôn',
  ISSUE: 'Xuất khuôn',
  KEEP: 'Bế xong, xưởng giữ lại',
  RETURN: 'Trả về, chờ kiểm',
  PASS: 'Kiểm đạt, nhập kho',
  DEFECT: 'Phát hiện lỗi',
  SEND_REPAIR: 'Chuyển sửa',
  BACK_REPAIR: 'Trả từ sửa',
  DISPOSE: 'Thanh lý',
  MOVE: 'Chuyển vị trí',
  EDIT: 'Sửa thông tin',
  IMPORT: 'Nạp từ Excel',
};

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
