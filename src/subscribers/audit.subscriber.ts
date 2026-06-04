import type { Channel, ConsumeMessage } from 'amqplib';
import type { AuditEvent } from '../types/events.js';
import { AuditService } from '../services/audit.service.js';
import { withRetry } from '../utils/retry.js';
import { Prisma } from '../models/index.js';

const INFRA_RETRY_BASE_MS = 5_000;
const INFRA_RETRY_MAX_MS  = 60_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const infraRetryDelay = (attempt: number): number =>
  Math.min(INFRA_RETRY_BASE_MS * 2 ** (attempt - 1), INFRA_RETRY_MAX_MS);
// 5s → 10s → 20s → 40s → 60s (cap)

/**
 * Returns true for errors caused by infrastructure being unavailable
 * (DB unreachable, network timeout, Prisma engine failure).
 * Returns false for errors caused by bad message data (constraint violations,
 * validation errors) — those should go straight to the DLX.
 */
function isInfrastructureError(err: unknown): boolean {
  // Prisma can't reach the database at all
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  // P1xxx = "Can't reach server", "Timed out", "Connection closed", etc.
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code.startsWith('P1')
  ) return true;
  // Network errors that bubble up unwrapped (e.g. from the pg driver)
  const msg = err instanceof Error ? err.message : '';
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE/i.test(msg);
}

/**
 * Persists a single message with two layers of retry:
 *
 * Inner layer (withRetry, 3 attempts, fast backoff):
 *   Handles brief transient hiccups — a momentary DB stall, a single
 *   dropped connection from the pool, etc.
 *
 * Outer layer (this loop, indefinite, exponential backoff up to 60s):
 *   Handles sustained infrastructure outages — DB restart, pgbouncer
 *   cycling, network partition. The message stays unacked (prefetch=1
 *   blocks further deliveries) until the infrastructure recovers.
 *   If the process crashes during a sleep the broker requeues the message.
 *
 * Only sends to DLX when the error is definitively a bad-data problem
 * (constraint violation, validation failure) — not an infrastructure one.
 */
async function processMessage(
  channel: Channel,
  msg: ConsumeMessage,
  event: AuditEvent,
): Promise<void> {
  for (let infra = 1; ; infra++) {
    try {
      await withRetry(() => AuditService.persist(event));
      channel.ack(msg);
      return;
    } catch (err) {
      // Already processed — idempotent ack
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        console.warn('[audit.subscriber] Duplicate event_id — acking as already processed', {
          event_id: event.event_id,
        });
        channel.ack(msg);
        return;
      }

      // Infrastructure down — hold the message and wait for recovery
      if (isInfrastructureError(err)) {
        const delay = infraRetryDelay(infra);
        console.warn(
          `[audit.subscriber] Infrastructure unavailable (attempt ${infra}) — retrying in ${delay / 1_000}s`,
          { event_id: event.event_id, error: (err as Error).message },
        );
        await sleep(delay);
        continue;
      }

      // Bad message data — will never succeed, send to DLX
      console.error('[audit.subscriber] Persist failed after retries — sending to DLX', {
        event_id: event.event_id,
        error: (err as Error).message,
      });
      channel.nack(msg, false, false);
      return;
    }
  }
}

export const startAuditSubscriber = async (channel: Channel): Promise<void> => {
  await channel.consume('audit', (msg: ConsumeMessage | null) => {
    if (!msg) return; // consumer cancelled by broker

    // Parse synchronously before going async so we can nack on bad JSON immediately
    let event: AuditEvent;
    try {
      event = JSON.parse(msg.content.toString()) as AuditEvent;
    } catch {
      console.error('[audit.subscriber] Malformed JSON — nacking to DLX');
      channel.nack(msg, false, false);
      return;
    }

    // Intentionally not awaited — amqplib's consume callback is synchronous.
    // processMessage manages ack/nack and holds the prefetch slot until resolved.
    void processMessage(channel, msg, event);
  });

  console.warn('[audit.subscriber] Consuming from audit queue');
};
