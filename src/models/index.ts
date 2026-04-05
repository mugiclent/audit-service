import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { config } from '../config/index.js';

const adapter = new PrismaPg({ connectionString: config.db.url });

export const prisma = new PrismaClient({ adapter });

export type { AuditLog } from '@prisma/client';
export { Prisma } from '@prisma/client';
