import type { Permission } from '../access/permissions';

/** The signed-in staff member, attached to every authenticated request. */
export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  roleId: string;
  roleName: string;
  /** Member of the built-in "Quản trị viên" group: has every permission */
  isAdmin: boolean;
  permissions: ReadonlySet<Permission>;
  mustChangePassword: boolean;
  sessionId: string;
}

export function can(user: AuthUser, permission: Permission): boolean {
  return user.isAdmin || user.permissions.has(permission);
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}
