import { PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export class CreateAccountDto {
  /** 3–32 characters: lowercase letters, digits, dot, dash, underscore. Stored in lowercase. */
  @IsString() @MinLength(3) @MaxLength(32)
  username: string;

  @IsString() @IsNotEmpty() @MaxLength(120)
  fullName: string;

  @IsOptional() @IsEmail() @MaxLength(200)
  email?: string;

  @IsOptional() @IsString() @MaxLength(20)
  phone?: string;

  /** Permission group */
  @IsUUID()
  roleId: string;

  /** Initial password. Leave empty to generate a temporary one (shown once in the response). */
  @IsOptional() @IsString() @MaxLength(200)
  password?: string;
}

export class UpdateAccountDto extends PartialType(CreateAccountDto) {
  /** false = locked: cannot sign in, current sessions end immediately */
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class ResetPasswordDto {
  /** New password. Leave empty to generate a temporary one. The account must change it at next sign-in. */
  @IsOptional() @IsString() @MaxLength(200)
  password?: string;
}

export class AccountDto {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  roleId: string;
  roleName: string;
  /** In the built-in admin group */
  isAdmin: boolean;
  isActive: boolean;
  /** No password yet: cannot sign in until one is set */
  hasPassword: boolean;
  mustChangePassword: boolean;
  lastSeenAt: string | null;
  passwordChangedAt: string | null;
  createdAt: string;
}

export class AccountWithPasswordDto {
  account: AccountDto;
  /** Only when the server generated the password. Shown once; give it to the person. */
  temporaryPassword: string | null;
}


export class SignOutResultDto {
  /** Sessions ended */
  count: number;
}
