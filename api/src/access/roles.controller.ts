import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, RequirePermission, SignedIn } from '../auth/decorators';
import { PermissionModuleDto, RoleDto, SaveRoleDto } from './roles.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Every module and action that can be granted, with Vietnamese labels */
  @SignedIn()
  @Get('permissions')
  catalog(): PermissionModuleDto[] {
    return this.roles.catalog();
  }

  /** Permission groups with their permissions and how many accounts use each */
  @RequirePermission('roles.view')
  @Get('roles')
  list(): Promise<RoleDto[]> {
    return this.roles.list();
  }

  @RequirePermission('roles.manage')
  @Post('roles')
  create(@Body() dto: SaveRoleDto, @CurrentUser() actor: AuthUser): Promise<RoleDto> {
    return this.roles.create(dto, actor);
  }

  /** Changes take effect on the next request of every account in the group */
  @RequirePermission('roles.manage')
  @Patch('roles/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveRoleDto, @CurrentUser() actor: AuthUser): Promise<RoleDto> {
    return this.roles.update(id, dto, actor);
  }

  /** Only groups no account uses can be deleted */
  @RequirePermission('roles.manage')
  @HttpCode(204)
  @Delete('roles/:id')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser): Promise<void> {
    await this.roles.remove(id, actor);
  }
}
