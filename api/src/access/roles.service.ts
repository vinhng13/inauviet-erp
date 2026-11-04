import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { ActivityService } from '../activity/activity.service';
import type { AuthUser } from '../auth/auth.types';
import { DomainError } from '../common/errors/domain-error';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_PERMISSIONS, IMPLIED, normalizePermissions, PERMISSION_MODULES, type Permission } from './permissions';
import type { PermissionModuleDto, RoleDto, SaveRoleDto } from './roles.dto';

type RoleRow = Prisma.RoleGetPayload<{ include: { _count: { select: { users: true } } } }>;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  catalog(): PermissionModuleDto[] {
    return PERMISSION_MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      actions: m.actions.map((a) => {
        const permission = `${m.key}.${a.key}` as Permission;
        return { key: a.key, label: a.label, description: a.description, permission, implies: IMPLIED[permission] ?? [] };
      }),
    }));
  }

  async list(): Promise<RoleDto[]> {
    const rows = await this.prisma.role.findMany({
      include: { _count: { select: { users: true } } },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toRoleDto);
  }

  async create(dto: SaveRoleDto, actor: AuthUser): Promise<RoleDto> {
    const name = dto.name.trim();
    await this.assertNameFree(name);
    return this.prisma.$transaction(async (tx) => {
      const role = await tx.role.create({
        data: { name, description: dto.description?.trim() || null, permissions: normalizePermissions(dto.permissions) },
        include: { _count: { select: { users: true } } },
      });
      await this.activity.log(tx, { entityType: 'ROLE', entityId: role.id, action: 'ROLE_CREATED', toValue: name, data: { permissions: role.permissions }, userId: actor.id });
      return toRoleDto(role);
    });
  }

  async update(id: string, dto: SaveRoleDto, actor: AuthUser): Promise<RoleDto> {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw DomainError.notFound('Role', id);
    if (role.isSystem) throw DomainError.conflict('SYSTEM_ROLE', 'The built-in admin group cannot be changed');
    // Without this, anyone allowed to edit groups could grant their own group more rights.
    if (role.id === actor.roleId && !actor.isAdmin) {
      throw DomainError.forbidden('OWN_ROLE', 'You cannot change the group you belong to. Ask an administrator.');
    }
    const name = dto.name.trim();
    if (name !== role.name) await this.assertNameFree(name);
    const permissions = normalizePermissions(dto.permissions);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.role.update({
        where: { id },
        data: { name, description: dto.description?.trim() || null, permissions },
        include: { _count: { select: { users: true } } },
      });
      const before = new Set(role.permissions);
      const after = new Set<string>(permissions);
      await this.activity.log(tx, {
        entityType: 'ROLE',
        entityId: id,
        action: 'ROLE_UPDATED',
        fromValue: role.name,
        toValue: name,
        data: { added: permissions.filter((p) => !before.has(p)), removed: role.permissions.filter((p) => !after.has(p)) },
        userId: actor.id,
      });
      return toRoleDto(updated);
    });
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { id }, include: { _count: { select: { users: true } } } });
    if (!role) throw DomainError.notFound('Role', id);
    if (role.isSystem) throw DomainError.conflict('SYSTEM_ROLE', 'The built-in admin group cannot be deleted');
    if (role._count.users > 0) {
      throw DomainError.conflict('ROLE_IN_USE', `${role._count.users} account(s) still use this group. Move them to another group first.`, {
        userCount: role._count.users,
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await this.activity.log(tx, { entityType: 'ROLE', entityId: id, action: 'ROLE_DELETED', fromValue: role.name, userId: actor.id });
    });
  }

  private async assertNameFree(name: string): Promise<void> {
    const existing = await this.prisma.role.findFirst({ where: { name: { equals: name, mode: 'insensitive' } } });
    if (existing) throw DomainError.conflict('ROLE_NAME_EXISTS', `A group named "${existing.name}" already exists`);
  }
}

function toRoleDto(r: RoleRow): RoleDto {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    permissions: r.isSystem ? ALL_PERMISSIONS : normalizePermissions(r.permissions ?? []),
    isSystem: r.isSystem,
    userCount: r._count.users,
    createdAt: r.createdAt.toISOString(),
  };
}
