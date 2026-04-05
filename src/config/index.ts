// Infrastructure config — excluded from unit test coverage (see vitest.config.ts)
import { env } from './env.js';

export const config = {
  port: env.PORT,
  isProd: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',

  db: {
    url: `postgresql://audit_svc:${env.DB_PASSWORD}@pgbouncer:6432/audit_db?pgbouncer=true&connect_timeout=5&pool_timeout=5`,
  },

  rabbitmq: {
    url: `amqp://${env.RABBITMQ_USER}:${env.RABBITMQ_PASSWORD}@rabbitmq:5672`,
  },
} as const;
