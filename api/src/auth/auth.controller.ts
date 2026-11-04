import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { ENV, type Env } from '../config/env';
import { ChangePasswordDto, LoginDto, MeDto } from './auth.dto';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { clearSessionCookie, clientIp, setSessionCookie } from './cookies';
import { AllowPendingPassword, CurrentUser, Public, SignedIn } from './decorators';
import { SessionService } from './session.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Sign in. Sets an HttpOnly session cookie. 5 wrong passwords lock the username for 15 minutes. */
  @Public()
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<MeDto> {
    const { token, expiresAt } = await this.auth.login(dto.username, dto.password, { ip: clientIp(req), userAgent: req.header('user-agent') });
    setSessionCookie(res, token, expiresAt, this.env.cookieSecure);
    const resolved = await this.sessions.resolve(token);
    return this.auth.me(resolved!.user);
  }

  @SignedIn()
  @AllowPendingPassword()
  @HttpCode(204)
  @Post('logout')
  async logout(@CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.sessions.revoke(user.sessionId);
    clearSessionCookie(res, this.env.cookieSecure);
  }

  /** The signed-in account, its group and permission keys */
  @SignedIn()
  @AllowPendingPassword()
  @Get('me')
  me(@CurrentUser() user: AuthUser): MeDto {
    return this.auth.me(user);
  }

  /** Change your own password. Signs out your other browsers. */
  @SignedIn()
  @AllowPendingPassword()
  @HttpCode(204)
  @Post('change-password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
  }
}
