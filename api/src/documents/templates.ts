import type { Column, Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import { vndInWords } from '../common/utils/words';
import type { OrderDetailDto, QuoteChangeDto } from '../orders/orders.dto';
import type { QuoteDto } from '../quotes/quotes.dto';

/**
 * A4 layouts of the printed documents. Temporary: they follow the prototype and will be replaced
 * by the company's own templates. Pure functions from API data to a pdfmake definition.
 */
export type DocKind = 'quote' | 'order' | 'design' | 'lsx' | 'acceptance' | 'invoice';
export const DOC_KINDS: DocKind[] = ['quote', 'order', 'design', 'lsx', 'acceptance', 'invoice'];

export const DOC_META: Record<DocKind, { label: string; suffix: string; title: string; priced: boolean }> = {
  quote: { label: 'Báo giá', suffix: 'BaoGia', title: 'BÁO GIÁ', priced: true },
  order: { label: 'Đơn hàng', suffix: 'DonHang', title: 'ĐƠN ĐẶT HÀNG', priced: true },
  design: { label: 'Duyệt thiết kế', suffix: 'DuyetThietKe', title: 'PHIẾU DUYỆT THIẾT KẾ', priced: false },
  lsx: { label: 'Lệnh sản xuất', suffix: 'LenhSanXuat', title: 'LỆNH SẢN XUẤT', priced: false },
  acceptance: { label: 'Nghiệm thu', suffix: 'NghiemThu', title: 'BIÊN BẢN NGHIỆM THU VÀ BÀN GIAO', priced: false },
  invoice: { label: 'Hoá đơn', suffix: 'HoaDon', title: 'HOÁ ĐƠN BÁN HÀNG', priced: true },
};

export interface Company {
  name: string;
  address: string;
  phone: string;
  taxCode: string;
}

export interface Ctx {
  company: Company;
  /** Who prints the document (signs as the shop where no other name applies) */
  printedBy: string;
  /** Today, YYYY-MM-DD in the shop's time zone */
  today: string;
}

const BLUE = '#0a6f9c';
const GREY = '#55626f';
const LINE = '#c7cfd7';
const HEAD = '#eef3f6';

// ───────────── Formatting ─────────────

export const vnd = (n: number | null | undefined) => (n == null ? '—' : `${new Intl.NumberFormat('vi-VN').format(n)} đ`);
const qty = (n: number) => new Intl.NumberFormat('vi-VN').format(n);
const dec = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
/** "2026-11-02" or an ISO timestamp → "02/11/2026" */
export const date = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : '…');

interface Line {
  description: string;
  baseName?: string;
  spec: string | null;
  widthM: number | null;
  heightM: number | null;
  unit: string | null;
  quantity: number;
  areaPriceVnd?: number | null;
  unitPriceVnd?: number | null;
  lineTotalVnd?: number | null;
  deliveredQty?: number;
}
const sized = (l: Line) => l.widthM !== null && l.heightM !== null;
const size = (l: Line) => (sized(l) ? `${dec(l.widthM!)} × ${dec(l.heightM!)} m` : '—');
const area = (l: Line) => (sized(l) ? `${dec(l.widthM! * l.heightM! * l.quantity)} m²` : '—');
const name = (l: Line) => l.baseName ?? l.description;
const price = (l: Line) => (l.areaPriceVnd != null ? `${vnd(l.areaPriceVnd)}/m²` : vnd(l.unitPriceVnd));

// ───────────── Building blocks ─────────────

function header(ctx: Ctx, kind: DocKind, number: string, day: string): Content[] {
  const c = ctx.company;
  return [
    {
      columns: [
        {
          width: 30,
          table: { widths: [26], body: [[{ text: 'ÂV', color: '#ffffff', bold: true, fillColor: BLUE, alignment: 'center', margin: [0, 6, 0, 6] }]] },
          layout: 'noBorders',
        },
        {
          width: '*',
          stack: [{ text: c.name.toLocaleUpperCase('vi'), bold: true, fontSize: 13 }, c.address, `ĐT: ${c.phone} · MST: ${c.taxCode}`],
        },
        { width: 'auto', alignment: 'right', stack: [{ text: ['Số: ', { text: number, bold: true }] }, `Ngày: ${date(day)}`] },
      ],
      columnGap: 8,
    },
    { canvas: [{ type: 'line', x1: 0, y1: 6, x2: 515, y2: 6, lineWidth: 1.5, lineColor: BLUE }], margin: [0, 0, 0, 10] },
    { text: DOC_META[kind].title, alignment: 'center', bold: true, fontSize: 16, characterSpacing: 0.5, margin: [0, 4, 0, 10] },
  ];
}

function customer(
  c: { name: string; phone: string; address?: string | null; companyName?: string | null; taxCode?: string | null },
  extra: Array<[string, string | null | undefined]> = [],
  withAddress = true,
): Content {
  const row = (k: string, v: Content): Content => ({ text: [{ text: `${k}: `, color: GREY }, v as string] });
  return {
    stack: [
      { text: [{ text: 'Khách hàng: ', color: GREY }, { text: c.name, bold: true }, c.companyName ? ` · ${c.companyName}` : ''] },
      { text: [{ text: 'Điện thoại: ', color: GREY }, c.phone, ...(c.taxCode ? [{ text: ' · MST: ', color: GREY }, c.taxCode] : [])] },
      ...(withAddress ? [row('Địa chỉ', c.address || '…')] : []),
      ...extra.filter(([, v]) => v).map(([k, v]) => row(k, v!)),
    ],
    margin: [0, 0, 0, 10],
  };
}

const th = (text: string, alignment: 'left' | 'right' | 'center' = 'left'): TableCell => ({ text, bold: true, fontSize: 9, fillColor: HEAD, alignment });

function table(widths: Array<number | string>, head: TableCell[], body: TableCell[][]): Content {
  return {
    table: { headerRows: 1, widths, body: [head, ...body], dontBreakRows: true },
    layout: { hLineColor: () => LINE, vLineColor: () => LINE, paddingTop: () => 4, paddingBottom: () => 4, paddingLeft: () => 5, paddingRight: () => 5 },
    margin: [0, 0, 0, 10],
  };
}

function box(children: Content[]): Content {
  return {
    table: { widths: ['*'], body: [[{ stack: children }]] },
    layout: { hLineColor: () => LINE, vLineColor: () => LINE, paddingTop: () => 6, paddingBottom: () => 6, paddingLeft: () => 8, paddingRight: () => 8 },
    margin: [0, 0, 0, 10],
  };
}

function pricedLines(lines: Line[], total: number | null, paid?: number): Content[] {
  const body = lines.map((l, i): TableCell[] => [
    String(i + 1),
    { stack: [name(l), ...(l.spec ? [{ text: l.spec, fontSize: 8, color: GREY }] : [])] },
    size(l),
    l.unit ?? '',
    { text: qty(l.quantity), alignment: 'right' },
    { text: price(l), alignment: 'right' },
    { text: vnd(l.lineTotalVnd), alignment: 'right' },
  ]);
  const totals: Array<[string, string, boolean]> = [
    ['Cộng tiền hàng', vnd(total), true],
    ['Thuế GTGT', 'Chưa bao gồm', false],
    ...(paid !== undefined
      ? ([
          ['Đã thanh toán', vnd(paid), false],
          ['Còn phải thanh toán', vnd(Math.max(0, (total ?? 0) - paid)), true],
        ] as Array<[string, string, boolean]>)
      : []),
  ];
  return [
    table([22, '*', 70, 34, 30, 82, 78], [th('STT'), th('Hạng mục'), th('Quy cách'), th('ĐVT'), th('SL', 'right'), th('Đơn giá', 'right'), th('Thành tiền', 'right')], body),
    {
      columns: [
        { width: '*', text: '' },
        {
          width: 230,
          table: { widths: ['*', 'auto'], body: totals.map(([k, v, b]) => [k, { text: v, bold: b, alignment: 'right' }]) },
          layout: 'noBorders',
        },
      ],
      margin: [0, 0, 0, 6],
    },
    ...(total !== null ? [{ text: `Bằng chữ: ${vndInWords(total)}.`, italics: true, margin: [0, 0, 0, 10] } as Content] : []),
  ];
}

/** Empty square to tick by hand (the font has no ☐ glyph) */
function checkbox(label: string): Column {
  return {
    width: '*',
    columns: [
      { width: 14, canvas: [{ type: 'rect', x: 0, y: 2, w: 9, h: 9, lineWidth: 0.8, lineColor: GREY }] },
      { width: '*', text: label },
    ],
  };
}

function signatures(left: string, right: string, leftName?: string | null, rightName?: string | null): Content {
  const col = (title: string, who?: string | null): Column => ({
    width: '*',
    alignment: 'center',
    stack: [{ text: title, bold: true }, { text: '(Ký, ghi rõ họ tên)', italics: true, fontSize: 9, color: GREY }, { text: who ?? '', bold: true, margin: [0, 56, 0, 0] }],
  });
  return { columns: [col(left, leftName), col(right, rightName)], margin: [0, 24, 0, 0], unbreakable: true };
}

function page(ctx: Ctx, title: string, content: Content[]): TDocumentDefinitions {
  return {
    pageSize: 'A4',
    pageMargins: [40, 36, 40, 44],
    info: { title, author: ctx.company.name, creator: 'Inauviet ERP' },
    defaultStyle: { font: 'Roboto', fontSize: 10, lineHeight: 1.2 },
    footer: (current, count) => ({
      columns: [
        { text: 'Mẫu tạm, sẽ thay theo biểu mẫu của công ty', fontSize: 7, color: '#9aa6b2' },
        { text: `Trang ${current}/${count}`, alignment: 'right', fontSize: 8, color: GREY },
      ],
      margin: [40, 12, 40, 0],
    }),
    content,
  };
}

// ───────────── Documents ─────────────

export function quoteDoc(q: QuoteDto, ctx: Ctx): TDocumentDefinitions {
  return page(ctx, `Báo giá ${q.code}`, [
    ...header(ctx, 'quote', q.code, q.quoteDate),
    customer(q.customer, [['Nội dung', q.title]]),
    { text: `${ctx.company.name} trân trọng gửi Quý khách báo giá các hạng mục như sau:`, margin: [0, 0, 0, 8] },
    ...pricedLines(q.lines, q.totalVnd ?? null),
    { text: 'Điều khoản', bold: true },
    {
      ul: [
        `Báo giá có hiệu lực ${q.validDays} ngày kể từ ngày lập (đến ${date(q.validUntil)}).`,
        'Đơn giá chưa bao gồm thuế GTGT.',
        'Thời gian thực hiện: [số ngày] kể từ khi khách duyệt thiết kế.',
        'Thanh toán: đặt cọc theo thoả thuận (không bắt buộc), phần còn lại khi nghiệm thu bàn giao.',
        ...(q.note ? [q.note] : []),
      ],
      margin: [0, 2, 0, 0],
    },
    signatures('Xác nhận của khách hàng', 'Người lập báo giá', null, q.createdByName),
  ]);
}

const tail = (code: string) => code.slice(3);
export function orderDocNumber(kind: Exclude<DocKind, 'quote'>, o: { code: string; productionCode?: string | null }): string {
  switch (kind) {
    case 'order':
      return o.code;
    case 'design':
      return `TK-${tail(o.code)}`;
    case 'lsx':
      return o.productionCode ?? `LSX-${tail(o.code)}`;
    case 'acceptance':
      return `NT-${tail(o.code)}`;
    case 'invoice':
      return `HD-${tail(o.code)}`;
  }
}

function designText(o: OrderDetailDto): string {
  const d = o.design;
  if (o.needsDesign === false) return 'Khách cung cấp file in sẵn';
  if (d.approvedVersion) return `Theo maket v${d.approvedVersion}, khách duyệt ngày ${date(d.approvedAt)} qua ${d.approvalChannel ?? '—'}`;
  return 'Có thiết kế (đang thực hiện)';
}

function changeText(c: QuoteChangeDto): string {
  if (c.kind === 'ADDED') return `Thêm ${c.description} × ${c.toQuantity}`;
  if (c.kind === 'REMOVED') return `Bỏ ${c.description}`;
  return [c.fromDescription ? `${c.fromDescription} → ${c.description}` : c.description, c.fromQuantity !== null ? `số lượng ${c.fromQuantity} → ${c.toQuantity}` : '', c.priceChanged ? 'đổi đơn giá' : '']
    .filter(Boolean)
    .join(' · ');
}

export function orderDoc(kind: Exclude<DocKind, 'quote'>, o: OrderDetailDto, ctx: Ctx): TDocumentDefinitions {
  const number = orderDocNumber(kind, { code: o.code, productionCode: o.production?.code });
  const title = `${DOC_META[kind].label} ${number}`;
  const ref: [string, string] = ['Đơn hàng', o.code];
  const label = (k: string, v: string): Content => ({ text: [{ text: `${k}: `, color: GREY }, v] });

  switch (kind) {
    case 'order':
      return page(ctx, title, [
        ...header(ctx, kind, number, o.orderDate),
        customer(o.customer, [
          ['Theo báo giá', o.quote?.code],
          ['Hạn giao', o.dueDate ? date(o.dueDate) : null],
        ]),
        ...pricedLines(o.lines, o.totalVnd, o.paidVnd > 0 ? o.paidVnd : undefined),
        box([
          label('Thiết kế', designText(o)),
          ...(o.quote && o.quote.changes.length
            ? [
                {
                  text: `Điều chỉnh so với báo giá ${o.quote.code}${o.quote.totalVnd !== undefined ? ` (giá trị ban đầu ${vnd(o.quote.totalVnd)})` : ''}:`,
                  bold: true,
                  margin: [0, 4, 0, 0],
                } as Content,
                { ul: o.quote.changes.map(changeText) } as Content,
              ]
            : []),
          ...(o.note ? [label('Ghi chú', o.note)] : []),
        ]),
        'Khách hàng ký xác nhận các hạng mục, số lượng và giá trị trên là đúng yêu cầu đặt hàng.',
        signatures('Đại diện khách hàng', `Đại diện ${ctx.company.name}`, o.customer.name, ctx.printedBy),
      ]);

    case 'design': {
      const d = o.design;
      const fb = { APPROVED: 'Khách đồng ý', CHANGES_REQUESTED: 'Yêu cầu sửa', PENDING: 'Chờ phản hồi' } as const;
      return page(ctx, title, [
        ...header(ctx, kind, number, d.approvedAt ?? ctx.today),
        customer(o.customer, [ref]),
        table(
          [36, 62, '*', '*'],
          [th('Bản'), th('Ngày gửi'), th('Nội dung gửi'), th('Phản hồi của khách')],
          d.versions.map((v) => [`v${v.version}`, date(v.sentAt), v.note ?? '', `${fb[v.feedback]}${v.feedbackNote ? `: ${v.feedbackNote}` : ''}`]),
        ),
        box([
          { text: 'Xác nhận duyệt', bold: true },
          d.approvedVersion
            ? `Khách duyệt maket v${d.approvedVersion} ngày ${date(d.approvedAt)} qua ${d.approvalChannel ?? '—'} · người duyệt: ${d.approvedByName ?? '—'}`
            : 'Chưa có xác nhận duyệt',
          label('Hạng mục áp dụng', o.lines.map((l) => l.description).join('; ')),
        ]),
        'Khách hàng xác nhận đồng ý bản thiết kế trên để đưa vào sản xuất. [Điều khoản về chỉnh sửa sau khi duyệt]',
        { text: 'File maket gốc lưu ngoài hệ thống (giai đoạn này chưa quản lý file).', fontSize: 8, color: GREY, margin: [0, 4, 0, 0] },
        signatures('Khách hàng duyệt', 'Người thiết kế', d.approvedByName, d.designer?.fullName),
      ]);
    }

    case 'lsx': {
      const p = o.production;
      return page(ctx, title, [
        ...header(ctx, kind, number, p?.startedAt ?? ctx.today),
        customer(o.customer, [ref], false),
        box([
          {
            columns: [
              label('Hạn xong', p?.dueDate ? date(p.dueDate) : '…'),
              { text: [{ text: 'Ưu tiên: ', color: GREY }, { text: p?.priority === 'URGENT' ? 'GẤP' : 'Thường', bold: true }] },
              label('Thiết kế', o.design.designer?.fullName ?? '—'),
            ],
          },
          label('Làm theo', designText(o)),
          ...(p?.note ? [label('Ghi chú', p.note)] : []),
        ]),
        table(
          [22, '*', 70, 34, 30, 60, 110],
          [th('STT'), th('Hạng mục'), th('Quy cách'), th('ĐVT'), th('SL', 'right'), th('Tổng diện tích'), th('Ghi chú kỹ thuật')],
          o.lines.map((l, i) => [String(i + 1), name(l), size(l), l.unit ?? '', { text: qty(l.quantity), alignment: 'right' }, area(l), l.spec ?? '']),
        ),
        { text: 'Theo dõi công đoạn', bold: true, margin: [0, 0, 0, 4] },
        table(
          ['*', '*', '*', 70],
          [th('Công đoạn'), th('Người làm'), th('Ngày / giờ xong'), th('Ký')],
          ['Nhận lệnh', 'In', 'Gia công', 'Kiểm tra', 'Xong'].map((s) => [{ text: s, margin: [0, 4, 0, 4] }, '', '', '']),
        ),
        signatures('Người nhận lệnh (xưởng)', 'Người lập lệnh', null, ctx.printedBy),
      ]);
    }

    case 'acceptance': {
      const trips = o.deliveries.filter((t) => t.status === 'DELIVERED');
      const day = o.acceptance?.acceptedAt ?? ctx.today;
      return page(ctx, title, [
        ...header(ctx, kind, number, day),
        customer(o.customer, [ref]),
        {
          text: `Hôm nay, ngày ${date(day)}, ${ctx.company.name} bàn giao cho ${o.customer.name} các hạng mục dưới đây thuộc đơn hàng ${o.code}. Chuyến giao: ${
            trips.map((t) => `${t.code} (${date(t.deliveredAt)})`).join(', ') || '…'
          }.`,
          margin: [0, 0, 0, 8],
        },
        table(
          [22, '*', 70, 34, 42, 42, 30],
          [th('STT'), th('Hạng mục'), th('Quy cách'), th('ĐVT'), th('SL đặt', 'right'), th('SL giao', 'right'), th('Đạt', 'center')],
          o.lines.map((l, i) => [
            String(i + 1),
            name(l),
            size(l),
            l.unit ?? '',
            { text: qty(l.quantity), alignment: 'right' },
            { text: l.deliveredQty ? qty(l.deliveredQty) : '', alignment: 'right' },
            '',
          ]),
        ),
        box([
          { text: 'Kết luận nghiệm thu', bold: true },
          { columns: [checkbox('Đạt yêu cầu, khách đồng ý nhận hàng'), checkbox('Cần khắc phục (ghi rõ bên dưới)')], margin: [0, 2, 0, 2] },
          `Ý kiến khách hàng: ${o.acceptance?.note ?? '.......................................................................................................'}`,
          '..............................................................................................................................................',
        ]),
        'Biên bản lập thành 02 bản, mỗi bên giữ 01 bản có giá trị như nhau.',
        signatures('Bên nhận (khách hàng)', `Bên giao (${ctx.company.name})`, o.acceptance?.acceptedByName ?? o.customer.name, ctx.printedBy),
      ]);
    }

    case 'invoice': {
      const pays = o.payments.filter((p) => !p.voidedAt);
      const method = { CASH: 'Tiền mặt', BANK_TRANSFER: 'Chuyển khoản', OTHER: 'Khác' } as const;
      return page(ctx, title, [
        ...header(ctx, kind, number, ctx.today),
        customer(o.customer, [ref]),
        ...pricedLines(o.lines, o.totalVnd, o.paidVnd),
        { text: 'Lịch sử thanh toán', bold: true, margin: [0, 0, 0, 4] },
        pays.length
          ? table(
              [22, 62, 80, '*', 90],
              [th('STT'), th('Ngày'), th('Hình thức'), th('Ghi chú'), th('Số tiền', 'right')],
              pays.map((p, i) => [
                String(i + 1),
                date(p.paidOn),
                method[p.method],
                p.isDeposit ? 'Đặt cọc' : p.deliveryCode ? `Thu khi giao ${p.deliveryCode}` : (p.note ?? ''),
                { text: vnd(p.amountVnd), alignment: 'right' },
              ]),
            )
          : { text: 'Chưa có khoản thu nào.', margin: [0, 0, 0, 8] },
        { text: 'Chứng từ nội bộ của cửa hàng, không thay thế hoá đơn GTGT điện tử.', fontSize: 8, color: GREY },
        signatures('Người mua hàng', 'Người bán hàng', o.customer.name, ctx.printedBy),
      ]);
    }
  }
}
