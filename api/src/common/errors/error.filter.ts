import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client';
import { DomainError } from './domain-error';

export interface ErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Every error leaves the API in the same JSON shape: { statusCode, code, message, details? }. */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) this.logger.error(exception);
    res.status(body.statusCode).json(body);
  }

  private toBody(e: unknown): ErrorBody {
    if (e instanceof DomainError) {
      return { statusCode: e.status, code: e.code, message: e.message, details: e.details };
    }
    if (e instanceof HttpException) {
      const status = e.getStatus();
      const response = e.getResponse();
      if (status === HttpStatus.BAD_REQUEST && typeof response === 'object' && Array.isArray((response as { message?: unknown }).message)) {
        return {
          statusCode: status,
          code: 'VALIDATION_FAILED',
          message: 'Request validation failed',
          details: { errors: (response as { message: string[] }).message },
        };
      }
      const message = typeof response === 'string' ? response : ((response as { message?: string }).message ?? e.message);
      return { statusCode: status, code: HttpStatus[status] ?? 'HTTP_ERROR', message: String(message) };
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return { statusCode: 409, code: 'ALREADY_EXISTS', message: 'A record with the same unique value already exists', details: e.meta };
      }
      if (e.code === 'P2025') {
        return { statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' };
      }
    }
    return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Unexpected server error' };
  }
}
