import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission } from '../access/permissions';
import type { AuthUser } from './auth.types';

export const IS_PUBLIC = 'auth:public';
export const PERMISSIONS = 'auth:permissions';
export const SIGNED_IN = 'auth:signedIn';
export const ALLOW_PENDING_PASSWORD = 'auth:allowPendingPassword';

/** No login needed (health check, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Caller needs ALL of these permissions. Every non-public route must declare this or @SignedIn(). */
export const RequirePermission = (...permissions: Permission[]) => SetMetadata(PERMISSIONS, permissions);

/** Any signed-in account may call this route. */
export const SignedIn = () => SetMetadata(SIGNED_IN, true);

/** Still allowed while the account must change its password (me, change password, logout). */
export const AllowPendingPassword = () => SetMetadata(ALLOW_PENDING_PASSWORD, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<Request>().user;
  if (!user) throw new Error('CurrentUser used on a route without authentication');
  return user;
});
