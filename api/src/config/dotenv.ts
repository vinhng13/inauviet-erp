import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Load api/.env when present (local development). Real environment variables always win.
 * Values are copied onto process.env explicitly (instead of process.loadEnvFile) so that
 * sandboxes with their own process.env object, such as Jest, see them too.
 */
export function loadDotEnv(path = '.env'): void {
  if (!existsSync(path)) return; // no .env file: rely on the environment (Docker, CI)
  const values = parseEnv(readFileSync(path, 'utf8')) as Record<string, string>;
  for (const [key, value] of Object.entries(values)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
