import { ArrayUnique, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class PermissionActionDto {
  /** e.g. "create" */
  key: string;
  /** e.g. "Thêm" */
  label: string;
  description: string;
  /** Full permission key, e.g. "orders.create" */
  permission: string;
  /** Permissions automatically granted with this one */
  implies: string[];
}

export class PermissionModuleDto {
  key: string;
  label: string;
  actions: PermissionActionDto[];
}

export class SaveRoleDto {
  @IsString() @IsNotEmpty() @MaxLength(80)
  name: string;

  @IsOptional() @IsString() @MaxLength(300)
  description?: string;

  /** Permission keys. Unknown keys are ignored; implied ones are added. */
  @IsArray() @ArrayUnique() @IsString({ each: true })
  permissions: string[];
}

export class RoleDto {
  id: string;
  name: string;
  description: string | null;
  /** For the built-in admin group this is every permission */
  permissions: string[];
  /** Built-in admin group: cannot be edited or deleted */
  isSystem: boolean;
  userCount: number;
  createdAt: string;
}
