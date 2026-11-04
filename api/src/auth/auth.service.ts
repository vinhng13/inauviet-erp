import { HttpStatus, Injectable } from '@nestjs/common';
import { ActivityService } from '../activity/activity.service';
import { DomainError } from '../common/errors/domain-error';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from './auth.types';
import type { MeDto } from './auth.dto';
import { LoginLimiter } from './login-limiter';
import { DUMMY_HASH, hashPassword, passwordProblem, verifyPassword } from './password';
import { SessionService } from './session.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly limiter: LoginLimiter,
    private readonly activity: ActivityService,
  ) {}

  async login(usernameInput: string, password: string, meta: { ip: string; userAgent?: string }) {
    const username = usernameInput.trim().toLowerCase();
    const wait = this.limiter.retryAfter(username, meta.ip);
    if (wait > 0) {
      throw new DomainError(HttpStatus.TOO_MANY_REQUESTS, 'LOGIN_LOCKED', `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minutes.`, {
        retryAfterSeconds: wait,
      });
    }
    const user = await this.prisma.user.findUnique({ where: { username } });
    // Always run one scrypt check so a missing username takes as long as a wrong password.
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.passwordHash) {
      this.limiter.fail(username, meta.ip);
      throw new DomainError(HttpStatus.UNAUTHORIZED, 'INVALID_CREDENTIALS', 'Wrong username or password');
    }
    if (!user.isActive) {
      throw DomainError.forbidden('ACCOUNT_DISABLED', 'This account is locked. Contact an administrator.');
    }
    this.limiter.succeed(username);
    const session = await this.sessions.create(user.id, meta);
    await this.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
    return session;
  }

  async changePassword(actor: AuthUser, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw DomainError.badRequest('WRONG_PASSWORD', 'Current password is wrong');
    }
    const problem = passwordProblem(newPassword, user.username);
    if (problem) throw DomainError.badRequest('WEAK_PASSWORD', problem);
    if (await verifyPassword(newPassword, user.passwordHash)) {
      throw DomainError.badRequest('SAME_PASSWORD', 'The new password must differ from the current one');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(newPassword), mustChangePassword: false, passwordChangedAt: new Date() },
      });
      await this.activity.log(tx, { entityType: 'USER', entityId: user.id, action: 'PASSWORD_CHANGED', userId: user.id });
    });
    // Other browsers signed in with the old password are signed out; this one stays.
    await this.sessions.revokeAllForUser(user.id, actor.sessionId);
  }

  me(user: AuthUser): MeDto {
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      roleId: user.roleId,
      roleName: user.roleName,
      isAdmin: user.isAdmin,
      permissions: [...user.permissions],
      mustChangePassword: user.mustChangePassword,
    };
  }
}
