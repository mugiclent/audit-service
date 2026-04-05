import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

// Uses the JS-based schema engine (driver adapter) for Prisma CLI operations.
// The app runtime also uses PrismaPg — see src/models/index.ts.
export default defineConfig({
  schema: './prisma/schema.prisma',
  experimental: { adapter: true },
  adapter: async () => new PrismaPg({
    connectionString: `postgresql://audit_svc:${process.env['DB_PASSWORD']}@pgbouncer:6432/audit_db?pgbouncer=true&connect_timeout=5&pool_timeout=5`,
  }),
});
