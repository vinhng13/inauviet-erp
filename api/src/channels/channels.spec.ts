import { replyWindow } from './conversations.service';
import { findPhone, parseEntry, previewOf } from './facebook-events';
import { parseKey, SecretBox } from './secret-box';
import { validFacebookSignature } from './webhook.controller';
import { createHmac } from 'node:crypto';

describe('channels', () => {
  it('finds Vietnamese phone numbers in chat text', () => {
    expect(findPhone('sđt 0912 345 678 nhé')).toBe('0912345678');
    expect(findPhone('gọi +84 912.345.678')).toBe('0912345678');
    expect(findPhone('84912345678')).toBe('0912345678');
    expect(findPhone('máy bàn 028 3823 4567')).toBe('02838234567');
    expect(findPhone('in 1000000 tờ')).toBeNull();
    expect(findPhone('mã đơn 0123456789')).toBeNull();
    expect(findPhone(undefined)).toBeNull();
  });

  it('computes the Messenger reply window', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
    expect(replyWindow('MESSAGE', ago(2), now)).toEqual({ mode: 'RESPONSE', until: ago(-22) });
    expect(replyWindow('MESSAGE', ago(30), now)).toEqual({ mode: 'HUMAN_AGENT', until: ago(30 - 168) });
    expect(replyWindow('MESSAGE', ago(200), now).mode).toBe('CLOSED');
    expect(replyWindow('MESSAGE', null, now).mode).toBe('CLOSED');
    expect(replyWindow('COMMENT', null, now).mode).toBe('COMMENT');
  });

  it('parses messages, echoes, postbacks and comments', () => {
    const parsed = parseEntry({
      id: 'P',
      messaging: [
        { sender: { id: 'U' }, recipient: { id: 'P' }, timestamp: 1, message: { mid: 'a', attachments: [{ type: 'image', payload: { url: 'http://x/1.jpg' } }] } },
        { sender: { id: 'P' }, recipient: { id: 'U' }, timestamp: 2, message: { mid: 'b', text: 'hi', is_echo: true, metadata: 'inauviet-erp' } },
        { sender: { id: 'U' }, recipient: { id: 'P' }, timestamp: 3, postback: { mid: 'c', title: 'Báo giá' } },
        { sender: { id: 'U' }, recipient: { id: 'P' }, timestamp: 4, message: { mid: 'd', attachments: [{ type: 'image', payload: { url: 'http://x/s.png', sticker_id: 369239263222822 } }] } },
      ],
      changes: [
        { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'cm', post_id: 'P_1', parent_id: 'P_1', from: { id: 'U2', name: 'Bình' }, message: 'giá?' } },
        { field: 'feed', value: { item: 'reaction', verb: 'add', post_id: 'P_1', from: { id: 'U3' } } },
      ],
    });
    expect(parsed.map((m) => [m.externalId, m.direction, m.type, m.ownEcho, m.userId])).toEqual([
      ['a', 'IN', 'IMAGE', false, 'U'],
      ['b', 'OUT', 'TEXT', true, 'U'],
      ['c', 'IN', 'TEXT', false, 'U'],
      ['d', 'IN', 'STICKER', false, 'U'],
      ['cm', 'IN', 'TEXT', false, 'U2'],
    ]);
    expect(parsed[4]).toMatchObject({ kind: 'COMMENT', postId: 'P_1', parentId: undefined, userName: 'Bình' });
    expect(previewOf({ type: 'IMAGE', text: null })).toBe('[Ảnh]');
    expect(previewOf({ type: 'TEXT', text: 'ok', privateReply: true })).toBe('[Nhắn riêng] ok');
  });

  it('encrypts tokens with AES-256-GCM', () => {
    const box = new SecretBox(parseKey('b'.repeat(64)));
    const sealed = box.seal('EAAB-token');
    expect(sealed).not.toContain('EAAB');
    expect(box.open(sealed)).toBe('EAAB-token');
    expect(box.seal('x')).not.toBe(box.seal('x'));
    expect(() => new SecretBox(parseKey('c'.repeat(64))).open(sealed)).toThrow();
    expect(parseKey('short')).toBeNull();
    expect(() => new SecretBox(null).seal('x')).toThrow('CHANNEL_SECRET_KEY');
  });

  it('checks webhook signatures on the raw body', () => {
    const raw = Buffer.from('{"object":"page"}');
    const good = 'sha256=' + createHmac('sha256', 's3cret').update(raw).digest('hex');
    expect(validFacebookSignature(raw, good, 's3cret')).toBe(true);
    expect(validFacebookSignature(Buffer.from('{"object":"page" }'), good, 's3cret')).toBe(false);
    expect(validFacebookSignature(raw, good, 'other')).toBe(false);
    expect(validFacebookSignature(raw, undefined, 's3cret')).toBe(false);
  });
});
