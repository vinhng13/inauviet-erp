/**
 * Writes openapi.json for the web app's generated types. Run with `npm run openapi`.
 * Needs no running database: the Prisma client connects lazily.
 */
import 'reflect-metadata';
import { loadDotEnv } from './config/dotenv';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildOpenApi, setupApp } from './setup-app';

async function main(): Promise<void> {
  loadDotEnv();
  process.env.DATABASE_URL ??= 'postgresql://unused:unused@localhost:5432/unused';
  const app = await NestFactory.create(AppModule, { logger: false });
  setupApp(app);
  await app.init();
  const doc = buildOpenApi(app);
  const out = resolve(__dirname, '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  await app.close();
  console.log(`Wrote ${out}`);
}

void main();
