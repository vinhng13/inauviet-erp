/**
 * Emergency access when nobody can sign in as administrator:
 *   npm run user:reset-admin -- <username> ["Full Name"]
 * Puts the account in the administrator group, unlocks it, gives it a temporary password (printed)
 * and signs it out everywhere. Creates the account if it doesn't exist. Run on the server.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { generateTemporaryPassword, hashPassword } from '../src/auth/password';

async function main(): Promise<void> {
  const [usernameArg, nameArg] = process.argv.slice(2);
  if (!usernameArg) {
    console.error('Usage: npm run user:reset-admin -- <username> ["Full Name"]');
    process.exitCode = 1;
    return;
  }
  const username = usernameArg.trim().toLowerCase();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
  try {
    const adminRole = await prisma.role.findFirstOrThrow({ where: { isSystem: true } });
    const password = generateTemporaryPassword();
    const data = { roleId: adminRole.id, isActive: true, passwordHash: await hashPassword(password), mustChangePassword: true, passwordChangedAt: new Date() };
    const user = await prisma.user.upsert({
      where: { username },
      update: data,
      create: { ...data, username, fullName: nameArg ?? username },
    });
    await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await prisma.activityLog.create({ data: { entityType: 'USER', entityId: user.id, action: 'ADMIN_RESET_FROM_CLI', toValue: adminRole.name } });
    console.log(`${user.username} is now an active administrator. Temporary password: ${password}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
