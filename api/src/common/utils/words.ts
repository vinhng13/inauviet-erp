const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];
const UNITS = ['', ' nghìn', ' triệu', ' tỷ', ' nghìn tỷ'];

function threeDigits(x: number, full: boolean): string {
  const h = Math.floor(x / 100);
  const t = Math.floor((x % 100) / 10);
  const u = x % 10;
  const w: string[] = [];
  if (full || h > 0) w.push(`${DIGITS[h]} trăm`);
  if (t > 1) {
    w.push(`${DIGITS[t]} mươi`);
    if (u === 1) w.push('mốt');
    else if (u === 4) w.push('tư');
    else if (u === 5) w.push('lăm');
    else if (u > 0) w.push(DIGITS[u]);
  } else if (t === 1) {
    w.push('mười');
    if (u === 5) w.push('lăm');
    else if (u > 0) w.push(DIGITS[u]);
  } else if (u > 0) {
    if (full || h > 0) w.push('lẻ');
    w.push(DIGITS[u]);
  }
  return w.join(' ');
}

/** 1.440.000 → "Một triệu bốn trăm bốn mươi nghìn đồng" (for "Bằng chữ" on printed documents) */
export function vndInWords(value: number): string {
  let n = Math.round(value);
  if (n <= 0) return 'Không đồng';
  const groups: number[] = [];
  while (n > 0) {
    groups.push(n % 1000);
    n = Math.floor(n / 1000);
  }
  const out: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    out.push(threeDigits(groups[i], i < groups.length - 1) + UNITS[i]);
  }
  const s = out.join(' ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} đồng`;
}
