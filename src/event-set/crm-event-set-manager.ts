import axios from 'axios';
import { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { CRMEventSet, AdvertiserEventSet, ProvisionResult } from './types';
import { logger } from '../logging/logger';

const EVENT_SET_CACHE_TTL = 60 * 60; // 1 hour in seconds
const EVENT_SET_CACHE_PREFIX = 'event_set:';

export class CRMEventSetManager {
  private readonly pool: Pool;
  private readonly redis: Redis;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly envEventSetId?: string;

  constructor(
    pool: Pool,
    redis: Redis,
    apiBaseUrl: string,
    apiVersion: string,
    envEventSetId?: string
  ) {
    this.pool = pool;
    this.redis = redis;
    this.apiBaseUrl = apiBaseUrl;
    this.apiVersion = apiVersion;
    this.envEventSetId = envEventSetId;
  }

  /**
   * Lists all CRM event sets for an advertiser.
   */
  async list(advertiserId: string, accessToken: string): Promise<CRMEventSet[]> {
    const url = `${this.apiBaseUrl}/open_api/${this.apiVersion}/crm/event_set/list/`;

    const response = await axios.get(url, {
      headers: { 'Access-Token': accessToken },
      params: { advertiser_id: advertiserId },
    });

    if (response.data.code !== 0) {
      throw new Error(
        `TikTok list event sets failed: ${response.data.message} (code: ${response.data.code})`
      );
    }

    const sets: CRMEventSet[] = (response.data.data?.list ?? []).map(
      (s: Record<string, unknown>) => ({
        event_set_id: s['event_set_id'] as string,
        name: s['name'] as string,
        advertiser_id: advertiserId,
        create_time: s['create_time'] as number | undefined,
        update_time: s['update_time'] as number | undefined,
        event_count: s['event_count'] as number | undefined,
      })
    );

    return sets;
  }

  /**
   * Creates a new CRM event set for an advertiser.
   */
  async create(advertiserId: string, accessToken: string, name: string): Promise<CRMEventSet> {
    const url = `${this.apiBaseUrl}/open_api/${this.apiVersion}/crm/event_set/create/`;

    const response = await axios.post(
      url,
      { advertiser_id: advertiserId, name },
      { headers: { 'Access-Token': accessToken, 'Content-Type': 'application/json' } }
    );

    if (response.data.code !== 0) {
      throw new Error(
        `TikTok create event set failed: ${response.data.message} (code: ${response.data.code})`
      );
    }

    const created: CRMEventSet = {
      event_set_id: response.data.data.event_set_id,
      name,
      advertiser_id: advertiserId,
    };

    logger.info({ advertiserId, event_set_id: created.event_set_id }, 'CRM event set created');
    return created;
  }

  /**
   * Provisions an event set for an advertiser.
   * - If none exist: creates one
   * - If one exists: selects it
   * - If multiple exist: returns multiple_found (manual selection required)
   */
  async provision(advertiserId: string, accessToken: string): Promise<ProvisionResult> {
    try {
      const existing = await this.list(advertiserId, accessToken);

      if (existing.length === 0) {
        // Create a new event set
        const name = `CRM Integration - ${advertiserId}`;
        const created = await this.create(advertiserId, accessToken, name);
        const record = await this.saveToDb(advertiserId, created.event_set_id, name, 'auto_created');

        return { status: 'created_new', data: record };
      }

      if (existing.length === 1) {
        // Use the only existing event set
        const eventSet = existing[0];
        const record = await this.saveToDb(
          advertiserId,
          eventSet.event_set_id,
          eventSet.name,
          'auto_selected'
        );

        return { status: 'selected_existing', data: record };
      }

      // Multiple event sets — return them for manual selection
      return { status: 'multiple_found', data: existing };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ err, advertiserId }, 'Failed to provision event set');
      return { status: 'error', error };
    }
  }

  /**
   * Resolves the event set ID for an advertiser.
   * Checks Redis cache → Postgres → env fallback.
   * Returns null if none found.
   */
  async resolve(advertiserId: string): Promise<string | null> {
    // Check Redis cache
    try {
      const cacheKey = `${EVENT_SET_CACHE_PREFIX}${advertiserId}`;
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (err) {
      logger.warn({ err, advertiserId }, 'Redis event set cache lookup failed');
    }

    // Check Postgres
    try {
      const result = await this.pool.query<{ event_set_id: string }>(
        'SELECT event_set_id FROM advertiser_event_sets WHERE advertiser_id = $1',
        [advertiserId]
      );

      if (result.rows.length > 0) {
        const eventSetId = result.rows[0].event_set_id;

        // Repopulate cache
        try {
          const cacheKey = `${EVENT_SET_CACHE_PREFIX}${advertiserId}`;
          await this.redis.set(cacheKey, eventSetId, 'EX', EVENT_SET_CACHE_TTL);
        } catch (err) {
          logger.warn({ err }, 'Failed to repopulate event set cache');
        }

        return eventSetId;
      }
    } catch (err) {
      logger.warn({ err, advertiserId }, 'Postgres event set lookup failed');
    }

    // Env fallback
    if (this.envEventSetId) {
      return this.envEventSetId;
    }

    return null;
  }

  /**
   * Manually selects an event set for an advertiser.
   */
  async select(
    advertiserId: string,
    eventSetId: string,
    eventSetName: string
  ): Promise<AdvertiserEventSet> {
    const record = await this.saveToDb(advertiserId, eventSetId, eventSetName, 'manually_selected');

    // Invalidate cache
    try {
      const cacheKey = `${EVENT_SET_CACHE_PREFIX}${advertiserId}`;
      await this.redis.del(cacheKey);
    } catch (err) {
      logger.warn({ err }, 'Failed to invalidate event set cache');
    }

    return record;
  }

  private async saveToDb(
    advertiserId: string,
    eventSetId: string,
    eventSetName: string,
    source: AdvertiserEventSet['source']
  ): Promise<AdvertiserEventSet> {
    const now = new Date();

    await this.pool.query(
      `INSERT INTO advertiser_event_sets (advertiser_id, event_set_id, event_set_name, source, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (advertiser_id) DO UPDATE SET
         event_set_id = EXCLUDED.event_set_id,
         event_set_name = EXCLUDED.event_set_name,
         source = EXCLUDED.source,
         updated_at = NOW()`,
      [advertiserId, eventSetId, eventSetName, source, now, now]
    );

    // Update cache
    try {
      const cacheKey = `${EVENT_SET_CACHE_PREFIX}${advertiserId}`;
      await this.redis.set(cacheKey, eventSetId, 'EX', EVENT_SET_CACHE_TTL);
    } catch (err) {
      logger.warn({ err }, 'Failed to update event set cache after save');
    }

    return {
      advertiser_id: advertiserId,
      event_set_id: eventSetId,
      event_set_name: eventSetName,
      source,
      created_at: now,
      updated_at: now,
    };
  }
}
