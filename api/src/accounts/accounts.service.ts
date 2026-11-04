import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { ActivityService } from '../activity/activity.service';
import type { AuthUser } from '../auth/auth.types';
import { generateTemporaryPassword, hashPassword, passwordProblem } from '../auth/password';
import { SessionService } from '../auth/session.service';
import { DomainError } from '../common/errors/domain-error';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import { USERNAME_PATTERN, type AccountDto, type AccountWithPasswordDto, type CreateAccountDto, type UpdateAccountDto } from './accounts.dto';

type AccountRow = Prisma.UserGetPayload<{ include: { role: true } }>;

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly activity: ActivityService,
  ) {}

  async list(): Promise<AccountDto[]> {
    const rows = await this.prisma.user.findMany({ include: { role: true }, orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }] });
    return rows.map(toAccountDto);
  }

  async create(dto: CreateAccountDto, actor: AuthUser): Promise<AccountWithPasswordDto> {
    const username = normalizeUsername(dto.username);
    const role = await this.loadAssignableRole(dto.roleId, actor);
    await this.assertUnique(username, dto.email);
    const { password, temporary } = this.pickPassword(dto.password, username);

    const account = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          username,
          fullName: dto.fullName.trim(),
          email: dto.email?.trim().toLowerCase() || null,
          phone: dto.phone?.trim() || null,
          roleId: role.id,
          passwordHash: await hashPassword(password),
          mustChangePassword: true,
        },
        include: { role: true },
      });
      await this.activity.log(tx, { entityType: 'USER', entityId: u.id, action: 'ACCOUNT_CREATED', toValue: username, data: { role: role.name }, userId: actor.id });
      return u;
    });
    return { account: toAccountDto(account), temporaryPassword: temporary ? password : null };
  }

  async update(id: string, dto: UpdateAccountDto, actor: AuthUser): Promise<AccountDto> {
    const target = await this.loadEditable(id, actor);
    const isSelf = target.id === actor.id;
    if (isSelf && dto.isActive === false) throw DomainError.conflict('SELF_LOCK', 'You cannot lock your own account');
    if (isSelf && dto.roleId && dto.roleId !== target.roleId) throw DomainError.conflict('SELF_ROLE', 'You cannot change your own group');

    const username = dto.username !== undefined ? normalizeUsername(dto.username) : undefined;
    if (username && username !== target.username) await this.assertUnique(username, undefined);
    const email = dto.email === undefined ? undefined : dto.email.trim().toLowerCase() || null;
    if (email && email !== target.email) await this.assertUnique(undefined, email);
    const role = dto.roleId && dto.roleId !== target.roleId ? await this.loadAssignableRole(dto.roleId, actor) : undefined;

    const updated = await this.prisma.$transaction(async (tx) => {
      const losesAdmin = target.role.isSystem && target.isActive && ((role && !role.isSystem) || dto.isActive === false);
      if (losesAdmin) await this.assertAnotherAdmin(tx, target.id);

      const u = await tx.user.update({
        where: { id },
        data: {
          username,
          fullName: dto.fullName?.trim(),
          email,
          phone: dto.phone === undefined ? undefined : dto.phone.trim() || null,
          roleId: role?.id,
          isActive: dto.isActive,
        },
        include: { role: true },
      });
      if (role) {
        await this.activity.log(tx, { entityType: 'USER', entityId: id, action: 'ACCOUNT_ROLE_CHANGED', fromValue: target.role.name, toValue: role.name, userId: actor.id });
      }
      if (dto.isActive !== undefined && dto.isActive !== target.isActive) {
        await this.activity.log(tx, { entityType: 'USER', entityId: id, action: dto.isActive ? 'ACCOUNT_UNLOCKED' : 'ACCOUNT_LOCKED', userId: actor.id });
      }
      return u;
    });
    if (dto.isActive === false) await this.sessions.revokeAllForUser(id);
    return toAccountDto(updated);
  }

  /** Give the account a new password (or a generated temporary one) and sign it out everywhere. */
  async resetPassword(id: string, passwordInput: string | undefined, actor: AuthUser): Promise<AccountWithPasswordDto> {
    const target = await this.loadEditable(id, actor);
    if (target.id === actor.id) {
      throw DomainError.conflict('SELF_RESET', 'Use "Đổi mật khẩu" to change your own password');
    }
    const { password, temporary } = this.pickPassword(passwordInput, target.username);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id },
        data: { passwordHash: await hashPassword(password), mustChangePassword: true, passwordChangedAt: new Date() },
        include: { role: true },
      });
      await this.activity.log(tx, { entityType: 'USER', entityId: id, action: 'PASSWORD_RESET', userId: actor.id });
      return u;
    });
    await this.sessions.revokeAllForUser(id);
    return { account: toAccountDto(updated), temporaryPassword: temporary ? password : null };
  }

  /** Sign the account out of every browser. */
  async signOutEverywhere(id: string, actor: AuthUser): Promise<{ count: number }> {
    await this.loadEditable(id, actor);
    return { count: await this.sessions.revokeAllForUser(id) };
  }

  // ───────────── rules ─────────────

  /** Only administrators may touch administrator accounts. */
  private async loadEditable(id: string, actor: AuthUser): Promise<AccountRow> {
    const target = await this.prisma.user.findUnique({ where: { id }, include: { role: true } });
    if (!target) throw DomainError.notFound('Account', id);
    if (target.role.isSystem && !actor.isAdmin) {
      throw DomainError.forbidden('ADMIN_ONLY', 'Only an administrator can change an administrator account');
    }
    return target;
  }

  /** Only administrators may put someone into the administrator group. */
  private async loadAssignableRole(roleId: string, actor: AuthUser) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw DomainError.badRequest('ROLE_NOT_FOUND', 'Permission group not found');
    if (role.isSystem && !actor.isAdmin) {
      throw DomainError.forbidden('ADMIN_ONLY', 'Only an administrator can grant the administrator group');
    }
    return role;
  }

  private async assertAnotherAdmin(tx: Tx, exceptUserId: string): Promise<void> {
    const others = await tx.user.count({
      where: { id: { not: exceptUserId }, isActive: true, passwordHash: { not: null }, role: { isSystem: true } },
    });
    if (others === 0) {
      throw DomainError.conflict('LAST_ADMIN', 'At least one active administrator must remain. Add another administrator first.');
    }
  }

  private async assertUnique(username: string | undefined, email: string | undefined): Promise<void> {
    if (username && (await this.prisma.user.findUnique({ where: { username } }))) {
      throw DomainError.conflict('USERNAME_EXISTS', `Username "${username}" is already taken`);
    }
    const e = email?.trim().toLowerCase();
    if (e && (await this.prisma.user.findUnique({ where: { email: e } }))) {
      throw DomainError.conflict('EMAIL_EXISTS', `${e} already belongs to another account`);
    }
  }

  private pickPassword(input: string | undefined, username: string): { password: string; temporary: boolean } {
    if (input && input.length > 0) {
      const problem = passwordProblem(input, username);
      if (problem) throw DomainError.badRequest('WEAK_PASSWORD', problem);
      return { password: input, temporary: false };
    }
    return { password: generateTemporaryPassword(), temporary: true };
  }
}

export function normalizeUsername(input: string): string {
  const username = input.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(username)) {
    throw DomainError.badRequest('INVALID_USERNAME', 'Username: 3–32 characters, lowercase letters, digits, dot, dash or underscore, starting with a letter or digit');
  }
  return username;
}

export function toAccountDto(u: AccountRow): AccountDto {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    roleId: u.roleId,
    roleName: u.role.name,
    isAdmin: u.role.isSystem,
    isActive: u.isActive,
    hasPassword: u.passwordHash !== null,
    mustChangePassword: u.mustChangePassword,
    lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
    passwordChangedAt: u.passwordChangedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}
