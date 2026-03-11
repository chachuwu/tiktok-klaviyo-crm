import { KlaviyoWebhookEvent, CanonicalCRMEvent } from './types';
import { filterOutboundEvent } from './filters/event-filter';
import { enrichFromKlaviyoProfile } from './enrichment/identity-enrichment';
import { buildTikTokPayload } from './transformer/tiktok-event-builder';
import { generateEventId } from './normalization/hasher';
import { RedisDeduplicator } from './deduplication/redis-dedup';
import { EventLog } from './db/event-log';
import { TikTokAPIClient } from './clients/tiktok-api-client';
import { CRMEventSetManager } from './event-set/crm-event-set-manager';
import { RetryQueue } from './queue/retry-queue';
import { logger } from './logging/logger';

export class OutboundPipeline {
  private readonly tiktokClient: TikTokAPIClient;
  private readonly deduplicator: RedisDeduplicator;
  private readonly eventLog: EventLog;
  private readonly retryQueue: RetryQueue;
  private readonly eventSetManager: CRMEventSetManager;
  private readonly defaultAdvertiserId?: string;

  constructor(
    tiktokClient: TikTokAPIClient,
    deduplicator: RedisDeduplicator,
    eventLog: EventLog,
    retryQueue: RetryQueue,
    eventSetManager: CRMEventSetManager,
    defaultAdvertiserId?: string
  ) {
    this.tiktokClient = tiktokClient;
    this.deduplicator = deduplicator;
    this.eventLog = eventLog;
    this.retryQueue = retryQueue;
    this.eventSetManager = eventSetManager;
    this.defaultAdvertiserId = defaultAdvertiserId;
  }

  /**
   * Processes a Klaviyo metric webhook event.
   * Direction: Klaviyo CRM → TikTok CRM Events API
   */
  async process(event: KlaviyoWebhookEvent): Promise<void> {
    try {
      const metricName = event.attributes.metric.name;

      // Step 1: Filter and map metric to TikTok event
      const filterResult = filterOutboundEvent(metricName);

      if (!filterResult.shouldProcess) {
        logger.debug(
          { metric: metricName, reason: filterResult.reason },
          'Outbound pipeline: event filtered out'
        );
        return;
      }

      const tiktokEvent = filterResult.tiktokEvent!;
      const dfoStage = filterResult.dfoStage;

      // Step 2: Enrich user data from Klaviyo profile
      const profileAttributes = event.attributes.profile.data.attributes;
      const user = enrichFromKlaviyoProfile(profileAttributes);

      // Step 3: Compute event time
      const eventTime = Math.floor(new Date(event.attributes.time).getTime() / 1000);

      // Step 4: Generate deterministic event ID
      const dedupKey = user.tiktok_lead_id ?? event.id;
      const eventId = generateEventId(dedupKey, tiktokEvent, eventTime);

      // Step 5: Deduplication check
      const isDuplicate = await this.deduplicator.isDuplicate(eventId);
      if (isDuplicate) {
        logger.info(
          { event_id: eventId, metric: metricName },
          'Outbound pipeline: duplicate event, skipping'
        );
        await this.eventLog.insert({
          event_id: eventId,
          event_name: tiktokEvent,
          direction: 'outbound',
          source_payload: event as unknown as Record<string, unknown>,
          destination_payload: {},
          status: 'duplicate',
          attempt_count: 0,
        });
        return;
      }

      // Step 6: Resolve advertiser ID
      const properties = event.attributes.properties as Record<string, unknown>;
      const advertiserId =
        (properties['advertiser_id'] as string | undefined) ??
        (properties['tiktok_advertiser_id'] as string | undefined) ??
        this.defaultAdvertiserId;

      if (!advertiserId) {
        logger.warn(
          { metric: metricName, event_id: eventId },
          'Outbound pipeline: no advertiser_id found in event or env, cannot send to TikTok'
        );
        return;
      }

      // Step 7: Resolve event set ID
      let eventSetId = await this.eventSetManager.resolve(advertiserId);
      if (!eventSetId) {
        logger.warn(
          { advertiserId, event_id: eventId },
          'Outbound pipeline: no event set ID resolved, cannot send to TikTok'
        );
        return;
      }

      // Build canonical event
      const canonicalEvent: CanonicalCRMEvent = {
        event_id: eventId,
        event_name: tiktokEvent,
        event_time: eventTime,
        advertiser_id: advertiserId,
        user,
        direction: 'outbound',
      };

      // Step 8: Build TikTok payload
      const tiktokPayload = buildTikTokPayload(canonicalEvent, tiktokEvent, eventSetId);

      // Step 9: Insert event log
      await this.eventLog.insert({
        event_id: eventId,
        event_name: tiktokEvent,
        direction: 'outbound',
        source_payload: event as unknown as Record<string, unknown>,
        destination_payload: tiktokPayload as unknown as Record<string, unknown>,
        status: 'pending',
        attempt_count: 0,
      });

      // Step 10: Send to TikTok
      try {
        const response = await this.tiktokClient.sendEvents(tiktokPayload, advertiserId);
        await this.eventLog.updateStatus(eventId, 'sent', response);
        logger.info(
          { event_id: eventId, tiktok_event: tiktokEvent, dfo_stage: dfoStage, advertiserId },
          'Outbound pipeline: event sent to TikTok CRM API'
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error(
          { err, event_id: eventId, tiktok_event: tiktokEvent },
          'Outbound pipeline: TikTok send failed, enqueueing for retry'
        );
        await this.eventLog.updateStatus(eventId, 'failed', undefined, error);
        await this.retryQueue.enqueueOutbound(tiktokPayload, advertiserId, eventId);
      }
    } catch (err) {
      logger.error(
        { err, event_id: event.id, metric: event.attributes.metric.name },
        'Outbound pipeline: unhandled error'
      );
    }
  }
}
