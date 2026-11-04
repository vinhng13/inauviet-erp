import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { ErrorFilter } from './common/errors/error.filter';

export const API_PREFIX = 'api/v1';

/** Shared by main.ts, the OpenAPI export and the e2e tests, so all three behave the same. */
export function setupApp(app: INestApplication): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ErrorFilter());
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Inauviet ERP API')
    .setDescription(
      'Orders, delivery trips and payments. Every error has the shape { statusCode, code, message, details? }. ' +
        'Sign in with POST /auth/login: the session is kept in the HttpOnly cookie erp_session. ' +
        'Each endpoint lists the permission it needs (e.g. orders.create); 403 PERMISSION_DENIED names what is missing.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('erp_session')
    .build();
  return SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controllerKey, methodKey) => `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
}
