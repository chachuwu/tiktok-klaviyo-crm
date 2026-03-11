import type { Redis } from 'ioredis';
import { logger } from '../logging/logger';

export class RedisDeduplicator {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;

  constructor(redis: Redis, ttlSeconds: number) {
    this.redis = redis;
    this.ttlSeconds = ttlSeconds;
  }

  /**
   * Checks if an event ID has already been processed.
   * Uses Redis SET NX (set if not exists) with TTL.
   * Returns true if the event is a duplicate (already exists).
   * Returns false if the event is new (was just set).
   * Fail-open: returns false if Redis throws.
   */
  async isDuplicate(eventId: string): Promise<boolean> {
    try {
      const key = `dedup:${eventId}`;
      // SET key "1" EX ttl NX — returns "OK" if set, null if already exists
      const result = await this.redis.set(key, '1', 'EX', this.ttlSeconds, 'NX');

      if (result === null) {
        // Key already exists — duplicate
        return true;
      }

      // Key was set — new event
      return false;
    } catch (err) {
      logger.warn({ err, eventId }, 'Redis deduplication failed — failing open (processing event)');
      return false;
    }
  }
}
