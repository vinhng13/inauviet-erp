import { Injectable } from '@nestjs/common';
import { can, type AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { toSearchText } from '../common/utils/vn-text';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatEvents } from './chat-events';
import { ChatFiles, type StoredAttachment } from './chat-files';
import type {
  AttachmentDto,
  ConversationDto,
  ConversationListDto,
  ConversationQueryDto,
  ConversationRowDto,
  MessageDto,
  MessageListDto,
  ReplyWindowDto,
  UpdateConversationDto,
} from './channels.dto';
import { previewOf } from './facebook-events';
import { FacebookGraph, GraphError, type AttachmentKind } from './facebook-graph';
import { SecretBox } from './secret-box';

const HOUR = 3_600_000;
const PAGE = 50;

/** File uploaded from the chat box (multer memory storage) */
export interface UploadedChatFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const rowInclude = {
  channel: { select: { name: true } },
  contact: { select: { id: true, name: true, avatarUrl: true, phone: true, customer: { select: { id: true, code: true, name: true, phone: true } } } },
  assignee: { select: { id: true, fullName: true } },
} satisfies Prisma.ConversationInclude;

type Row = Prisma.ConversationGetPayload<{ include: typeof rowInclude }>;

/**
 * Messenger lets a page answer freely for 24 h after the customer's last message; until day 7 a person may
 * still answer with the HUMAN_AGENT tag; after that the page must wait for the customer to write again.
 */
export function replyWindow(kind: 'MESSAGE' | 'COMMENT', lastInboundAt: Date | null, now = new Date()): ReplyWindowDto {
  if (kind === 'COMMENT') return { mode: 'COMMENT', until: null };
  if (!lastInboundAt) return { mode: 'CLOSED', until: null };
  const day = new Date(lastInboundAt.getTime() + 24 * HOUR);
  if (now < day) return { mode: 'RESPONSE', until: day };
  const week = new Date(lastInboundAt.getTime() + 7 * 24 * HOUR);
  if (now < week) return { mode: 'HUMAN_AGENT', until: week };
  return { mode: 'CLOSED', until: null };
}

function attachmentKind(mime: string): AttachmentKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'file';
}

/** The "Hội thoại" screen: list, read and answer Messenger chats and fanpage comments. */
@Injectable()
export class ConversationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: FacebookGraph,
    private readonly box: SecretBox,
    private readonly files: ChatFiles,
    private readonly events: ChatEvents,
  ) {}

  /** Without "xem tất cả" a person sees conversations assigned to them and those nobody has taken yet */
  visibleTo(user: AuthUser): Prisma.ConversationWhereInput {
    return can(user, 'conversations.viewAll') ? {} : { OR: [{ assigneeId: user.id }, { assigneeId: null }] };
  }

  canSee(user: AuthUser, assigneeId: string | null): boolean {
    return can(user, 'conversations.viewAll') || assigneeId === null || assigneeId === user.id;
  }

  async list(user: AuthUser, q: ConversationQueryDto): Promise<ConversationListDto> {
    const and: Prisma.ConversationWhereInput[] = [this.visibleTo(user)];
    if (q.filter === 'mine') and.push({ assigneeId: user.id });
    if (q.filter === 'unassigned') and.push({ assigneeId: null });
    if (q.filter === 'waiting') and.push({ lastMessageIn: true });
    and.push({ status: q.status ?? 'OPEN' });
    if (q.kind) and.push({ kind: q.kind });
    if (q.channelId) and.push({ channelId: q.channelId });
    if (q.before) and.push({ lastMessageAt: { lt: new Date(q.before) } });
    const text = q.q?.trim();
    if (text) {
      const digits = text.replace(/\D/g, '');
      and.push({
        contact: {
          OR: [
            { name: { contains: text, mode: 'insensitive' } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
            { customer: { searchText: { contains: toSearchText(text) } } },
          ],
        },
      });
    }
    const rows = await this.prisma.conversation.findMany({
      where: { AND: and },
      include: rowInclude,
      orderBy: { lastMessageAt: 'desc' },
      take: PAGE + 1,
    });
    return { items: rows.slice(0, PAGE).map((r) => this.row(r)), hasMore: rows.length > PAGE };
  }

  async unread(user: AuthUser): Promise<{ conversations: number }> {
    const conversations = await this.prisma.conversation.count({ where: { AND: [this.visibleTo(user), { status: 'OPEN', unreadCount: { gt: 0 } }] } });
    return { conversations };
  }

  async get(user: AuthUser, id: string): Promise<ConversationDto> {
    const c = await this.find(user, id);
    const lastComment =
      c.kind === 'COMMENT'
        ? await this.prisma.message.findFirst({ where: { conversationId: id, direction: 'IN' }, orderBy: { sentAt: 'desc' }, select: { sentAt: true } })
        : null;
    return {
      ...this.row(c),
      contact: {
        id: c.contact.id,
        name: c.contact.name,
        avatarUrl: c.contact.avatarUrl,
        phone: c.contact.phone,
        customer: c.contact.customer,
      },
      postId: c.postId,
      postUrl: c.postUrl,
      canPrivateReply: c.kind === 'COMMENT' && !c.privateReplyAt && !!lastComment && Date.now() - lastComment.sentAt.getTime() < 7 * 24 * HOUR,
    };
  }

  async messages(user: AuthUser, id: string, before?: string): Promise<MessageListDto> {
    await this.find(user, id);
    const rows = await this.prisma.message.findMany({
      where: { conversationId: id, ...(before ? { sentAt: { lt: new Date(before) } } : {}) },
      include: { sender: { select: { id: true, fullName: true } } },
      orderBy: [{ sentAt: 'desc' }, { createdAt: 'desc' }],
      take: PAGE + 1,
    });
    const items = rows.slice(0, PAGE).reverse().map((m): MessageDto => ({
      id: m.id,
      direction: m.direction,
      type: m.type,
      text: m.text,
      attachments: ((m.attachments as unknown as StoredAttachment[]) ?? []).map((a, i): AttachmentDto => ({
        type: a.type,
        name: a.name ?? null,
        mime: a.mime ?? null,
        size: a.size ?? null,
        href: a.file || a.url ? `/api/v1/conversations/${id}/messages/${m.id}/files/${i}` : null,
      })),
      sender: m.sender,
      outsideCrm: m.outsideCrm,
      privateReply: m.privateReply,
      status: m.status,
      error: m.error,
      sentAt: m.sentAt,
    }));
    return { items, hasMore: rows.length > PAGE };
  }

  async markRead(user: AuthUser, id: string): Promise<void> {
    const c = await this.find(user, id);
    if (c.unreadCount === 0) return;
    await this.prisma.conversation.update({ where: { id }, data: { unreadCount: 0 } });
    this.events.emit({ conversationId: id, assigneeId: c.assigneeId, inbound: false });
  }

  async update(user: AuthUser, id: string, dto: UpdateConversationDto): Promise<ConversationDto> {
    const c = await this.find(user, id);
    const data: Prisma.ConversationUncheckedUpdateInput = {};
    if (dto.assigneeId !== undefined && dto.assigneeId !== c.assigneeId) {
      const claimingFree = dto.assigneeId === user.id && c.assigneeId === null;
      if (!claimingFree && !can(user, 'conversations.assign')) {
        throw DomainError.forbidden('PERMISSION_DENIED', 'Missing permission: conversations.assign');
      }
      if (claimingFree && !can(user, 'conversations.reply')) {
        throw DomainError.forbidden('PERMISSION_DENIED', 'Missing permission: conversations.reply');
      }
      if (dto.assigneeId) await this.requireAgent(dto.assigneeId);
      data.assigneeId = dto.assigneeId;
    }
    if (dto.status && dto.status !== c.status) {
      if (!can(user, 'conversations.reply')) throw DomainError.forbidden('PERMISSION_DENIED', 'Missing permission: conversations.reply');
      data.status = dto.status;
      if (dto.status === 'DONE') data.unreadCount = 0;
    }
    if (Object.keys(data).length) {
      const updated = await this.prisma.conversation.update({ where: { id }, data });
      this.events.emit({ conversationId: id, assigneeId: updated.assigneeId, inbound: false });
      // the previous assignee's screen must drop it too
      if (c.assigneeId && c.assigneeId !== updated.assigneeId) this.events.emit({ conversationId: id, assigneeId: c.assigneeId, inbound: false });
    }
    return this.get(user, id);
  }

  async linkCustomer(user: AuthUser, id: string, customerId: string | null): Promise<ConversationDto> {
    const c = await this.find(user, id);
    if (customerId && !(await this.prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) {
      throw DomainError.notFound('Customer', customerId);
    }
    await this.prisma.channelContact.update({ where: { id: c.contact.id }, data: { customerId } });
    this.events.emit({ conversationId: id, assigneeId: c.assigneeId, inbound: false });
    return this.get(user, id);
  }

  /** Text reply. Messenger: Send API. Comments: public reply under the customer's latest comment, or one private message. */
  async sendText(user: AuthUser, id: string, text: string, asPrivate = false): Promise<MessageDto> {
    const c = await this.find(user, id);
    const { token, pageId } = await this.channelToken(c.channelId);
    const body = text.trim();

    if (c.kind === 'MESSAGE') {
      const window = this.requireOpenWindow(c);
      const recipient = { id: await this.psidOf(c.contactId) };
      return this.deliver(user, c, { type: 'TEXT', text: body }, () =>
        this.graph.sendText(pageId, token, recipient, body, window.mode === 'HUMAN_AGENT'),
      );
    }

    const target = await this.prisma.message.findFirst({
      where: { conversationId: id, direction: 'IN', externalId: { not: null } },
      orderBy: { sentAt: 'desc' },
    });
    if (!target?.externalId) throw DomainError.badRequest('NOTHING_TO_REPLY', 'No customer comment to reply to');
    if (asPrivate) {
      if (c.privateReplyAt) throw DomainError.conflict('PRIVATE_REPLY_USED', 'A private message was already sent for this comment thread');
      if (Date.now() - target.sentAt.getTime() >= 7 * 24 * HOUR) {
        throw DomainError.badRequest('PRIVATE_REPLY_EXPIRED', 'Private replies are possible only within 7 days of the comment');
      }
      const commentId = target.externalId;
      const sent = await this.deliver(user, c, { type: 'TEXT', text: body, privateReply: true }, () =>
        this.graph.sendText(pageId, token, { comment_id: commentId }, body, false),
      );
      if (sent.status === 'SENT') await this.prisma.conversation.update({ where: { id }, data: { privateReplyAt: new Date() } });
      return sent;
    }
    const commentId = target.externalId;
    return this.deliver(user, c, { type: 'TEXT', text: body }, () => this.graph.replyToComment(commentId, token, body));
  }

  /** Image / file over Messenger (comments take text only). A copy stays on the server. */
  async sendFile(user: AuthUser, id: string, file: UploadedChatFile | undefined): Promise<MessageDto> {
    if (!file?.buffer?.length) throw DomainError.badRequest('FILE_REQUIRED', 'Choose a file to send');
    const c = await this.find(user, id);
    if (c.kind !== 'MESSAGE') throw DomainError.badRequest('FILE_NOT_ALLOWED', 'Files can be sent in Messenger chats only');
    const window = this.requireOpenWindow(c);
    const { token, pageId } = await this.channelToken(c.channelId);
    const psid = await this.psidOf(c.contactId);
    // multer reads multipart file names as latin1
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const mime = file.mimetype || 'application/octet-stream';
    const kind = attachmentKind(mime);
    const stored = await this.files.save(file.buffer, mime, name);
    const type = kind === 'image' ? 'IMAGE' : kind === 'video' ? 'VIDEO' : kind === 'audio' ? 'AUDIO' : 'FILE';
    return this.deliver(user, c, { type, attachments: [{ type: kind, name, mime, size: file.size, file: stored }] }, () =>
      this.graph.sendFile(pageId, token, psid, kind, { data: file.buffer, name, mime }, window.mode === 'HUMAN_AGENT'),
    );
  }

  /** Where to read an attachment: the copy on disk, or else Facebook's link */
  async attachment(user: AuthUser, id: string, messageId: string, index: number): Promise<{ path?: string; url?: string; name?: string; mime?: string }> {
    await this.find(user, id);
    const m = await this.prisma.message.findFirst({ where: { id: messageId, conversationId: id } });
    const a = ((m?.attachments as unknown as StoredAttachment[]) ?? [])[index];
    if (!a) throw DomainError.notFound('Attachment');
    if (a.file) return { path: this.files.path(a.file), name: a.name, mime: a.mime };
    if (a.url) return { url: a.url };
    throw DomainError.notFound('Attachment');
  }

  /** People who can be given conversations */
  async assignees(): Promise<{ people: Array<{ id: string; fullName: string }> }> {
    const people = await this.prisma.user.findMany({
      where: { isActive: true, role: { OR: [{ isSystem: true }, { permissions: { hasSome: ['conversations.view', 'conversations.reply'] } }] } },
      select: { id: true, fullName: true },
      orderBy: { fullName: 'asc' },
    });
    return { people };
  }

  // ───────────── helpers ─────────────

  private async deliver(
    user: AuthUser,
    c: Row,
    content: { type: 'TEXT' | 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'; text?: string; attachments?: StoredAttachment[]; privateReply?: boolean },
    send: () => Promise<{ messageId: string }>,
  ): Promise<MessageDto> {
    const now = new Date();
    const message = await this.prisma.message.create({
      data: {
        conversationId: c.id,
        direction: 'OUT',
        type: content.type,
        text: content.text,
        attachments: (content.attachments ?? []) as unknown as Prisma.InputJsonValue,
        senderId: user.id,
        privateReply: content.privateReply ?? false,
        status: 'SENDING',
        sentAt: now,
      },
    });
    let failure: string | null = null;
    let externalId: string | undefined;
    try {
      externalId = (await send()).messageId;
    } catch (e) {
      failure = this.explainSendError(e);
      if (e instanceof GraphError && e.tokenInvalid) {
        await this.prisma.channelAccount.update({
          where: { id: c.channelId },
          data: { status: 'ERROR', lastError: `Mã truy cập không còn hiệu lực: ${e.message}`, lastErrorAt: new Date() },
        });
      }
    }
    await this.prisma.message.update({
      where: { id: message.id },
      data: failure ? { status: 'FAILED', error: failure } : { status: 'SENT', externalId },
    });
    if (!failure) {
      await this.prisma.conversation.update({
        where: { id: c.id },
        data: {
          lastMessageAt: now,
          lastMessageText: previewOf({ type: content.type, text: content.text, privateReply: content.privateReply }),
          lastMessageIn: false,
          unreadCount: 0,
          // answering takes an unassigned conversation
          ...(c.assigneeId === null ? { assigneeId: user.id } : {}),
        },
      });
    }
    this.events.emit({ conversationId: c.id, assigneeId: c.assigneeId ?? user.id, inbound: false });
    const list = await this.messages(user, c.id);
    const sent = list.items.find((m) => m.id === message.id);
    if (!sent) throw new Error('Sent message disappeared');
    return sent;
  }

  private explainSendError(e: unknown): string {
    if (e instanceof GraphError) {
      if (e.tokenInvalid) return 'Mã truy cập fanpage không còn hiệu lực. Quản trị viên cần kết nối lại.';
      if (e.code === 10 && e.subcode === 2018278) return 'Đã quá thời hạn được nhắn cho khách. Chờ khách nhắn lại.';
      if (e.code === 551 || e.subcode === 1545041) return 'Người này hiện không nhận tin nhắn từ trang.';
      if (e.rateLimited) return 'Facebook đang giới hạn số lần gửi. Thử lại sau ít phút.';
      return `Facebook từ chối: ${e.message}`;
    }
    return e instanceof Error ? e.message : String(e);
  }

  private requireOpenWindow(c: Row): ReplyWindowDto {
    const window = replyWindow(c.kind, c.lastInboundAt);
    if (window.mode === 'CLOSED') {
      throw DomainError.badRequest('REPLY_WINDOW_CLOSED', 'More than 7 days since the customer last wrote: wait for them to write again');
    }
    return window;
  }

  private async psidOf(contactId: string): Promise<string> {
    const contact = await this.prisma.channelContact.findUniqueOrThrow({ where: { id: contactId }, select: { externalId: true } });
    return contact.externalId;
  }

  private async channelToken(channelId: string): Promise<{ token: string; pageId: string }> {
    const channel = await this.prisma.channelAccount.findUniqueOrThrow({ where: { id: channelId } });
    if (channel.status === 'DISCONNECTED' || !channel.accessTokenEnc) {
      throw DomainError.badRequest('CHANNEL_DISCONNECTED', 'This page is disconnected; an administrator must connect it again');
    }
    return { token: this.box.open(channel.accessTokenEnc), pageId: channel.externalId };
  }

  private async requireAgent(userId: string): Promise<void> {
    const { people } = await this.assignees();
    if (!people.some((p) => p.id === userId)) throw DomainError.badRequest('ASSIGNEE_NOT_ALLOWED', 'This account cannot handle conversations');
  }

  private async find(user: AuthUser, id: string): Promise<Row> {
    const c = await this.prisma.conversation.findUnique({ where: { id }, include: rowInclude });
    if (!c || !this.canSee(user, c.assigneeId)) throw DomainError.notFound('Conversation', id);
    return c;
  }

  private row(c: Row): ConversationRowDto {
    return {
      id: c.id,
      kind: c.kind,
      status: c.status,
      channelId: c.channelId,
      channelName: c.channel.name,
      contactName: c.contact.name,
      contactAvatarUrl: c.contact.avatarUrl,
      customerName: c.contact.customer?.name ?? null,
      assignee: c.assignee,
      lastMessageAt: c.lastMessageAt,
      lastMessageText: c.lastMessageText,
      lastMessageIn: c.lastMessageIn,
      unreadCount: c.unreadCount,
      window: replyWindow(c.kind, c.lastInboundAt),
    };
  }
}
