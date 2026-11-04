import { HttpStatus } from '@nestjs/common';

/**
 * A business-rule failure with a stable machine-readable code.
 * The web app translates `code` into Vietnamese; `message` is for logs and API users.
 */
export class DomainError extends Error {
  constructor(
    readonly status: HttpStatus,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  static notFound(entity: string, id?: string): DomainError {
    return new DomainError(HttpStatus.NOT_FOUND, `${entity.toUpperCase()}_NOT_FOUND`, `${entity} not found`, id ? { id } : undefined);
  }

  static conflict(code: string, message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError(HttpStatus.CONFLICT, code, message, details);
  }

  static badRequest(code: string, message: string, details?: Record<string, unknown>): DomainError {
    return new DomainError(HttpStatus.BAD_REQUEST, code, message, details);
  }

  static forbidden(code: string, message: string): DomainError {
    return new DomainError(HttpStatus.FORBIDDEN, code, message);
  }
}
