import { v4 as uuidv4 } from 'uuid';
import { TikTokLeadWebhookPayload, CanonicalCRMEvent } from './types';
import { enrichFromTikTokLead } from './enrichment/identity-enrichment';
import { buildKlaviyoEvent } from './transformer/klaviyo-event-builder';
import { RedisDeduplicator } from './deduplication/redis-dedup';
import { EventLog } from './db/event-log';
import { KlaviyoAPIClient } from './clients/klaviyo-api-client';
import { RetryQueue } from './queue/retry-queue';
import { logger } from './logging/logger';

export class InboundPipeline {
  private readonly klaviyoClient: KlaviyoAPIClient;
  private readonly deduplicator: RedisDeduplicator;
  private readonly eventLog: EventLog;
  private readonly retryQueue: RetryQueue;

  constructor(
    klaviyoClient: KlaviyoAPIClient,
    deduplicator: RedisDeduplicator,
    eventLog: EventLog,
    retryQueue: RetryQueue
  ) {
    this.klaviyoClient = klaviyoClient;
    this.deduplicator = deduplicator;
    this.eventLog = eventLog;
    this.retryQueue = retryQueue;
  }

  /**
   * Processes a TikTok Lead Gen webhook payload.
   * Direction: TikTok Lead Ad → Klaviyo
   */
  async process(payload: TikTokLeadWebhookPayload): Promise<void> {
    try {
      // Step 1: Enrich user data from TikTok lead fields
      const user = enrichFromTikTokLead(payload);

      // Step 2: Generate event ID (UUID for inbound)
      const eventId = uuidv4();

      // Step 3: Build canonical event
      const canonicalEvent: CanonicalCRMEvent = {
        event_id: eventId,
        event_name: 'Lead Created',
        event_time: payload.create_time,
        lead_id: payload.lead_id,
        advertiser_id: payload.advertiser_id,
        campaign_id: payload.campaign_id,
        ad_id: payload.ad_id,
        user,
        direction: 'inbound',
      };

      // Step 4: Deduplication check using lead_id
      const dedupKey = `inbound:dedup:${payload.lead_id}`;
      const isDuplicate = await this.deduplicator.isDuplicate(dedupKey);

      if (isDuplicate) {
        logger.info({ lead_id: payload.lead_id }, 'Inbound pipeline: duplicate lead, skipping');
        return;
      }

      // Step 5: Build Klaviyo event payload
      const klaviyoPayload = buildKlaviyoEvent(canonicalEvent);

      // Step 6: Upsert Klaviyo profile first
      const profileAttributes = klaviyoPayload.data.attributes.profile.data.attributes;
      try {
        await this.klaviyoClient.upsertProfile(profileAttributes);
      } catch (err) {
        logger.warn({ err, lead_id: payload.lead_id }, 'Failed to upsert Klaviyo profile, continuing with event creation');
      }

      // Step 7: Insert event log with pending status
      await this.eventLog.insert({
        event_id: eventId,
        event_name: 'Lead Created',
        lead_id: payload.lead_id,
        direction: 'inbound',
        source_payload: payload as unknown as Record<string, unknown>,
        destination_payload: klaviyoPayload as unknown as Record<string, unknown>,
        status: 'pending',
        attempt_count: 0,
      });

      // Step 8: Send event to Klaviyo
      try {
        await this.klaviyoClient.createEvent(klaviyoPayload);
        await this.eventLog.updateStatus(eventId, 'sent');
        logger.info(
          { event_id: eventId, lead_id: payload.lead_id },
          'Inbound pipeline: Lead Created event sent to Klaviyo'
        );
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error(
          { err, event_id: eventId, lead_id: payload.lead_id },
          'Inbound pipeline: Klaviyo event creation failed, enqueueing for retry'
        );
        await this.eventLog.updateStatus(eventId, 'failed', undefined, error);
        await this.retryQueue.enqueueInbound(klaviyoPayload, eventId);
      }
    } catch (err) {
      logger.error(
        { err, lead_id: payload.lead_id },
        'Inbound pipeline: unhandled error'
      );
    }
  }
}
