import { Module } from '@nestjs/common';
import { AccountsController } from '../accounts/accounts.controller';
import { AccountsService } from '../accounts/accounts.service';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';

/** Accounts ("Tài khoản") and permission groups ("Nhóm quyền"). */
@Module({
  controllers: [AccountsController, RolesController],
  providers: [AccountsService, RolesService],
})
export class AccessModule {}
