import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { LoginLimiter } from './login-limiter';
import { MoneyInterceptor } from './money.interceptor';
import { SessionService } from './session.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    SessionService,
    LoginLimiter,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: MoneyInterceptor },
  ],
  exports: [SessionService],
})
export class AuthModule {}
