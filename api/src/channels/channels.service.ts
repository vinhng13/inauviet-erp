import { Inject, Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { ChannelOverviewDto, ConnectResultsDto, FacebookPagesDto } from './channels.dto';
import { EventProcessor } from './event-processor.service';
import { FacebookGraph, GraphError } from './facebook-graph';
import { SecretBox } from './secret-box';

/** Turns a Graph refusal into a message an administrator can act on */
function explain(e: unknown): string {
  if (e instanceof GraphError) {
    if (e.tokenInvalid) return `Mã truy cập không hợp lệ hoặc đã hết hạn (${e.message})`;
    if (e.code === 10 || e.code === 200) return `Thiếu quyền trên ứng dụng Meta (${e.message})`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** "Kết nối kênh": connect fanpages with an access token, watch their health, retry failed events. */
@Injectable()
export class ChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: FacebookGraph,
    private readonly box: SecretBox,
    private readonly processor: EventProcessor,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async overview(): Promise<ChannelOverviewDto> {
    const [channels, pendingEvents, failed] = await Promise.all([
      this.prisma.channelAccount.findMany({
        orderBy: [{ status: 'asc' }, { name: 'asc' }],
        include: { connectedBy: { select: { fullName: true } }, _count: { select: { conversations: true } } },
      }),
      this.prisma.webhookEvent.count({ where: { processedAt: null, failedAt: null } }),
      this.prisma.webhookEvent.findMany({ where: { failedAt: { not: null }, processedAt: null }, orderBy: { receivedAt: 'desc' }, take: 20 }),
    ]);
    return {
      channels: channels.map((c) => ({
        id: c.id,
        platform: c.platform,
        externalId: c.externalId,
        name: c.name,
        pictureUrl: c.pictureUrl,
        status: c.status,
        lastEventAt: c.lastEventAt,
        lastError: c.lastError,
        lastErrorAt: c.lastErrorAt,
        connectedAt: c.connectedAt,
        connectedBy: c.connectedBy?.fullName ?? null,
        conversations: c._count.conversations,
      })),
      setup: {
        appSecret: !!this.env.FB_APP_SECRET,
        verifyToken: !!this.env.FB_VERIFY_TOKEN,
        secretKey: this.box.ready,
        callbackPath: '/api/v1/webhooks/facebook',
        graphVersion: this.env.FB_GRAPH_VERSION,
      },
      pendingEvents,
      failedEvents: failed.map((e) => ({ id: e.id, receivedAt: e.receivedAt, attempts: e.attempts, lastError: e.lastError })),
    };
  }

  /** Pages the token can manage, to choose from. The token itself is not stored by this call. */
  async previewFacebook(accessToken: string): Promise<FacebookPagesDto> {
    const pages = await this.listPages(accessToken);
    const active = await this.prisma.channelAccount.findMany({
      where: { platform: 'FACEBOOK', status: 'ACTIVE', externalId: { in: pages.map((p) => p.id) } },
      select: { externalId: true },
    });
    const on = new Set(active.map((a) => a.externalId));
    return { pages: pages.map((p) => ({ id: p.id, name: p.name, pictureUrl: p.pictureUrl, connected: on.has(p.id) })) };
  }

  /** Saves each chosen page with its own page token (encrypted) and subscribes the app to its events. */
  async connectFacebook(accessToken: string, pageIds: string[], actor: AuthUser): Promise<ConnectResultsDto> {
    if (!this.box.ready) this.box.seal(''); // throws CHANNEL_KEY_MISSING before anything is changed
    const pages = await this.listPages(accessToken);
    const chosen = pages.filter((p) => pageIds.includes(p.id));
    if (!chosen.length) throw DomainError.badRequest('FB_PAGE_NOT_FOUND', 'None of the chosen pages can be managed with this token');

    const results: ConnectResultsDto['results'] = [];
    for (const page of chosen) {
      const data = {
        name: page.name,
        pictureUrl: page.pictureUrl ?? null,
        accessTokenEnc: this.box.seal(page.accessToken),
        connectedById: actor.id,
        connectedAt: new Date(),
      };
      const channel = await this.prisma.channelAccount.upsert({
        where: { platform_externalId: { platform: 'FACEBOOK', externalId: page.id } },
        create: { platform: 'FACEBOOK', externalId: page.id, ...data },
        update: data,
      });
      try {
        await this.graph.subscribe(page.id, page.accessToken);
        await this.prisma.channelAccount.update({ where: { id: channel.id }, data: { status: 'ACTIVE', lastError: null, lastErrorAt: null } });
        results.push({ pageId: page.id, name: page.name, ok: true });
      } catch (e) {
        const error = `Không đăng ký nhận sự kiện được: ${explain(e)}`;
        await this.prisma.channelAccount.update({ where: { id: channel.id }, data: { status: 'ERROR', lastError: error, lastErrorAt: new Date() } });
        results.push({ pageId: page.id, name: page.name, ok: false, error });
      }
    }
    return { results };
  }

  /** Calls Facebook with the stored token and updates the status */
  async check(id: string): Promise<void> {
    const channel = await this.find(id);
    if (!channel.accessTokenEnc) throw DomainError.badRequest('CHANNEL_DISCONNECTED', 'Connect the page again first');
    const token = this.box.open(channel.accessTokenEnc);
    try {
      await this.graph.checkPage(channel.externalId, token);
      await this.graph.subscribe(channel.externalId, token);
      await this.prisma.channelAccount.update({ where: { id }, data: { status: 'ACTIVE', lastError: null, lastErrorAt: null } });
    } catch (e) {
      await this.prisma.channelAccount.update({ where: { id }, data: { status: 'ERROR', lastError: explain(e), lastErrorAt: new Date() } });
    }
  }

  /** Stops events for the page and wipes its token. Conversations stay. */
  async disconnect(id: string): Promise<void> {
    const channel = await this.find(id);
    if (channel.accessTokenEnc) {
      await this.graph.unsubscribe(channel.externalId, this.box.open(channel.accessTokenEnc)).catch(() => undefined);
    }
    await this.prisma.channelAccount.update({ where: { id }, data: { status: 'DISCONNECTED', accessTokenEnc: null } });
  }

  /** Puts events that gave up back in the queue */
  async retryFailed(): Promise<{ count: number }> {
    const res = await this.prisma.webhookEvent.updateMany({
      where: { failedAt: { not: null }, processedAt: null },
      data: { failedAt: null, attempts: 0, nextAttemptAt: new Date(), lockedUntil: null },
    });
    this.processor.kick();
    return { count: res.count };
  }

  private async listPages(token: string) {
    try {
      return await this.graph.listPages(token.trim());
    } catch (e) {
      throw DomainError.badRequest('FB_TOKEN_REJECTED', explain(e));
    }
  }

  private async find(id: string) {
    const channel = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!channel) throw DomainError.notFound('Channel', id);
    return channel;
  }
}
