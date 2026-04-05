import 'dotenv/config';
import './config/env.js'; // fail-fast env validation at startup
import { config } from './config/index.js';
import express from 'express';
import type { Request, Response } from 'express';
import { initPrisma } from './loaders/prisma.js';
import { initRabbitMQ, closeRabbitMQ } from './loaders/rabbitmq.js';
import { prisma } from './models/index.js';
import { auditRouter } from './api/audit.routes.js';
import { errorHandler } from './middleware/errorHandler.js';

const start = async (): Promise<void> => {
  await initPrisma();
  await initRabbitMQ();

  const app = express();
  app.use(express.json());

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ status: 'ok', service: 'audit-svc', timestamp: new Date().toISOString() });
  });

  app.use('/api/v1/audit-logs', auditRouter);

  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    console.warn(
      `[server] Listening on port ${config.port} (${config.isProd ? 'production' : 'development'})`,
    );
    console.warn('[server] Consuming audit queue');
  });

  const shutdown = async (signal: string): Promise<void> => {
    console.warn(`[server] ${signal} received — shutting down`);
    server.close(async () => {
      await prisma.$disconnect();
      await closeRabbitMQ();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
};

start().catch((err) => {
  console.error('[server] Failed to start', err);
  process.exit(1);
});
