import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission } from '../auth/decorators';
import { AccountDto, AccountWithPasswordDto, CreateAccountDto, ResetPasswordDto, SignOutResultDto, UpdateAccountDto } from './accounts.dto';
import { AccountsService } from './accounts.service';

@ApiTags('accounts')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @RequirePermission('accounts.view')
  @Get()
  list(): Promise<AccountDto[]> {
    return this.accounts.list();
  }

  /** Create an account by hand. Without a password, a temporary one is generated and returned once. */
  @RequirePermission('accounts.create')
  @Post()
  create(@Body() dto: CreateAccountDto, @CurrentUser() actor: AuthUser): Promise<AccountWithPasswordDto> {
    return this.accounts.create(dto, actor);
  }

  /** Edit details, change group, lock (isActive=false) or unlock */
  @RequirePermission('accounts.update')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto, @CurrentUser() actor: AuthUser): Promise<AccountDto> {
    return this.accounts.update(id, dto, actor);
  }

  /** Set a new password (or generate a temporary one). The account must change it at next sign-in. */
  @RequirePermission('accounts.resetPassword')
  @HttpCode(200)
  @Post(':id/reset-password')
  resetPassword(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResetPasswordDto, @CurrentUser() actor: AuthUser): Promise<AccountWithPasswordDto> {
    return this.accounts.resetPassword(id, dto.password, actor);
  }

  /** End every session of this account */
  @RequirePermission('accounts.update')
  @HttpCode(200)
  @Post(':id/sign-out')
  signOut(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<SignOutResultDto> {
    return this.accounts.signOutEverywhere(id, actor);
  }
}
