import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { crc32, deflateSync } from 'node:zlib';

/** A small real PNG (solid colour with a darker band) so chat images render in screenshots */
function samplePng(w = 160, h = 110): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows: Buffer[] = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    for (let x = 0; x < w; x++) {
      const band = y > h * 0.35 && y < h * 0.65;
      row.set(band ? [150, 105, 60] : [196, 154, 108], 1 + x * 3);
    }
    rows.push(row);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

export interface FakeCall {
  method: string;
  path: string;
  query: Record<string, string>;
  /** Parsed JSON body, or the raw multipart text */
  body: unknown;
  contentType: string;
}

/**
 * A stand-in for graph.facebook.com used by the e2e tests: two pages, one Messenger user, posts and comments.
 * Records every call so tests can check what the CRM sent.
 */
export class FakeFacebook {
  readonly calls: FakeCall[] = [];
  /** Tokens Facebook should treat as expired (error 190) */
  readonly revoked = new Set<string>();
  private server!: Server;
  private seq = 0;
  url = '';

  static readonly USER_TOKEN = 'EAAG-system-user-token-for-tests';
  static readonly PAGES = [
    { id: 'page-1', name: 'In Âu Việt', access_token: 'page-token-1' },
    { id: 'page-2', name: 'In Âu Việt – Chi nhánh 2', access_token: 'page-token-2' },
  ];

  async start(port = 0): Promise<void> {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    return new Promise((r) => this.server.close(() => r()));
  }

  callsTo(method: string, path: string): FakeCall[] {
    return this.calls.filter((c) => c.method === method && c.path === path);
  }

  private async handle(req: IncomingMessage, res: import('node:http').ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.url);
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');
    const contentType = req.headers['content-type'] ?? '';
    const body = contentType.includes('json') && raw ? JSON.parse(raw) : raw;
    const query = Object.fromEntries(url.searchParams);
    const path = url.pathname.replace(/^\/v\d+\.\d+/, '');
    this.calls.push({ method: req.method ?? 'GET', path, query, body, contentType });

    const send = (status: number, data: unknown, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
    };
    const fail = (code: number, message: string, subcode?: number) => send(400, { error: { message, type: 'OAuthException', code, error_subcode: subcode } });

    if (path === '/files/photo.jpg') return send(200, samplePng(), 'image/png');

    const token = query.access_token;
    if (!token || this.revoked.has(token)) return fail(190, 'Error validating access token: Session has expired');
    const page = FakeFacebook.PAGES.find((p) => p.access_token === token);

    if (path === '/me/accounts') {
      if (page) return fail(100, '(#100) Tried accessing nonexisting field (accounts) on node type (Page)');
      if (token !== FakeFacebook.USER_TOKEN) return fail(190, 'Invalid OAuth access token');
      return send(200, { data: FakeFacebook.PAGES.map((p) => ({ ...p, picture: { data: { url: `${this.url}/pic/${p.id}.jpg` } } })) });
    }
    if (path === '/me' && page) return send(200, { id: page.id, name: page.name });
    if (/^\/page-\d\/subscribed_apps$/.test(path)) return send(200, { success: true });
    if (/^\/page-\d$/.test(path)) return send(200, { id: path.slice(1), name: 'x' });
    if (path === '/psid-blocked') return fail(10, 'Profile hidden');
    if (path.startsWith('/psid-')) return send(200, { name: 'Nguyễn Văn An', profile_pic: `${this.url}/files/photo.jpg` });
    if (path.startsWith('/post-')) return send(200, { permalink_url: `https://facebook.com/${path.slice(1)}`, message: 'Bài viết' });
    if (/^\/page-\d\/messages$/.test(path) && req.method === 'POST') {
      const text = typeof body === 'string' ? body : JSON.stringify(body);
      if (text.includes('psid-blocked')) return fail(551, 'This person isn\'t available right now.', 1545041);
      return send(200, { recipient_id: 'x', message_id: `m_out_${++this.seq}` });
    }
    if (/^\/[^/]+\/comments$/.test(path) && req.method === 'POST') return send(200, { id: `reply_${++this.seq}` });
    send(404, { error: { message: `Unknown path ${path}`, code: 803 } });
  }
}
