import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { normalizePermissions, type Permission } from '../src/access/permissions';
import { LoginLimiter } from '../src/auth/login-limiter';
import { hashPassword } from '../src/auth/password';
import { PrismaService } from '../src/prisma/prisma.service';
import { setupApp } from '../src/setup-app';

export const PASSWORD = 'Test-Password-2026';
export const ADMIN = 'admin';
export const STAFF = 'staff';

/** What the old "STAFF" role could do. */
export const STAFF_PERMISSIONS: Permission[] = [
  'orders.create', 'orders.update', 'orders.cancel',
  'deliveries.create', 'deliveries.update', 'deliveries.deliver', 'deliveries.cancel',
  'payments.create', 'customers.create', 'customers.update',
];

export interface Api {
  get: (path: string) => request.Test;
  post: (path: string, body?: object) => request.Test;
  patch: (path: string, body?: object) => request.Test;
  put: (path: string, body?: object) => request.Test;
  delete: (path: string) => request.Test;
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  /** Signed in as the administrator */
  api: Api;
  /** Sign in as any account and get a client that keeps the session cookie */
  login: (username: string, password?: string) => Promise<Api>;
  anonymous: Api;
}

function wrap(agent: ReturnType<typeof request.agent>): Api {
  const p = (path: string) => `/api/v1${path}`;
  return {
    get: (path) => agent.get(p(path)),
    post: (path, body) => agent.post(p(path)).send(body ?? {}),
    patch: (path, body) => agent.patch(p(path)).send(body ?? {}),
    put: (path, body) => agent.put(p(path)).send(body ?? {}),
    delete: (path) => agent.delete(p(path)),
  };
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  const server = app.getHttpServer();
  const ctx: TestContext = {
    app,
    prisma,
    api: undefined as unknown as Api,
    anonymous: wrap(request.agent(server)),
    login: async (username, password = PASSWORD) => {
      const agent = request.agent(server);
      const res = await agent.post('/api/v1/auth/login').send({ username, password });
      if (res.status !== 200) throw new Error(`login ${username} failed: ${res.status} ${JSON.stringify(res.body)}`);
      return wrap(agent);
    },
  };
  return ctx;
}

/**
 * Wipe every table, then create the built-in admin group with account "admin" and a group
 * "Nhân viên" with account "staff". Both have password PASSWORD and no forced change.
 */
export async function resetDatabase(t: TestContext): Promise<void> {
  t.app.get(LoginLimiter).reset();
  await t.prisma.$executeRawUnsafe(
    'TRUNCATE "Session", "Payment", "DeliveryLine", "Delivery", "OrderLine", "DesignVersion", "Order", "QuoteLine", "Quote", "Product", "Customer", "ActivityLog", "DocumentSequence", "User", "Role", "JournalEntry", "PeriodOpening", "MaterialOpening", "StockReceipt", "StockIssue", "CashPayment", "AccountingPeriod", "FixedAsset", "Material", "Supplier" CASCADE',
  );
  const passwordHash = await hashPassword(PASSWORD);
  const admin = await t.prisma.role.create({ data: { name: 'Quản trị viên', isSystem: true } });
  const staff = await t.prisma.role.create({ data: { name: 'Nhân viên', permissions: normalizePermissions(STAFF_PERMISSIONS) } });
  await t.prisma.user.createMany({
    data: [
      { username: ADMIN, fullName: 'Admin', roleId: admin.id, passwordHash, mustChangePassword: false },
      { username: STAFF, fullName: 'Staff', roleId: staff.id, passwordHash, mustChangePassword: false },
    ],
  });
  t.api = await t.login(ADMIN);
}
