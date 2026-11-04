import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

/** Typed API client generated from api/openapi.json. Regenerate with `npm run api:types`. The session cookie is sent automatically. */
export const api = createClient<paths>({ baseUrl: '/', credentials: 'include' });

export type Schemas = components['schemas'];

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(readonly body: ApiErrorBody) {
    super(body.message);
  }
  get code(): string {
    return this.body.code;
  }
  get status(): number {
    return this.body.statusCode;
  }
}

/** Unwrap an openapi-fetch result: return data, or throw ApiError with the API's { code, message }. */
export async function unwrap<T>(promise: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await promise;
  if (error !== undefined || !response.ok) {
    const body = (error ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError({
      statusCode: body.statusCode ?? response.status,
      code: body.code ?? `HTTP_${response.status}`,
      message: body.message ?? response.statusText,
      details: body.details,
    });
  }
  return data as T;
}
