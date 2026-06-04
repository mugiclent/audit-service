import { defineConfig } from 'prisma/config';
import 'dotenv/config';

// Connection config for Prisma CLI (migrate dev, migrate deploy, etc.).
// All CLI commands use DIRECT_DATABASE_URL (db:5432) to bypass PgBouncer —
// migrations require a real session connection for advisory locks and DDL.
// The app runtime uses PgBouncer via src/models/index.ts.
export default defineConfig({
  schema: './prisma/schema.prisma',
  datasource: {
    url: process.env['DIRECT_DATABASE_URL']!,
    shadowDatabaseUrl: process.env['SHADOW_DATABASE_URL'],
  },
});
