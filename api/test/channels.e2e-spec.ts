import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { hashPassword } from '../src/auth/password';
import { EventProcessor } from '../src/channels/event-processor.service';
import { normalizePermissions } from '../src/access/permissions';
import { FakeFacebook } from './fake-facebook';
import { createTestApp, PASSWORD, resetDatabase, type Api, type TestContext } from './helpers';

const APP_SECRET = 'test-app-secret';
const VERIFY = 'verify-me';

/** Facebook chat end to end against a fake Graph API: connect pages, receive, reply, comments, failures. */
describe('Facebook chat', () => {
  let t: TestContext;
  let fb: FakeFacebook;
  let processor: EventProcessor;
  let filesDir: string;
  let sale: Api; // conversations.reply
  let sale2: Api;
  let saleId: string;

  const sign = (body: string) => 'sha256=' + createHmac('sha256', APP_SECRET).update(body).digest('hex');
  const hook = (payload: object, signature?: string) => {
    const body = JSON.stringify(payload);
    return request(t.app.getHttpServer())
      .post('/api/v1/webhooks/facebook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signature ?? sign(body))
      .send(body);
  };
  const messenger = (mid: string, psid: string, message: object, ts = Date.now()) => ({
    object: 'page',
    entry: [{ id: 'page-1', time: ts, messaging: [{ sender: { id: psid }, recipient: { id: 'page-1' }, timestamp: ts, message: { mid, ...message } }] }],
  });
  const echo = (mid: string, psid: string, message: object) => ({
    object: 'page',
    entry: [{ id: 'page-1', time: Date.now(), messaging: [{ sender: { id: 'page-1' }, recipient: { id: psid }, timestamp: Date.now(), message: { mid, is_echo: true, ...message } }] }],
  });
  const comment = (commentId: string, from: { id: string; name: string }, message: string, parentId?: string, at = Date.now()) => ({
    object: 'page',
    entry: [{
      id: 'page-1',
      time: Date.now(),
      changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: commentId, post_id: 'post-9', parent_id: parentId ?? 'post-9', from, message, created_time: Math.floor(at / 1000) } }],
    }],
  });

  beforeAll(async () => {
    fb = new FakeFacebook();
    await fb.start();
    filesDir = mkdtempSync(join(tmpdir(), 'chat-files-'));
    Object.assign(process.env, {
      FB_APP_SECRET: APP_SECRET,
      FB_VERIFY_TOKEN: VERIFY,
      FB_GRAPH_URL: fb.url,
      CHANNEL_SECRET_KEY: 'a'.repeat(64),
      CHAT_FILES_DIR: filesDir,
    });
    t = await createTestApp();
    processor = t.app.get(EventProcessor);
    await resetDatabase(t);
    const role = await t.prisma.role.create({ data: { name: 'Kinh doanh', permissions: normalizePermissions(['conversations.reply', 'customers.create']) } });
    const passwordHash = await hashPassword(PASSWORD);
    const u = await t.prisma.user.create({ data: { username: 'sale', fullName: 'Lan Sale', roleId: role.id, passwordHash, mustChangePassword: false } });
    await t.prisma.user.create({ data: { username: 'sale2', fullName: 'Minh Sale', roleId: role.id, passwordHash, mustChangePassword: false } });
    saleId = u.id;
    sale = await t.login('sale');
    sale2 = await t.login('sale2');
  });
  afterAll(async () => {
    await t.app.close();
    await fb.stop();
    rmSync(filesDir, { recursive: true, force: true });
    for (const k of ['FB_APP_SECRET', 'FB_VERIFY_TOKEN', 'FB_GRAPH_URL', 'CHANNEL_SECRET_KEY', 'CHAT_FILES_DIR']) delete process.env[k];
  });

  it('verifies the callback URL and rejects unsigned calls', async () => {
    const server = request(t.app.getHttpServer());
    const ok = await server.get('/api/v1/webhooks/facebook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY, 'hub.challenge': '12345' }).expect(200);
    expect(ok.text).toBe('12345');
    await server.get('/api/v1/webhooks/facebook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' }).expect(403);
    expect((await hook(messenger('m1', 'psid-1', { text: 'hi' }), 'sha256=deadbeef').expect(403)).body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    expect(await t.prisma.webhookEvent.count()).toBe(0);
  });

  it('connects pages with a token and keeps the token encrypted', async () => {
    const overview = (await t.api.get('/channels').expect(200)).body;
    expect(overview.setup).toMatchObject({ appSecret: true, verifyToken: true, secretKey: true, callbackPath: '/api/v1/webhooks/facebook' });
    expect((await sale.get('/channels').expect(403)).body.code).toBe('PERMISSION_DENIED');

    expect((await t.api.post('/channels/facebook/pages', { accessToken: 'garbage' }).expect(400)).body.code).toBe('FB_TOKEN_REJECTED');
    const pages = (await t.api.post('/channels/facebook/pages', { accessToken: FakeFacebook.USER_TOKEN }).expect(200)).body.pages;
    expect(pages.map((p: { id: string }) => p.id)).toEqual(['page-1', 'page-2']);

    // a page token works too: it stands for its own page
    const single = (await t.api.post('/channels/facebook/pages', { accessToken: 'page-token-2' }).expect(200)).body.pages;
    expect(single).toEqual([expect.objectContaining({ id: 'page-2', connected: false })]);

    const res = (await t.api.post('/channels/facebook/connect', { accessToken: FakeFacebook.USER_TOKEN, pageIds: ['page-1'] }).expect(200)).body;
    expect(res.results).toEqual([{ pageId: 'page-1', name: 'In Âu Việt', ok: true }]);
    const sub = fb.callsTo('POST', '/page-1/subscribed_apps')[0];
    expect(sub.query.subscribed_fields).toContain('messages');
    expect(sub.query.subscribed_fields).toContain('feed');
    expect(sub.query.access_token).toBe('page-token-1');
    expect(sub.query.appsecret_proof).toMatch(/^[0-9a-f]{64}$/);

    const stored = await t.prisma.channelAccount.findFirstOrThrow({ where: { externalId: 'page-1' } });
    expect(stored.status).toBe('ACTIVE');
    expect(stored.accessTokenEnc).toMatch(/^v1\./);
    expect(stored.accessTokenEnc).not.toContain('page-token-1');
    const list = (await t.api.get('/channels').expect(200)).body.channels;
    expect(JSON.stringify(list)).not.toContain('token');
  });

  it('receives a Messenger message with a photo and a phone number', async () => {
    await hook(messenger('mid-1', 'psid-1', { text: 'Cho mình báo giá 100 hộp, sđt 0912 345 678', attachments: [{ type: 'image', payload: { url: `${fb.url}/files/photo.jpg` } }] })).expect(200);
    await hook(messenger('mid-1', 'psid-1', { text: 'duplicate delivery' })).expect(200);
    // an event for a page that is not connected is skipped
    await hook({ object: 'page', entry: [{ id: 'page-2', messaging: [{ sender: { id: 'psid-x' }, recipient: { id: 'page-2' }, timestamp: Date.now(), message: { mid: 'mid-x', text: 'x' } }] }] }).expect(200);
    expect(await processor.drain()).toBe(3);

    const list = (await sale.get('/conversations').expect(200)).body;
    expect(list.items).toHaveLength(1);
    const row = list.items[0];
    expect(row).toMatchObject({ kind: 'MESSAGE', channelName: 'In Âu Việt', contactName: 'Nguyễn Văn An', unreadCount: 1, lastMessageIn: true, assignee: null });
    expect(row.window.mode).toBe('RESPONSE');
    expect((await sale.get('/conversations/unread').expect(200)).body.conversations).toBe(1);

    const detail = (await sale.get(`/conversations/${row.id}`).expect(200)).body;
    expect(detail.contact.phone).toBe('0912345678');
    const msgs = (await sale.get(`/conversations/${row.id}/messages`).expect(200)).body.items;
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ direction: 'IN', type: 'IMAGE', text: expect.stringContaining('100 hộp') });
    const file = await sale.get(msgs[0].attachments[0].href.replace('/api/v1', '')).expect(200);
    expect(file.headers['content-type']).toBe('image/png');

    await sale.post(`/conversations/${row.id}/read`).expect(204);
    expect((await sale.get('/conversations/unread').expect(200)).body.conversations).toBe(0);
  });

  it('replies from the CRM, takes the conversation, and hides it from others', async () => {
    const [row] = (await sale.get('/conversations').expect(200)).body.items;
    const sent = (await sale.post(`/conversations/${row.id}/messages`, { text: 'Dạ em gửi báo giá ạ' }).expect(201)).body;
    expect(sent).toMatchObject({ direction: 'OUT', status: 'SENT', sender: { fullName: 'Lan Sale' } });
    const call = fb.callsTo('POST', '/page-1/messages').at(-1)!;
    expect(call.body).toMatchObject({ recipient: { id: 'psid-1' }, messaging_type: 'RESPONSE', message: { text: 'Dạ em gửi báo giá ạ', metadata: 'inauviet-erp' } });

    // the echo of our own message is not stored twice; one typed in Meta Business Suite is
    await hook(echo('m_out_x', 'psid-1', { text: 'Dạ em gửi báo giá ạ', metadata: 'inauviet-erp' })).expect(200);
    await hook(echo('mid-bs', 'psid-1', { text: 'Gửi từ Business Suite' })).expect(200);
    await processor.drain();
    const msgs = (await sale.get(`/conversations/${row.id}/messages`).expect(200)).body.items;
    expect(msgs.map((m: { text: string; outsideCrm: boolean }) => [m.text.slice(0, 12), m.outsideCrm])).toEqual([
      ['Cho mình báo', false],
      ['Dạ em gửi bá', false],
      ['Gửi từ Busin', true],
    ]);

    const after = (await sale.get(`/conversations/${row.id}`).expect(200)).body;
    expect(after.assignee).toEqual({ id: saleId, fullName: 'Lan Sale' });
    expect(after.lastMessageIn).toBe(false);
    await sale2.get(`/conversations/${row.id}`).expect(404);
    expect((await sale2.get('/conversations').expect(200)).body.items).toHaveLength(0);
    expect((await sale2.patch(`/conversations/${row.id}`, { assigneeId: null }).expect(404)).body.code).toBe('CONVERSATION_NOT_FOUND');
    // reassigning needs conversations.assign
    expect((await sale.patch(`/conversations/${row.id}`, { assigneeId: null }).expect(403)).body.code).toBe('PERMISSION_DENIED');
    await t.api.get(`/conversations/${row.id}`).expect(200);
  });

  it('applies the 24-hour / 7-day Messenger reply window', async () => {
    const conv = await t.prisma.conversation.findFirstOrThrow({ where: { kind: 'MESSAGE' } });
    await t.prisma.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date(Date.now() - 3 * 86_400_000) } });
    expect((await sale.get(`/conversations/${conv.id}`).expect(200)).body.window.mode).toBe('HUMAN_AGENT');
    await sale.post(`/conversations/${conv.id}/messages`, { text: 'Anh còn cần không ạ?' }).expect(201);
    expect(fb.callsTo('POST', '/page-1/messages').at(-1)!.body).toMatchObject({ messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' });

    await t.prisma.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect((await sale.post(`/conversations/${conv.id}/messages`, { text: 'x' }).expect(400)).body.code).toBe('REPLY_WINDOW_CLOSED');
    await t.prisma.conversation.update({ where: { id: conv.id }, data: { lastInboundAt: new Date() } });
  });

  it('sends a file over Messenger', async () => {
    const conv = await t.prisma.conversation.findFirstOrThrow({ where: { kind: 'MESSAGE' } });
    const agent = request.agent(t.app.getHttpServer());
    await agent.post('/api/v1/auth/login').send({ username: 'sale', password: PASSWORD }).expect(200);
    const res = await agent.post(`/api/v1/conversations/${conv.id}/files`).attach('file', Buffer.from('%PDF-1.4 test'), { filename: 'Báo giá.pdf', contentType: 'application/pdf' }).expect(201);
    expect(res.body).toMatchObject({ type: 'FILE', status: 'SENT', attachments: [{ type: 'file', name: 'Báo giá.pdf', mime: 'application/pdf' }] });
    const call = fb.callsTo('POST', '/page-1/messages').at(-1)!;
    expect(call.contentType).toContain('multipart/form-data');
    expect(call.body as string).toContain('"type":"file"');
    expect(call.body as string).toContain('%PDF-1.4 test');
    const copy = await agent.get(res.body.attachments[0].href).expect(200);
    expect(copy.headers['content-disposition']).toContain(encodeURIComponent('Báo giá.pdf'));
  });

  it('handles fanpage comments: public reply, one private reply, replies typed on Facebook', async () => {
    await hook(comment('c-1', { id: 'u-77', name: 'Trần Thị Bình' }, 'Giá in 500 tờ rơi bao nhiêu ạ?')).expect(200);
    await processor.drain();
    const row = (await sale.get('/conversations?kind=COMMENT').expect(200)).body.items[0];
    expect(row).toMatchObject({ kind: 'COMMENT', contactName: 'Trần Thị Bình', window: { mode: 'COMMENT' } });
    const detail = (await sale.get(`/conversations/${row.id}`).expect(200)).body;
    expect(detail).toMatchObject({ postId: 'post-9', postUrl: 'https://facebook.com/post-9', canPrivateReply: true });

    await sale.post(`/conversations/${row.id}/messages`, { text: 'Shop inbox chị nhé' }).expect(201);
    expect(fb.callsTo('POST', '/c-1/comments')[0].body).toEqual({ message: 'Shop inbox chị nhé' });

    const priv = (await sale.post(`/conversations/${row.id}/messages`, { text: 'Chào chị, giá 500 tờ là…', private: true }).expect(201)).body;
    expect(priv).toMatchObject({ privateReply: true, status: 'SENT' });
    expect(fb.callsTo('POST', '/page-1/messages').at(-1)!.body).toMatchObject({ recipient: { comment_id: 'c-1' } });
    expect((await sale.get(`/conversations/${row.id}`).expect(200)).body.canPrivateReply).toBe(false);
    expect((await sale.post(`/conversations/${row.id}/messages`, { text: 'again', private: true }).expect(409)).body.code).toBe('PRIVATE_REPLY_USED');

    // the page answering on Facebook itself, and the echo of our public reply
    await hook(comment('c-page', { id: 'page-1', name: 'In Âu Việt' }, 'Đã inbox ạ', 'c-1', Date.now() + 2000)).expect(200);
    await hook(comment('reply_x', { id: 'page-1', name: 'In Âu Việt' }, 'unrelated', 'c-unknown')).expect(200);
    await processor.drain();
    const msgs = (await sale.get(`/conversations/${row.id}/messages`).expect(200)).body.items;
    expect(msgs.map((m: { direction: string; outsideCrm: boolean; privateReply: boolean }) => [m.direction, m.outsideCrm, m.privateReply])).toEqual([
      ['IN', false, false],
      ['OUT', false, false],
      ['OUT', false, true],
      ['OUT', true, false],
    ]);
  });

  it('links a customer and searches by name', async () => {
    const conv = await t.prisma.conversation.findFirstOrThrow({ where: { kind: 'MESSAGE' } });
    const customer = (await sale.post('/customers', { name: 'Nguyễn Văn An', phone: '0912345678' }).expect(201)).body;
    const linked = (await sale.put(`/conversations/${conv.id}/customer`, { customerId: customer.id }).expect(200)).body;
    expect(linked.contact.customer).toMatchObject({ code: customer.code, phone: '0912345678' });
    expect((await sale.get('/conversations?q=nguyen').expect(200)).body.items).toHaveLength(1);
    expect((await sale.get('/conversations?q=0912').expect(200)).body.items).toHaveLength(1);
    expect((await sale.get('/conversations?q=khong-co').expect(200)).body.items).toHaveLength(0);
  });

  it('marks done, reopens when the customer writes again, and assigns', async () => {
    const conv = await t.prisma.conversation.findFirstOrThrow({ where: { kind: 'MESSAGE' } });
    await sale.patch(`/conversations/${conv.id}`, { status: 'DONE' }).expect(200);
    expect((await sale.get('/conversations').expect(200)).body.items.some((c: { id: string }) => c.id === conv.id)).toBe(false);
    expect((await sale.get('/conversations?status=DONE').expect(200)).body.items).toHaveLength(1);
    await hook(messenger('mid-2', 'psid-1', { text: 'Mình muốn đặt thêm' })).expect(200);
    await processor.drain();
    const back = (await sale.get(`/conversations/${conv.id}`).expect(200)).body;
    expect(back).toMatchObject({ status: 'OPEN', unreadCount: 1, assignee: { fullName: 'Lan Sale' } });

    const people = (await t.api.get('/conversations/assignees').expect(200)).body.people.map((p: { fullName: string }) => p.fullName);
    expect(people).toEqual(['Admin', 'Lan Sale', 'Minh Sale']);
    const staff = await t.prisma.user.findFirstOrThrow({ where: { username: 'staff' } });
    expect((await t.api.patch(`/conversations/${conv.id}`, { assigneeId: staff.id }).expect(400)).body.code).toBe('ASSIGNEE_NOT_ALLOWED');
    const minh = await t.prisma.user.findFirstOrThrow({ where: { username: 'sale2' } });
    await t.api.patch(`/conversations/${conv.id}`, { assigneeId: minh.id }).expect(200);
    await sale.get(`/conversations/${conv.id}`).expect(404);
    await sale2.get(`/conversations/${conv.id}`).expect(200);
  });

  it('records Facebook refusals: blocked person, revoked token, failing events', async () => {
    // a customer whose profile is hidden still gets a conversation
    await hook(messenger('mid-b', 'psid-blocked', { text: 'xin chào' })).expect(200);
    await processor.drain();
    const blocked = await t.prisma.conversation.findFirstOrThrow({ where: { contact: { externalId: 'psid-blocked' } }, include: { contact: true } });
    expect(blocked.contact.name).toBe('Khách Facebook');
    const failed = (await t.api.post(`/conversations/${blocked.id}/messages`, { text: 'hello' }).expect(201)).body;
    expect(failed).toMatchObject({ status: 'FAILED', error: 'Người này hiện không nhận tin nhắn từ trang.' });

    fb.revoked.add('page-token-1');
    const conv = await t.prisma.conversation.findFirstOrThrow({ where: { contact: { externalId: 'psid-1' } } });
    const res = (await t.api.post(`/conversations/${conv.id}/messages`, { text: 'hello' }).expect(201)).body;
    expect(res.status).toBe('FAILED');
    const channel = (await t.api.get('/channels').expect(200)).body.channels[0];
    expect(channel.status).toBe('ERROR');
    expect(channel.lastError).toContain('Mã truy cập không còn hiệu lực');

    fb.revoked.delete('page-token-1');
    await t.api.post(`/channels/${channel.id}/check`).expect(204);
    expect((await t.api.get('/channels').expect(200)).body.channels[0].status).toBe('ACTIVE');

    // an event that cannot be processed is retried, then given up and shown; "retry" puts it back
    await t.prisma.webhookEvent.create({ data: { platform: 'FACEBOOK', payload: { id: 'page-1', messaging: [null] }, attempts: 4 } });
    await processor.drain();
    const overview = (await t.api.get('/channels').expect(200)).body;
    expect(overview.failedEvents).toHaveLength(1);
    expect(overview.channels[0].lastError).toContain('Không xử lý được sự kiện sau 5 lần');
    expect((await t.api.post('/channels/events/retry').expect(200)).body.count).toBe(1);
    expect((await t.api.get('/channels').expect(200)).body.pendingEvents).toBe(1);
  });

  it('disconnects a page and wipes its token', async () => {
    const channel = await t.prisma.channelAccount.findFirstOrThrow({ where: { externalId: 'page-1' } });
    await t.api.delete(`/channels/${channel.id}`).expect(204);
    expect(fb.callsTo('DELETE', '/page-1/subscribed_apps')).toHaveLength(1);
    const after = await t.prisma.channelAccount.findUniqueOrThrow({ where: { id: channel.id } });
    expect(after).toMatchObject({ status: 'DISCONNECTED', accessTokenEnc: null });
    const conv = await t.prisma.conversation.findFirstOrThrow({ where: { kind: 'MESSAGE', contact: { externalId: 'psid-1' } } });
    expect((await t.api.post(`/conversations/${conv.id}/messages`, { text: 'x' }).expect(400)).body.code).toBe('CHANNEL_DISCONNECTED');
  });
});
