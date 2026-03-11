import { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { StoredToken, ActiveToken } from '../types';
import { logger } from '../logging/logger';

const REDIS_TOKEN_PREFIX = 'tiktok:token:';
const REDIS_TOKEN_TTL_SECONDS = 23 * 60 * 60; // 23 hours

export class TokenStore {
  private readonly pool: Pool;
  private readonly redis: Redis;

  constructor(pool: Pool, redis: Redis) {
    this.pool = pool;
    this.redis = redis;
  }

  /**
   * Saves a token to both Postgres (persistent) and Redis (cache).
   */
  async save(token: StoredToken): Promise<void> {
    // Save to Postgres
    await this.pool.query(
      `INSERT INTO tiktok_oauth_tokens (
        id, advertiser_id, access_token, refresh_token,
        access_token_expires_at, refresh_token_expires_at,
        scope, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (advertiser_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        access_token_expires_at = EXCLUDED.access_token_expires_at,
        refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
        scope = EXCLUDED.scope,
        updated_at = NOW()`,
      [
        token.id,
        token.advertiser_id,
        token.access_token,
        token.refresh_token,
        token.access_token_expires_at,
        token.refresh_token_expires_at,
        token.scope,
        token.created_at,
        token.updated_at,
      ]
    );

    // Cache in Redis with 23h TTL
    const redisKey = `${REDIS_TOKEN_PREFIX}${token.advertiser_id}`;
    await this.redis.set(redisKey, JSON.stringify(token), 'EX', REDIS_TOKEN_TTL_SECONDS);

    logger.debug({ advertiser_id: token.advertiser_id }, 'Token saved to store');
  }

  /**
   * Retrieves a token: checks Redis first, falls back to Postgres.
   */
  async get(advertiserId: string): Promise<StoredToken | null> {
    // Try Redis first
    try {
      const redisKey = `${REDIS_TOKEN_PREFIX}${advertiserId}`;
      const cached = await this.redis.get(redisKey);
      if (cached) {
        const token = JSON.parse(cached) as StoredToken;
        // Convert date strings back to Date objects
        token.access_token_expires_at = new Date(token.access_token_expires_at);
        token.refresh_token_expires_at = new Date(token.refresh_token_expires_at);
        token.created_at = new Date(token.created_at);
        token.updated_at = new Date(token.updated_at);
        return token;
      }
    } catch (err) {
      logger.warn({ err, advertiserId }, 'Redis token lookup failed, falling back to Postgres');
    }

    // Fallback to Postgres
    const result = await this.pool.query<StoredToken>(
      'SELECT * FROM tiktok_oauth_tokens WHERE advertiser_id = $1',
      [advertiserId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const token = result.rows[0];

    // Repopulate Redis cache
    try {
      const redisKey = `${REDIS_TOKEN_PREFIX}${advertiserId}`;
      await this.redis.set(redisKey, JSON.stringify(token), 'EX', REDIS_TOKEN_TTL_SECONDS);
    } catch (err) {
      logger.warn({ err }, 'Failed to repopulate Redis token cache');
    }

    return token;
  }

  /**
   * Returns all stored tokens from Postgres.
   */
  async getAll(): Promise<StoredToken[]> {
    const result = await this.pool.query<StoredToken>(
      'SELECT * FROM tiktok_oauth_tokens ORDER BY created_at ASC'
    );
    return result.rows;
  }

  /**
   * Deletes a token from both Redis and Postgres.
   */
  async delete(advertiserId: string): Promise<void> {
    // Delete from Redis
    try {
      const redisKey = `${REDIS_TOKEN_PREFIX}${advertiserId}`;
      await this.redis.del(redisKey);
    } catch (err) {
      logger.warn({ err, advertiserId }, 'Failed to delete token from Redis');
    }

    // Delete from Postgres
    await this.pool.query('DELETE FROM tiktok_oauth_tokens WHERE advertiser_id = $1', [
      advertiserId,
    ]);

    logger.info({ advertiserId }, 'Token deleted from store');
  }

  /**
   * Retrieves a valid (non-expired) access token for the given advertiser.
   * Returns ActiveToken or throws if not found or expired.
   */
  async getActiveToken(advertiserId: string): Promise<ActiveToken> {
    const token = await this.get(advertiserId);

    if (!token) {
      throw new Error(`No token found for advertiser: ${advertiserId}`);
    }

    const now = new Date();
    if (token.access_token_expires_at <= now) {
      throw new Error(`Access token expired for advertiser: ${advertiserId}`);
    }

    return {
      access_token: token.access_token,
      advertiser_id: token.advertiser_id,
      expires_at: token.access_token_expires_at,
    };
  }
}
