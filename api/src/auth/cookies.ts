import type { Request, Response } from 'express';

export const SESSION_COOKIE = 'erp_session';

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** HttpOnly so page scripts can't read it; SameSite=Lax so other sites can't send it with their requests. */
export function setSessionCookie(res: Response, token: string, expires: Date, secure: boolean): void {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure, path: '/', expires });
}

export function clearSessionCookie(res: Response, secure: boolean): void {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
}

/** Client IP for rate limiting and the session list. Prefers Cloudflare's header when present. */
export function clientIp(req: Request): string {
  return (req.header('cf-connecting-ip') ?? req.ip ?? 'unknown').slice(0, 64);
}
