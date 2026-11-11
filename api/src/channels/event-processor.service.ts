import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatEvents } from './chat-events';
import { ChatFiles, MAX_FILE_BYTES, type StoredAttachment } from './chat-files';
import { FacebookGraph, GraphError } from './facebook-graph';
import { findPhone, parseEntry, previewOf, type FbEntry, type ParsedMessage } from './facebook-events';
import { SecretBox } from './secret-box';

/** Wait before retry n (1-based); the 5th failure gives up and shows the event on "Kết nối kênh". */
const BACKOFF_SECONDS = [30, 120, 600, 1800];
export const MAX_ATTEMPTS = 5;

interface ClaimedEvent {
  id: string;
  payload: unknown;
  attempts: number;
  receivedAt: Date;
}

/**
 * Background worker for webhook events. The webhook only stores the raw entry and answers 200;
 * this worker claims pending events (FOR UPDATE SKIP LOCKED, so two processes never take the same one),
 * turns them into contacts, conversations and messages, and retries failures with growing waits.
 */
@Injectable()
export class EventProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventProcessor.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private again = false;
  private enabled = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: FacebookGraph,
    private readonly box: SecretBox,
    private readonly files: ChatFiles,
    private readonly events: ChatEvents,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    this.enabled = this.env.CHANNEL_WORKER ?? this.env.NODE_ENV !== 'test';
    if (this.enabled) this.timer = setInterval(() => this.kick(), 5_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Start a pass now (called by the webhook right after storing an event) */
  kick(): void {
    if (!this.enabled) return;
    if (this.running) {
      this.again = true;
      return;
    }
    void this.drain().catch((e) => this.logger.error(e));
  }

  /** Processes every event that is due. Tests call this directly instead of waiting for the timer. */
  async drain(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let done = 0;
    try {
      do {
        this.again = false;
        for (;;) {
          const batch = await this.claim();
          if (!batch.length) break;
          for (const ev of batch) {
            await this.handle(ev);
            done++;
          }
        }
      } while (this.again);
    } finally {
      this.running = false;
    }
    return done;
  }

  /** UPDATE … RETURNING does not keep the ORDER BY of the subquery, so the batch is sorted again: messages must be stored in order */
  private async claim(): Promise<ClaimedEvent[]> {
    const rows = await this.prisma.$queryRaw<ClaimedEvent[]>`
      UPDATE "WebhookEvent" SET "lockedUntil" = now() + interval '2 minutes', "attempts" = "attempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "WebhookEvent"
        WHERE "processedAt" IS NULL AND "failedAt" IS NULL AND "nextAttemptAt" <= now()
          AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
        ORDER BY "receivedAt" LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "payload", "attempts", "receivedAt"`;
    return rows.sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  }

  private async handle(ev: ClaimedEvent): Promise<void> {
    try {
      await this.processFacebookEntry(ev.payload as FbEntry);
      await this.prisma.webhookEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), lockedUntil: null, lastError: null } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Webhook event ${ev.id} failed (attempt ${ev.attempts}): ${message}`);
      const giveUp = ev.attempts >= MAX_ATTEMPTS;
      await this.prisma.webhookEvent.update({
        where: { id: ev.id },
        data: {
          lockedUntil: null,
          lastError: message.slice(0, 1000),
          failedAt: giveUp ? new Date() : null,
          nextAttemptAt: new Date(Date.now() + (BACKOFF_SECONDS[ev.attempts - 1] ?? 3600) * 1000),
        },
      });
      const pageId = (ev.payload as FbEntry | null)?.id;
      if (giveUp && pageId) {
        await this.prisma.channelAccount.updateMany({
          where: { platform: 'FACEBOOK', externalId: pageId },
          data: { lastError: `Không xử lý được sự kiện sau ${MAX_ATTEMPTS} lần: ${message}`.slice(0, 1000), lastErrorAt: new Date() },
        });
      }
    }
  }

  async processFacebookEntry(entry: FbEntry): Promise<void> {
    const channel = await this.prisma.channelAccount.findUnique({ where: { platform_externalId: { platform: 'FACEBOOK', externalId: String(entry.id) } } });
    if (!channel || channel.status === 'DISCONNECTED' || !channel.accessTokenEnc) return; // page not connected: nothing to do
    await this.prisma.channelAccount.update({ where: { id: channel.id }, data: { lastEventAt: new Date() } });
    const token = this.box.open(channel.accessTokenEnc);

    for (const msg of parseEntry(entry)) {
      if (msg.ownEcho) continue;
      if (await this.prisma.message.findUnique({ where: { externalId: msg.externalId }, select: { id: true } })) continue;
      try {
        await this.store(channel.id, token, msg);
      } catch (e) {
        if (e instanceof GraphError && e.tokenInvalid) {
          await this.prisma.channelAccount.update({
            where: { id: channel.id },
            data: { status: 'ERROR', lastError: `Mã truy cập không còn hiệu lực: ${e.message}`, lastErrorAt: new Date() },
          });
        }
        // A duplicate delivery processed at the same moment: the other one won
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
  }

  private async store(channelId: string, token: string, msg: ParsedMessage): Promise<void> {
    // The page answering a comment from Facebook: attach it to the conversation of the comment it answers
    if (msg.kind === 'COMMENT' && msg.direction === 'OUT') {
      if (!msg.parentId) return;
      const parent = await this.prisma.message.findUnique({ where: { externalId: msg.parentId }, select: { conversationId: true } });
      if (!parent) return;
      await this.save(parent.conversationId, msg);
      return;
    }

    const contact = await this.contactFor(channelId, token, msg);
    const threadKey = msg.kind === 'MESSAGE' ? 'm' : `c:${msg.postId}`;
    let conversation = await this.prisma.conversation.findUnique({ where: { contactId_threadKey: { contactId: contact.id, threadKey } } });
    if (!conversation) {
      // A returning person goes back to whoever handled them last
      const previous = await this.prisma.conversation.findFirst({
        where: { contactId: contact.id, assigneeId: { not: null } },
        orderBy: { lastMessageAt: 'desc' },
        select: { assigneeId: true },
      });
      let postUrl = msg.postUrl;
      if (msg.kind === 'COMMENT' && !postUrl && msg.postId) {
        postUrl = (await this.graph.post(msg.postId, token).catch(() => ({ url: undefined }))).url;
      }
      conversation = await this.prisma.conversation.create({
        data: {
          channelId,
          contactId: contact.id,
          kind: msg.kind,
          threadKey,
          postId: msg.postId,
          postUrl,
          assigneeId: previous?.assigneeId ?? null,
          lastMessageAt: msg.sentAt,
          lastMessageText: '',
        },
      });
    }
    await this.save(conversation.id, msg);
  }

  private async contactFor(channelId: string, token: string, msg: ParsedMessage) {
    const existing = await this.prisma.channelContact.findUnique({ where: { channelId_externalId: { channelId, externalId: msg.userId } } });
    const phone = msg.direction === 'IN' ? findPhone(msg.text) : null;
    if (existing) {
      if (phone && !existing.phone) await this.prisma.channelContact.update({ where: { id: existing.id }, data: { phone } });
      return existing;
    }
    let name = msg.userName;
    let avatarUrl: string | undefined;
    if (msg.kind === 'MESSAGE') {
      try {
        const p = await this.graph.profile(msg.userId, token);
        name = p.name ?? name;
        avatarUrl = p.pictureUrl;
      } catch (e) {
        if (e instanceof GraphError && e.tokenInvalid) throw e;
        // Facebook hides some profiles; keep going with a placeholder name
      }
    }
    return this.prisma.channelContact.create({
      data: { channelId, externalId: msg.userId, name: name || 'Khách Facebook', avatarUrl, phone },
    });
  }

  private async save(conversationId: string, msg: ParsedMessage): Promise<void> {
    const attachments = await Promise.all(msg.attachments.map((a) => this.keepCopy(a)));
    const inbound = msg.direction === 'IN';
    const conv = await this.prisma.$transaction(async (tx) => {
      await tx.message.create({
        data: {
          conversationId,
          direction: msg.direction,
          externalId: msg.externalId,
          type: msg.type,
          text: msg.text,
          attachments: attachments as unknown as Prisma.InputJsonValue,
          outsideCrm: !inbound,
          status: inbound ? 'RECEIVED' : 'SENT',
          sentAt: msg.sentAt,
        },
      });
      const current = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId } });
      const newest = msg.sentAt >= current.lastMessageAt || !current.lastMessageText;
      return tx.conversation.update({
        where: { id: conversationId },
        data: {
          ...(newest ? { lastMessageAt: msg.sentAt, lastMessageText: previewOf(msg), lastMessageIn: inbound } : {}),
          ...(inbound
            ? {
                unreadCount: { increment: 1 },
                status: 'OPEN',
                lastInboundAt: !current.lastInboundAt || msg.sentAt > current.lastInboundAt ? msg.sentAt : undefined,
              }
            : {}),
        },
      });
    });
    this.events.emit({ conversationId, assigneeId: conv.assigneeId, inbound });
  }

  /** Keeps a copy of images and files: Facebook's links stop working after some days */
  private async keepCopy(a: StoredAttachment): Promise<StoredAttachment> {
    if (!a.url || a.type === 'sticker') return a;
    try {
      const got = await this.graph.download(a.url, MAX_FILE_BYTES);
      if (!got) return a;
      const file = await this.files.save(got.data, got.mime, a.name);
      return { ...a, mime: got.mime, size: got.data.length, file };
    } catch (e) {
      this.logger.warn(`Could not copy attachment: ${(e as Error).message}`);
      return a;
    }
  }
}
