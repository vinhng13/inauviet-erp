import { createHmac } from 'node:crypto';
import type { Env } from '../config/env';

/** A refusal from the Graph API, with Meta's error code (190 = token invalid, 10/200 = permission, 4/17/32/613 = rate limit). */
export class GraphError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: number,
    readonly subcode?: number,
  ) {
    super(message);
  }

  /** The access token no longer works: expired, revoked, or the password of its owner changed */
  get tokenInvalid(): boolean {
    return this.code === 190 || this.code === 102;
  }

  get rateLimited(): boolean {
    return [4, 17, 32, 613].includes(this.code ?? -1) || this.status === 429;
  }
}

export interface GraphPage {
  id: string;
  name: string;
  accessToken: string;
  pictureUrl?: string;
}

export interface SendResult {
  messageId: string;
}

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

/** Page events the CRM listens to. leadgen joins in the lead-ads phase. */
export const PAGE_FIELDS = ['messages', 'message_echoes', 'messaging_postbacks', 'messaging_referrals', 'feed'];

/** Text the CRM stamps on messages it sends, so their echoes are recognised and not stored twice */
export const ECHO_METADATA = 'inauviet-erp';

type Query = Record<string, string | number | undefined>;

/** Thin Graph API client on top of fetch. Base URL and version come from the environment so tests can use a stub. */
export class FacebookGraph {
  private readonly base: string;

  constructor(private readonly env: Pick<Env, 'FB_GRAPH_URL' | 'FB_GRAPH_VERSION' | 'FB_APP_SECRET'>) {
    this.base = `${env.FB_GRAPH_URL.replace(/\/$/, '')}/${env.FB_GRAPH_VERSION}`;
  }

  /** Pages the token can manage. A page token (not a user / system-user token) yields just its own page. */
  async listPages(token: string): Promise<GraphPage[]> {
    try {
      const res = await this.call<{ data: Array<{ id: string; name: string; access_token?: string; picture?: { data?: { url?: string } } }> }>(
        'GET',
        '/me/accounts',
        token,
        { query: { fields: 'id,name,access_token,picture{url}', limit: 100 } },
      );
      return res.data
        .filter((p) => p.access_token)
        .map((p) => ({ id: p.id, name: p.name, accessToken: p.access_token!, pictureUrl: p.picture?.data?.url }));
    } catch (e) {
      // "(#100) Tried accessing nonexisting field (accounts) on node type (Page)": it is a page token
      if (!(e instanceof GraphError) || e.code !== 100) throw e;
      const me = await this.call<{ id: string; name: string; picture?: { data?: { url?: string } } }>('GET', '/me', token, {
        query: { fields: 'id,name,picture{url}' },
      });
      return [{ id: me.id, name: me.name, accessToken: token, pictureUrl: me.picture?.data?.url }];
    }
  }

  /** Cheap call that fails with code 190 when the page token stopped working */
  async checkPage(pageId: string, token: string): Promise<void> {
    await this.call('GET', `/${pageId}`, token, { query: { fields: 'id,name' } });
  }

  async subscribe(pageId: string, token: string): Promise<void> {
    await this.call('POST', `/${pageId}/subscribed_apps`, token, { query: { subscribed_fields: PAGE_FIELDS.join(',') } });
  }

  async unsubscribe(pageId: string, token: string): Promise<void> {
    await this.call('DELETE', `/${pageId}/subscribed_apps`, token);
  }

  /** Name and picture of a Messenger user (PSID). Facebook may refuse for some people: callers fall back to "Khách Facebook". */
  async profile(psid: string, token: string): Promise<{ name?: string; pictureUrl?: string }> {
    const res = await this.call<{ name?: string; first_name?: string; last_name?: string; profile_pic?: string }>('GET', `/${psid}`, token, {
      query: { fields: 'name,profile_pic' },
    });
    const name = res.name ?? [res.last_name, res.first_name].filter(Boolean).join(' ');
    return { name: name || undefined, pictureUrl: res.profile_pic };
  }

  async post(postId: string, token: string): Promise<{ url?: string; text?: string }> {
    const res = await this.call<{ permalink_url?: string; message?: string }>('GET', `/${postId}`, token, {
      query: { fields: 'permalink_url,message' },
    });
    return { url: res.permalink_url, text: res.message };
  }

  /**
   * Messenger Send API. Within 24 hours of the customer's last message any reply is allowed (RESPONSE);
   * after that until day 7 only a person may answer, with the HUMAN_AGENT tag.
   */
  async sendText(pageId: string, token: string, recipient: { id: string } | { comment_id: string }, text: string, humanAgent: boolean): Promise<SendResult> {
    const body: Record<string, unknown> = { recipient, message: { text, metadata: ECHO_METADATA } };
    Object.assign(body, this.window(recipient, humanAgent));
    const res = await this.call<{ message_id: string }>('POST', `/${pageId}/messages`, token, { json: body });
    return { messageId: res.message_id };
  }

  async sendFile(
    pageId: string,
    token: string,
    psid: string,
    kind: AttachmentKind,
    file: { data: Buffer; name: string; mime: string },
    humanAgent: boolean,
  ): Promise<SendResult> {
    const form = new FormData();
    form.set('recipient', JSON.stringify({ id: psid }));
    form.set('message', JSON.stringify({ attachment: { type: kind, payload: { is_reusable: false } }, metadata: ECHO_METADATA }));
    for (const [k, v] of Object.entries(this.window({ id: psid }, humanAgent))) form.set(k, v);
    form.set('filedata', new Blob([new Uint8Array(file.data)], { type: file.mime }), file.name);
    const res = await this.call<{ message_id: string }>('POST', `/${pageId}/messages`, token, { form });
    return { messageId: res.message_id };
  }

  /** Public reply under a comment; returns the new comment id */
  async replyToComment(commentId: string, token: string, text: string): Promise<SendResult> {
    const res = await this.call<{ id: string }>('POST', `/${commentId}/comments`, token, { json: { message: text } });
    return { messageId: res.id };
  }

  /** Downloads a file Facebook sent (its links expire after a while, so the CRM keeps a copy) */
  async download(url: string, maxBytes: number): Promise<{ data: Buffer; mime: string } | null> {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return null;
    const size = Number(res.headers.get('content-length') ?? 0);
    if (size > maxBytes) return null;
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > maxBytes) return null;
    return { data, mime: res.headers.get('content-type')?.split(';')[0] ?? 'application/octet-stream' };
  }

  private window(recipient: object, humanAgent: boolean): Record<string, string> {
    if ('comment_id' in recipient) return {}; // private replies carry no messaging type
    return humanAgent ? { messaging_type: 'MESSAGE_TAG', tag: 'HUMAN_AGENT' } : { messaging_type: 'RESPONSE' };
  }

  private async call<T>(method: string, path: string, token: string, opts: { query?: Query; json?: object; form?: FormData } = {}): Promise<T> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    url.searchParams.set('access_token', token);
    if (this.env.FB_APP_SECRET) {
      url.searchParams.set('appsecret_proof', createHmac('sha256', this.env.FB_APP_SECRET).update(token).digest('hex'));
    }
    const init: RequestInit = { method, signal: AbortSignal.timeout(30_000) };
    if (opts.json) {
      init.body = JSON.stringify(opts.json);
      init.headers = { 'content-type': 'application/json' };
    } else if (opts.form) {
      init.body = opts.form;
    }
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new GraphError(`Cannot reach Facebook: ${(e as Error).message}`, 0);
    }
    const text = await res.text();
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    if (!res.ok || (body as { error?: unknown }).error) {
      const err = (body as { error?: { message?: string; code?: number; error_subcode?: number } }).error ?? {};
      throw new GraphError(err.message ?? `Facebook answered ${res.status}`, res.status, err.code, err.error_subcode);
    }
    return body as T;
  }
}
