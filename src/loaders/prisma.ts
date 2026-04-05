import { prisma } from '../models/index.js';

const RETRY_DELAY_MS = 3_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const initPrisma = async (): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await prisma.$connect();
      console.warn('[prisma] Connected to database');
      return;
    } catch {
      console.warn(
        `[prisma] Database not ready (attempt ${attempt}) — retrying in ${RETRY_DELAY_MS / 1000}s`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
};
