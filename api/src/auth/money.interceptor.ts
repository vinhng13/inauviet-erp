import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { can } from './auth.types';

/**
 * Accounts without "money.view" never receive prices or amounts: every response field ending in
 * "Vnd", plus paymentStatus, is removed on the server. Hiding them in the UI alone would not be enough.
 */
@Injectable()
export class MoneyInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user || can(user, 'money.view')) return next.handle();
    return next.handle().pipe(map(stripMoney));
  }
}

export function stripMoney(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripMoney);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.endsWith('Vnd') || k === 'paymentStatus') continue;
      out[k] = stripMoney(v);
    }
    return out;
  }
  return value;
}
