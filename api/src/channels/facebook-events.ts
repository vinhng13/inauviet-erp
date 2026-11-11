import type { StoredAttachment } from './chat-files';
import { ECHO_METADATA } from './facebook-graph';

/** One "entry" of a Facebook page webhook (see developers.facebook.com/docs/messenger-platform/webhooks). */
export interface FbEntry {
  id: string; // page id
  time?: number;
  messaging?: FbMessaging[];
  changes?: Array<{ field: string; value: FbFeedValue }>;
}

interface FbAttachment {
  type: string;
  payload?: { url?: string; sticker_id?: number; title?: string } | null;
  title?: string;
}

interface FbMessaging {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    metadata?: string;
    attachments?: FbAttachment[];
    sticker_id?: number;
  };
  postback?: { mid?: string; title?: string; payload?: string };
}

export interface FbFeedValue {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  parent_id?: string;
  from?: { id: string; name?: string };
  message?: string;
  photo?: string;
  video?: string;
  created_time?: number;
  post?: { permalink_url?: string };
}

/** A message in normalized form, whatever kind of Facebook event it came from. */
export interface ParsedMessage {
  kind: 'MESSAGE' | 'COMMENT';
  externalId: string;
  /** PSID (Messenger) or user id (comment author) of the customer */
  userId: string;
  userName?: string;
  /** IN: the customer wrote; OUT: the page wrote from Facebook / Meta Business Suite */
  direction: 'IN' | 'OUT';
  /** The page's own echo of a message the CRM sent: already stored */
  ownEcho: boolean;
  type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'STICKER' | 'OTHER';
  text?: string;
  attachments: StoredAttachment[];
  sentAt: Date;
  /** Comments */
  postId?: string;
  postUrl?: string;
  parentId?: string;
}

const TYPES: Record<string, StoredAttachment['type']> = { image: 'image', video: 'video', audio: 'audio', file: 'file' };

function attachmentOf(a: FbAttachment): StoredAttachment {
  if (a.payload?.sticker_id) return { type: 'sticker', url: a.payload.url };
  return { type: TYPES[a.type] ?? 'other', url: a.payload?.url ?? undefined, name: a.title ?? a.payload?.title };
}

function typeOf(text: string | undefined, atts: StoredAttachment[]): ParsedMessage['type'] {
  if (!atts.length) return 'TEXT';
  const first = atts[0].type;
  if (first === 'sticker') return 'STICKER';
  if (first === 'image') return 'IMAGE';
  if (first === 'video') return 'VIDEO';
  if (first === 'audio') return 'AUDIO';
  if (first === 'file') return 'FILE';
  return text ? 'TEXT' : 'OTHER';
}

/** Turns a webhook entry into the messages it carries. Read and delivery receipts are ignored. */
export function parseEntry(entry: FbEntry): ParsedMessage[] {
  const pageId = entry.id;
  const out: ParsedMessage[] = [];

  for (const ev of entry.messaging ?? []) {
    const sentAt = new Date(ev.timestamp || Date.now());
    if (ev.message) {
      const m = ev.message;
      const echo = !!m.is_echo;
      const atts = (m.attachments ?? []).map(attachmentOf);
      out.push({
        kind: 'MESSAGE',
        externalId: m.mid,
        userId: echo ? ev.recipient.id : ev.sender.id,
        direction: echo ? 'OUT' : 'IN',
        ownEcho: echo && m.metadata === ECHO_METADATA,
        type: typeOf(m.text, atts),
        text: m.text,
        attachments: atts,
        sentAt,
      });
    } else if (ev.postback) {
      out.push({
        kind: 'MESSAGE',
        externalId: ev.postback.mid ?? `postback:${ev.sender.id}:${ev.timestamp}`,
        userId: ev.sender.id,
        direction: 'IN',
        ownEcho: false,
        type: 'TEXT',
        text: `[Bấm nút] ${ev.postback.title ?? ev.postback.payload ?? ''}`.trim(),
        attachments: [],
        sentAt,
      });
    }
  }

  for (const change of entry.changes ?? []) {
    const v = change.value;
    if (change.field !== 'feed' || v.item !== 'comment' || v.verb !== 'add' || !v.comment_id || !v.from?.id || !v.post_id) continue;
    const fromPage = v.from.id === pageId;
    const atts: StoredAttachment[] = [];
    if (v.photo) atts.push({ type: 'image', url: v.photo });
    if (v.video) atts.push({ type: 'video', url: v.video });
    out.push({
      kind: 'COMMENT',
      externalId: v.comment_id,
      userId: v.from.id,
      userName: v.from.name,
      direction: fromPage ? 'OUT' : 'IN',
      ownEcho: false,
      type: typeOf(v.message, atts),
      text: v.message,
      attachments: atts,
      sentAt: v.created_time ? new Date(v.created_time * 1000) : new Date(),
      postId: v.post_id,
      postUrl: v.post?.permalink_url,
      parentId: v.parent_id && v.parent_id !== v.post_id ? v.parent_id : undefined,
    });
  }
  return out;
}

/** First Vietnamese phone number written in a message, normalized to 0xxxxxxxxx */
export function findPhone(text: string | undefined): string | null {
  if (!text) return null;
  const match = text.match(/(?:\+?84|0)(?:[\s.-]?\d){8,10}(?!\d)/);
  if (!match) return null;
  let digits = match[0].replace(/\D/g, '');
  if (digits.startsWith('84')) digits = '0' + digits.slice(2);
  return /^0[35789]\d{8}$/.test(digits) || /^02\d{9}$/.test(digits) ? digits : null;
}

/** Short preview for the conversation list */
export function previewOf(m: { type: string; text?: string | null; privateReply?: boolean }): string {
  const label: Record<string, string> = {
    IMAGE: '[Ảnh]',
    VIDEO: '[Video]',
    AUDIO: '[Ghi âm]',
    FILE: '[Tệp]',
    STICKER: '[Nhãn dán]',
    OTHER: '[Tin đính kèm]',
  };
  const text = m.text?.trim() || label[m.type] || '';
  return (m.privateReply ? '[Nhắn riêng] ' : '') + (text.length > 200 ? text.slice(0, 199) + '…' : text);
}
