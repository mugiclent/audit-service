// Infrastructure config — excluded from unit test coverage (see vitest.config.ts)
import { env } from './env.js';

export const config = {
  port: env.PORT,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  db: {
    // Local dev:  DATABASE_URL points directly to postgres:5432 (no pgbouncer)
    // Production: build pgbouncer URL from DB_PASSWORD (injected by Infisical)
    url: env.DATABASE_URL ??
      `postgresql://audit_svc:${env.DB_PASSWORD}@pgbouncer:6432/audit_db?pgbouncer=true&connect_timeout=5&pool_timeout=5`,
  },

  rabbitmq: {
    // Local dev:  RABBITMQ_URL = amqp://guest:guest@rabbitmq:5672
    // Production: build URL from RABBITMQ_USER + RABBITMQ_PASSWORD (injected by Infisical)
    url: env.RABBITMQ_URL ??
      `amqp://${env.RABBITMQ_USER}:${env.RABBITMQ_PASSWORD}@rabbitmq:5672`,
  },
} as const;
