import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PageQueryDto {
  /** 1-based page number */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = 1;

  /** Items per page (max 100) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize?: number = 20;

  /** Free-text search */
  @IsOptional() @IsString()
  q?: string;
}

export function pageArgs(query: PageQueryDto): { skip: number; take: number } {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 20;
  return { skip: (page - 1) * pageSize, take: pageSize };
}
