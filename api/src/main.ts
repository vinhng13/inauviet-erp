import 'reflect-metadata';
import { loadDotEnv } from './config/dotenv';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';
import { API_PREFIX, buildOpenApi, setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  loadDotEnv();
  const env = loadEnv(); // fail fast on bad configuration
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  // Behind cloudflared → Caddy inside Docker: trust proxies on private networks so req.ip is the real client
  // (used by the login rate limit and the session list).
  app.getHttpAdapter().getInstance().set('trust proxy', 'loopback, linklocal, uniquelocal');
  if (env.CORS_ORIGINS) {
    app.enableCors({ origin: env.CORS_ORIGINS.split(',').map((o) => o.trim()), credentials: true });
  }
  setupApp(app);
  if (env.NODE_ENV !== 'production') {
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, buildOpenApi(app));
  }
  await app.listen(env.PORT, '0.0.0.0');
  app.get(Logger).log(`API listening on http://localhost:${env.PORT}/${API_PREFIX}`);
}

void bootstrap();
