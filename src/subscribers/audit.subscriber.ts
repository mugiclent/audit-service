import type { Channel, ConsumeMessage } from 'amqplib';
import type { AuditEvent } from '../types/events.js';
import { AuditService } from '../services/audit.service.js';
import { withRetry } from '../utils/retry.js';
import { Prisma } from '../models/index.js';

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

    // Intentionally not awaited at the outer level — amqplib's consume callback
    // is synchronous. We manage ack/nack ourselves inside the promise chain.
    void (async () => {
      try {
        await withRetry(() => AuditService.persist(event));
        channel.ack(msg);
      } catch (err) {
        // Duplicate event_id (unique constraint) — already processed, ack silently
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

        // Exhausted retries — send to DLX for manual inspection
        console.error('[audit.subscriber] Persist failed after retries — sending to DLX', {
          event_id: event.event_id,
          error: (err as Error).message,
        });
        channel.nack(msg, false, false);
      }
    })();
  });

  console.warn('[audit.subscriber] Consuming from audit queue');
};
