import amqplib from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { config } from '../config/index.js';
import { startAuditSubscriber } from '../subscribers/audit.subscriber.js';

const RETRY_DELAY_MS = 3_000;

let connection: ChannelModel;
let auditChannel: Channel;
let isShuttingDown = false;
let isReconnectingChannel = false;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ── Health state ─────────────────────────────────────────────────────────────

type RabbitHealth = { ok: boolean; error?: string };
let rabbitHealth: RabbitHealth = { ok: false, error: 'not yet connected' };

export function getRabbitMQHealth(): RabbitHealth {
  return rabbitHealth;
}

// ── Connection ───────────────────────────────────────────────────────────────

const connectWithRetry = async (): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      connection = await amqplib.connect(config.rabbitmq.url);
      return;
    } catch {
      console.warn(
        `[rabbitmq] Broker not ready (attempt ${attempt}) — retrying in ${RETRY_DELAY_MS / 1000}s`,
      );
      await sleep(RETRY_DELAY_MS);
    }
  }
};

// ── Channel setup (topology + subscriber) ────────────────────────────────────

/**
 * Topology (asserted idempotently on startup):
 *
 *  logs exchange (topic)
 *    └── audit queue ←── routing key: audit.logs  (DLX → audit.dlx)
 *
 *  audit.dlx exchange (fanout) — dead-letter sink
 *    └── audit.dead queue ←── all rejected / exhausted messages land here
 *
 * Single channel with prefetch(1): processes exactly one message at a time.
 * If the process crashes mid-retry the broker requeues the unacked message.
 *
 * IMPORTANT: If the `audit` queue was previously created WITHOUT
 * x-dead-letter-exchange (arguments: {}), it must be deleted via the
 * RabbitMQ management UI before restarting. Queue arguments are immutable
 * once declared.
 */
const setupAuditChannel = async (): Promise<void> => {
  auditChannel = await connection.createChannel();
  await auditChannel.prefetch(1);

  await auditChannel.assertExchange('audit.dlx', 'fanout', { durable: true });
  await auditChannel.assertQueue('audit.dead', { durable: true });
  await auditChannel.bindQueue('audit.dead', 'audit.dlx', '');

  await auditChannel.assertExchange('logs', 'topic', { durable: true });
  await auditChannel.assertQueue('audit', {
    durable: true,
    arguments: { 'x-dead-letter-exchange': 'audit.dlx' },
  });
  await auditChannel.bindQueue('audit', 'logs', 'audit.logs');

  await startAuditSubscriber(auditChannel);

  rabbitHealth = { ok: true };
  console.warn('[rabbitmq] Connected — auditChannel consuming');

  auditChannel.on('error', (err: Error) => {
    console.warn('[rabbitmq] Channel error:', err.message);
    // 'close' fires after 'error' — reconnect logic lives there
  });

  auditChannel.on('close', () => {
    if (isShuttingDown || isReconnectingChannel) return;
    isReconnectingChannel = true;
    rabbitHealth = { ok: false, error: 'channel closed — re-creating' };
    console.warn(`[rabbitmq] Channel closed — re-creating in ${RETRY_DELAY_MS / 1000}s`);
    setTimeout(() => {
      void setupAuditChannel()
        .catch((err: Error) => {
          // Connection gone — connection.on('close') will trigger full reconnect
          console.warn('[rabbitmq] Failed to re-create channel:', err.message);
        })
        .finally(() => {
          isReconnectingChannel = false;
        });
    }, RETRY_DELAY_MS);
  });
};

// ── Public lifecycle ──────────────────────────────────────────────────────────

export const initRabbitMQ = async (): Promise<void> => {
  await connectWithRetry();
  await setupAuditChannel();

  connection.on('error', (err: Error) => {
    console.warn('[rabbitmq] Connection error:', err.message);
    // 'close' fires after 'error' — reconnect logic lives there
  });

  connection.on('close', () => {
    if (isShuttingDown) return;
    rabbitHealth = { ok: false, error: 'connection lost — reconnecting' };
    console.warn('[rabbitmq] Connection lost — reconnecting...');
    setTimeout(() => {
      void initRabbitMQ();
    }, RETRY_DELAY_MS);
  });
};

export const closeRabbitMQ = async (): Promise<void> => {
  isShuttingDown = true;
  await auditChannel?.close();
  await connection?.close();
};
