import { Controller, Get, Headers, HttpCode, Inject, Logger, Post, Query, Req, type RawBodyRequest } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { DomainError } from '../common/errors/domain-error';
import { ENV, type Env } from '../config/env';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventProcessor } from './event-processor.service';

/** X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(App Secret, raw body). Checked on the raw bytes, before any JSON parsing. */
export function validFacebookSignature(raw: Buffer | undefined, header: string | undefined, appSecret: string): boolean {
  if (!raw || !header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', appSecret).update(raw).digest('hex'));
  const given = Buffer.from(header.slice(7));
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Called by Meta, not by people: no session, authenticated by the verify token and the body signature instead. */
@ApiExcludeController()
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly processor: EventProcessor,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Meta checks the callback URL once when it is saved in the app settings */
  @Public()
  @Get('facebook')
  verify(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string): string {
    if (mode === 'subscribe' && this.env.FB_VERIFY_TOKEN && token === this.env.FB_VERIFY_TOKEN && challenge) return challenge;
    throw DomainError.forbidden('WEBHOOK_VERIFY_FAILED', 'Verify token does not match FB_VERIFY_TOKEN');
  }

  /** Stores each entry and answers 200 at once; the background worker does the rest. */
  @Public()
  @Post('facebook')
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string): Promise<string> {
    if (!this.env.FB_APP_SECRET || !validFacebookSignature(req.rawBody, signature, this.env.FB_APP_SECRET)) {
      this.logger.warn('Rejected a Facebook webhook call with a missing or wrong signature');
      throw DomainError.forbidden('WEBHOOK_SIGNATURE_INVALID', 'Invalid X-Hub-Signature-256');
    }
    const body = req.body as { object?: string; entry?: unknown[] };
    if (body?.object !== 'page' || !Array.isArray(body.entry)) return 'IGNORED';
    await this.prisma.webhookEvent.createMany({
      data: body.entry.map((entry) => ({ platform: 'FACEBOOK' as const, payload: entry as Prisma.InputJsonValue })),
    });
    this.processor.kick();
    return 'EVENT_RECEIVED';
  }
}
