import { z } from 'zod';

const bool = z.preprocess(
  (v) => (v === '' || v === undefined ? undefined : v),
  z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** Days a login stays valid without use. Each use extends it. */
  SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  /** Send the session cookie only over HTTPS. Defaults to true in production. */
  COOKIE_SECURE: bool,
  APP_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),
  CORS_ORIGINS: z.string().optional(),
  /** Shop details printed at the top of every document (quote, order, acceptance report…) */
  COMPANY_NAME: z.string().default('In Âu Việt'),
  COMPANY_ADDRESS: z.string().default('[Địa chỉ cửa hàng]'),
  COMPANY_PHONE: z.string().default('[Số điện thoại]'),
  COMPANY_TAX_CODE: z.string().default('[Mã số thuế]'),
});

export type Env = z.infer<typeof envSchema> & { cookieSecure: boolean };

/** Validates process.env once at startup. The app refuses to start with a bad configuration. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join('\n')}`);
  }
  const env = parsed.data;
  return { ...env, cookieSecure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production' };
}

export const ENV = Symbol('ENV');
