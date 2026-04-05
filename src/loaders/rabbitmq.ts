import amqplib from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { config } from '../config/index.js';
import { startAuditSubscriber } from '../subscribers/audit.subscriber.js';

const RETRY_DELAY_MS = 3_000;

let connection: ChannelModel;
let auditChannel: Channel;
let isShuttingDown = false;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Retries indefinitely until the broker accepts a connection. */
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
export const initRabbitMQ = async (): Promise<void> => {
  await connectWithRetry();

  auditChannel = await connection.createChannel();
  await auditChannel.prefetch(1);

  // Assert dead-letter infrastructure
  await auditChannel.assertExchange('audit.dlx', 'fanout', { durable: true });
  await auditChannel.assertQueue('audit.dead', { durable: true });
  await auditChannel.bindQueue('audit.dead', 'audit.dlx', '');

  // Assert main exchange and queue
  await auditChannel.assertExchange('logs', 'topic', { durable: true });
  await auditChannel.assertQueue('audit', {
    durable: true,
    arguments: { 'x-dead-letter-exchange': 'audit.dlx' },
  });
  await auditChannel.bindQueue('audit', 'logs', 'audit.logs');

  await startAuditSubscriber(auditChannel);

  console.warn('[rabbitmq] Connected — auditChannel consuming');

  // Reconnect automatically on unexpected broker disconnect
  connection.on('close', () => {
    if (isShuttingDown) return;
    console.warn('[rabbitmq] Connection lost — reconnecting...');
    setTimeout(() => {
      void initRabbitMQ();
    }, RETRY_DELAY_MS);
  });

  connection.on('error', (err: Error) => {
    // 'close' will fire after 'error' — reconnect logic lives there
    console.warn('[rabbitmq] Connection error:', err.message);
  });
};

export const closeRabbitMQ = async (): Promise<void> => {
  isShuttingDown = true;
  await auditChannel?.close();
  await connection?.close();
};
