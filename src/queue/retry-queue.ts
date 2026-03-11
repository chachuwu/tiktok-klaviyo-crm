import { Queue, Worker, Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { TikTokEventsPayload, KlaviyoEventPayload } from '../types';
import { TikTokAPIClient } from '../clients/tiktok-api-client';
import { KlaviyoAPIClient } from '../clients/klaviyo-api-client';
import { EventLog } from '../db/event-log';
import { logger } from '../logging/logger';

export interface QueueMetrics {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}

interface OutboundJobData {
  payload: TikTokEventsPayload;
  advertiserId: string;
  eventId: string;
}

interface InboundJobData {
  payload: KlaviyoEventPayload;
  eventId: string;
}

export class RetryQueue {
  private readonly outboundQueue: Queue;
  private readonly inboundQueue: Queue;
  private outboundWorker?: Worker;
  private inboundWorker?: Worker;

  constructor(
    redis: Redis,
    tiktokAPIClient: TikTokAPIClient,
    klaviyoAPIClient: KlaviyoAPIClient,
    eventLog: EventLog,
    rateLimitRps: number
  ) {
    const connection = redis;

    this.outboundQueue = new Queue('tiktok-events', {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });

    this.inboundQueue = new Queue('klaviyo-events', {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });

    // Outbound worker: sends events to TikTok
    this.outboundWorker = new Worker<OutboundJobData>(
      'tiktok-events',
      async (job: Job<OutboundJobData>) => {
        const { payload, advertiserId, eventId } = job.data;

        await eventLog.incrementAttempt(eventId);

        try {
          const response = await tiktokAPIClient.sendEvents(payload, advertiserId);
          await eventLog.updateStatus(eventId, 'sent', response);
          logger.info({ eventId, advertiserId }, 'Outbound queue: TikTok event sent');
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          logger.error({ err, eventId }, 'Outbound queue: TikTok send failed');
          throw err; // Re-throw to trigger BullMQ retry
        }
      },
      {
        connection,
        concurrency: 5,
        limiter: {
          max: rateLimitRps,
          duration: 1000,
        },
      }
    );

    // Inbound worker: sends events to Klaviyo
    this.inboundWorker = new Worker<InboundJobData>(
      'klaviyo-events',
      async (job: Job<InboundJobData>) => {
        const { payload, eventId } = job.data;

        await eventLog.incrementAttempt(eventId);

        try {
          await klaviyoAPIClient.createEvent(payload);
          await eventLog.updateStatus(eventId, 'sent');
          logger.info({ eventId }, 'Inbound queue: Klaviyo event sent');
        } catch (err) {
          logger.error({ err, eventId }, 'Inbound queue: Klaviyo send failed');
          throw err; // Re-throw to trigger BullMQ retry
        }
      },
      {
        connection,
        concurrency: 5,
      }
    );

    // Handle job completion failures (exhausted retries)
    this.outboundWorker.on('failed', async (job: Job<OutboundJobData> | undefined, err: Error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 5)) {
        await eventLog.updateStatus(job.data.eventId, 'failed', undefined, err.message);
        logger.error({ eventId: job.data.eventId, attempts: job.attemptsMade }, 'Outbound job permanently failed');
      }
    });

    this.inboundWorker.on('failed', async (job: Job<InboundJobData> | undefined, err: Error) => {
      if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
        await eventLog.updateStatus(job.data.eventId, 'failed', undefined, err.message);
        logger.error({ eventId: job.data.eventId, attempts: job.attemptsMade }, 'Inbound job permanently failed');
      }
    });
  }

  /**
   * Enqueues an outbound TikTok event job.
   */
  async enqueueOutbound(
    payload: TikTokEventsPayload,
    advertiserId: string,
    eventId: string
  ): Promise<void> {
    await this.outboundQueue.add(
      'send-tiktok-event',
      { payload, advertiserId, eventId },
      { jobId: eventId }
    );
    logger.debug({ eventId, advertiserId }, 'Enqueued outbound TikTok event');
  }

  /**
   * Enqueues an inbound Klaviyo event job.
   */
  async enqueueInbound(payload: KlaviyoEventPayload, eventId: string): Promise<void> {
    await this.inboundQueue.add('send-klaviyo-event', { payload, eventId }, { jobId: eventId });
    logger.debug({ eventId }, 'Enqueued inbound Klaviyo event');
  }

  /**
   * Returns queue metrics for monitoring.
   */
  async getMetrics(): Promise<{ outbound: QueueMetrics; inbound: QueueMetrics }> {
    const [
      outboundWaiting,
      outboundActive,
      outboundCompleted,
      outboundFailed,
      outboundDelayed,
      inboundWaiting,
      inboundActive,
      inboundCompleted,
      inboundFailed,
      inboundDelayed,
    ] = await Promise.all([
      this.outboundQueue.getWaitingCount(),
      this.outboundQueue.getActiveCount(),
      this.outboundQueue.getCompletedCount(),
      this.outboundQueue.getFailedCount(),
      this.outboundQueue.getDelayedCount(),
      this.inboundQueue.getWaitingCount(),
      this.inboundQueue.getActiveCount(),
      this.inboundQueue.getCompletedCount(),
      this.inboundQueue.getFailedCount(),
      this.inboundQueue.getDelayedCount(),
    ]);

    return {
      outbound: {
        waiting: outboundWaiting,
        active: outboundActive,
        completed: outboundCompleted,
        failed: outboundFailed,
        delayed: outboundDelayed,
      },
      inbound: {
        waiting: inboundWaiting,
        active: inboundActive,
        completed: inboundCompleted,
        failed: inboundFailed,
        delayed: inboundDelayed,
      },
    };
  }

  /**
   * Gracefully shuts down queues and workers.
   */
  async close(): Promise<void> {
    await Promise.all([
      this.outboundWorker?.close(),
      this.inboundWorker?.close(),
      this.outboundQueue.close(),
      this.inboundQueue.close(),
    ]);
    logger.info('RetryQueue closed');
  }
}
