import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString() @IsNotEmpty() @MaxLength(50)
  username: string;

  @IsString() @IsNotEmpty() @MaxLength(200)
  password: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty() @MaxLength(200)
  currentPassword: string;

  /** At least 8 characters, must not contain the username */
  @IsString() @IsNotEmpty() @MaxLength(200)
  newPassword: string;
}

export class MeDto {
  id: string;
  username: string;
  fullName: string;
  roleId: string;
  roleName: string;
  /** Member of the built-in admin group (every permission) */
  isAdmin: boolean;
  /** Permission keys such as "orders.create" */
  permissions: string[];
  /** The account must set a new password before using the app */
  mustChangePassword: boolean;
}
