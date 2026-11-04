import { Module, RequestMethod } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AccessModule } from './access/access.module';
import { ActivityModule } from './activity/activity.module';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { ConfigModule } from './config/config.module';
import { CustomersModule } from './customers/customers.module';
import { HealthController } from './health/health.controller';
import { NumberingModule } from './numbering/numbering.module';
import { DocumentsModule } from './documents/documents.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';

const isProd = process.env.NODE_ENV === 'production';
const isTest = process.env.NODE_ENV === 'test';

@Module({
  imports: [
    LoggerModule.forRoot({
      // Express 5 route syntax; the default '*' triggers a "Unsupported route path" warning at startup.
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: isTest ? 'silent' : isProd ? 'info' : 'debug',
        transport: isProd || isTest ? undefined : { target: 'pino-pretty', options: { singleLine: true } },
        redact: ['req.headers.cookie', 'res.headers["set-cookie"]', 'req.body.password', 'req.body.currentPassword', 'req.body.newPassword'],
        customProps: (req) => ({ user: (req as { user?: { username: string } }).user?.username }),
        autoLogging: { ignore: (req) => req.url === '/api/v1/health' },
      },
    }),
    ConfigModule,
    PrismaModule,
    ActivityModule,
    NumberingModule,
    AuthModule,
    AccessModule,
    CustomersModule,
    CatalogModule,
    OrdersModule,
    DocumentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
