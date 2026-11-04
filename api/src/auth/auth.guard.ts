import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import type { Permission } from '../access/permissions';
import { ENV, type Env } from '../config/env';
import { DomainError } from '../common/errors/domain-error';
import { can } from './auth.types';
import { readCookie, SESSION_COOKIE, setSessionCookie } from './cookies';
import { ALLOW_PENDING_PASSWORD, IS_PUBLIC, PERMISSIONS, SIGNED_IN } from './decorators';
import { SessionService } from './session.service';

/**
 * Global guard, fail-closed:
 *   1. @Public routes pass.
 *   2. Otherwise a valid session cookie is required (401 UNAUTHENTICATED).
 *   3. An account that must change its password can only reach routes marked @AllowPendingPassword.
 *   4. The route must declare @RequirePermission(...) or @SignedIn(); a route with neither is refused.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const token = readCookie(req, SESSION_COOKIE);
    const resolved = token ? await this.sessions.resolve(token) : null;
    if (!resolved) throw new DomainError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED', 'Please sign in');
    const user = resolved.user;
    req.user = user;
    if (resolved.renewedExpiry && token) {
      setSessionCookie(ctx.switchToHttp().getResponse<Response>(), token, resolved.renewedExpiry, this.env.cookieSecure);
    }

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD, targets)) {
      throw DomainError.forbidden('PASSWORD_CHANGE_REQUIRED', 'Change your password before continuing');
    }

    const required = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSIONS, targets);
    if (required) {
      const missing = required.filter((p) => !can(user, p));
      if (missing.length) {
        throw new DomainError(HttpStatus.FORBIDDEN, 'PERMISSION_DENIED', `Missing permission: ${missing.join(', ')}`, { missing });
      }
      return true;
    }
    if (this.reflector.getAllAndOverride<boolean>(SIGNED_IN, targets)) return true;

    this.logger.error(`Route ${req.method} ${req.path} declares no permission; refusing`);
    throw DomainError.forbidden('PERMISSION_DENIED', 'This route has no permission rule');
  }
}
