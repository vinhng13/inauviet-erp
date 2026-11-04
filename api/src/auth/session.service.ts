import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { ALL_PERMISSIONS, isPermission, type Permission } from '../access/permissions';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';

const EXTEND_AFTER_MS = 12 * 60 * 60 * 1000; // move the expiry forward at most twice a day
const TOUCH_AFTER_MS = 5 * 60 * 1000; // record lastUsedAt at most every 5 minutes

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Server-side sessions: the browser keeps a random token in an HttpOnly cookie, the database keeps
 * its SHA-256 hash. Logging out, deactivating an account or resetting a password revokes sessions
 * immediately, which signed tokens (JWT) can't do.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private ttlMs(): number {
    return this.env.SESSION_DAYS * 24 * 60 * 60 * 1000;
  }

  async create(userId: string, meta: { userAgent?: string; ip?: string }): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.ttlMs());
    await this.prisma.session.create({
      data: { userId, tokenHash: hashToken(token), expiresAt, userAgent: meta.userAgent?.slice(0, 300), ip: meta.ip },
    });
    return { token, expiresAt };
  }

  /** Returns the signed-in user, or null when the token is unknown, expired, revoked or the account is inactive. */
  async resolve(token: string): Promise<{ user: AuthUser; renewedExpiry?: Date } | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { include: { role: true } } },
    });
    const now = Date.now();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now || !session.user.isActive) return null;

    const u = session.user;
    const permissions: Permission[] = u.role.isSystem ? ALL_PERMISSIONS : (u.role.permissions ?? []).filter(isPermission);
    const user: AuthUser = {
      id: u.id,
      username: u.username,
      fullName: u.fullName,
      roleId: u.roleId,
      roleName: u.role.name,
      isAdmin: u.role.isSystem,
      permissions: new Set(permissions),
      mustChangePassword: u.mustChangePassword,
      sessionId: session.id,
    };

    let renewedExpiry: Date | undefined;
    const sinceExtended = now - (session.expiresAt.getTime() - this.ttlMs());
    if (sinceExtended > EXTEND_AFTER_MS) renewedExpiry = new Date(now + this.ttlMs());
    if (renewedExpiry || now - session.lastUsedAt.getTime() > TOUCH_AFTER_MS) {
      void this.prisma
        .$transaction([
          this.prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(now), ...(renewedExpiry ? { expiresAt: renewedExpiry } : {}) } }),
          this.prisma.user.update({ where: { id: u.id }, data: { lastSeenAt: new Date(now) } }),
        ])
        .catch(() => undefined);
    }
    return { user, renewedExpiry };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Sign the account out everywhere (optionally keeping the current browser). */
  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<number> {
    const r = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
    return r.count;
  }
}
