import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Matches, Max, Min } from 'class-validator';

/** "YYYY-MM-DD" calendar date */
export const DateOnly = (description?: string) =>
  applyDecorators(
    ApiProperty({ type: 'string', format: 'date', example: '2026-11-02', description }),
    Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '$property must be a date in YYYY-MM-DD format' }),
  );

/** Whole đồng, 0 or more */
export const Vnd = (min = 0) =>
  applyDecorators(IsInt(), Min(min), Max(Number.MAX_SAFE_INTEGER));
