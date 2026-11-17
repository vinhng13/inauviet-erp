import { inflateRawSync } from 'node:zlib';

/**
 * Minimal .xlsx reader (no dependency): unzips the workbook and returns each sheet as rows of cell values.
 * Reads the values Excel cached for formula cells, which is what the warehouse workbook needs
 * (its codes and statuses are formulas). Dates come back as Excel serial numbers.
 */
export type Cell = string | number | null;

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  // End of central directory: signature 0x06054b50, searched from the end
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + compSize);
    if (method === 0) files.set(name, Buffer.from(data));
    else if (method === 8) files.set(name, inflateRawSync(data));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)![0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Sheet name → rows (row 1 = index 0). Empty cells are null. */
export function readXlsx(buf: Buffer): Map<string, Cell[][]> {
  const files = unzip(buf);
  const text = (name: string) => files.get(name)?.toString('utf8') ?? '';

  const shared: string[] = [];
  for (const si of text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    shared.push(decode([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  }

  const rels = new Map<string, string>();
  for (const r of text('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = r[0].match(/Id="([^"]+)"/)?.[1];
    const target = r[0].match(/Target="([^"]+)"/)?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }

  const sheets = new Map<string, Cell[][]>();
  for (const s of text('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const name = decode(s[0].match(/name="([^"]+)"/)?.[1] ?? '');
    const rid = s[0].match(/r:id="([^"]+)"/)?.[1];
    const xml = rid ? text(rels.get(rid) ?? '') : '';
    const rows: Cell[][] = [];
    for (const row of xml.matchAll(/<row\b[^>]*?r="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const r = Number(row[1]) - 1;
      const cells: Cell[] = [];
      for (const c of (row[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = c[1].match(/r="([A-Z]+\d+)"/)?.[1];
        if (!ref) continue;
        const type = c[1].match(/t="([^"]+)"/)?.[1];
        const body = c[2] ?? '';
        let value: Cell = null;
        if (type === 'inlineStr') {
          value = decode([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        } else {
          const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
          if (v !== undefined) {
            if (type === 's') value = shared[Number(v)] ?? null;
            else if (type === 'str' || type === 'e') value = decode(v);
            else if (type === 'b') value = v === '1' ? 1 : 0;
            else value = Number(v);
          }
        }
        if (typeof value === 'string' && value.trim() === '') value = null;
        cells[colIndex(ref)] = value;
      }
      rows[r] = Array.from(cells, (v) => v ?? null);
    }
    sheets.set(name, Array.from(rows, (r) => r ?? []));
  }
  return sheets;
}

/** Excel serial (1900 system) or "d/m/yyyy" text → "YYYY-MM-DD"; null when it is not a usable date */
export function excelDate(value: Cell): string | null {
  if (value === null) return null;
  if (typeof value === 'number') {
    if (value < 2) return null; // 0 / 1 = empty date shown as 1900
    const ms = Math.round((value - 25569) * 86_400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const m = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
