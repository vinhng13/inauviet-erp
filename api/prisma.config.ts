import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Read from api/.env. `prisma generate` needs no database, so a missing value only matters for migrate commands.
    url: process.env.DATABASE_URL ?? 'postgresql://missing-DATABASE_URL@localhost:5432/missing',
  },
});
