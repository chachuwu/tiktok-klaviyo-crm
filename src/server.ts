import express from 'express';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { env } from './config/env';
import { logger } from './logging/logger';
import { migrate } from './db/migrate';
import { EventLog } from './db/event-log';
import { RedisDeduplicator } from './deduplication/redis-dedup';
import { KlaviyoAPIClient } from './clients/klaviyo-api-client';
import { TikTokAPIClient } from './clients/tiktok-api-client';
import { TokenStore } from './tiktok-auth/token-store';
import { TikTokOAuthClient } from './tiktok-auth/tiktok-oauth';
import { ProactiveTokenRefresher } from './tiktok-auth/proactive-refresher';
import { CRMEventSetManager } from './event-set/crm-event-set-manager';
import { RetryQueue } from './queue/retry-queue';
import { InboundPipeline } from './inbound-pipeline';
import { OutboundPipeline } from './outbound-pipeline';
import { createOAuthRouter } from './tiktok-auth/oauth-routes';
import { createEventSetRouter } from './event-set/event-set-routes';
import { createTikTokLeadWebhookRouter } from './listeners/tiktok-lead-webhook';
import { createKlaviyoWebhookRouter } from './listeners/klaviyo-webhook';

async function bootstrap(): Promise<void> {
  // ----------------------------------------------------------------
  // Initialize clients
  // ----------------------------------------------------------------
  const pool = new Pool({ connectionString: env.POSTGRES_URL });

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    lazyConnect: true,
  });

  await redis.connect();
  logger.info('Redis connected');

  // Run database migrations
  await migrate(pool);
  logger.info('Database migrations completed');

  // ----------------------------------------------------------------
  // Initialize service layer
  // ----------------------------------------------------------------
  const eventLog = new EventLog(pool);
  const deduplicator = new RedisDeduplicator(redis, env.REDIS_DEDUP_TTL_SECONDS);

  const klaviyoClient = new KlaviyoAPIClient(env.KLAVIYO_PRIVATE_API_KEY, env.KLAVIYO_API_BASE_URL);

  const tokenStore = new TokenStore(pool, redis);

  const oauthClient = new TikTokOAuthClient(
    {
      appId: env.TIKTOK_APP_ID,
      appSecret: env.TIKTOK_APP_SECRET,
      redirectUri: env.TIKTOK_REDIRECT_URI,
      apiBaseUrl: env.TIKTOK_API_BASE_URL,
    },
    async (advertiserId: string) => tokenStore.getActiveToken(advertiserId)
  );

  const tiktokClient = new TikTokAPIClient(
    async (advertiserId: string) => tokenStore.getActiveToken(advertiserId),
    {
      apiBaseUrl: env.TIKTOK_API_BASE_URL,
      apiVersion: env.TIKTOK_API_VERSION,
      maxRetries: env.TIKTOK_MAX_RETRIES,
      initialRetryDelayMs: env.TIKTOK_INITIAL_RETRY_DELAY_MS,
      rateLimitRps: env.TIKTOK_RATE_LIMIT_RPS,
      batchSize: env.TIKTOK_BATCH_SIZE,
    }
  );

  const eventSetManager = new CRMEventSetManager(
    pool,
    redis,
    env.TIKTOK_API_BASE_URL,
    env.TIKTOK_API_VERSION,
    env.TIKTOK_CRM_EVENT_SET_ID
  );

  const retryQueue = new RetryQueue(
    redis,
    tiktokClient,
    klaviyoClient,
    eventLog,
    env.TIKTOK_RATE_LIMIT_RPS
  );

  const inboundPipeline = new InboundPipeline(klaviyoClient, deduplicator, eventLog, retryQueue);
  const outboundPipeline = new OutboundPipeline(
    tiktokClient,
    deduplicator,
    eventLog,
    retryQueue,
    eventSetManager,
    env.TIKTOK_DEFAULT_ADVERTISER_ID
  );

  // Start proactive token refresher
  const tokenRefresher = new ProactiveTokenRefresher(tokenStore, oauthClient);
  tokenRefresher.start();

  // ----------------------------------------------------------------
  // Express app
  // ----------------------------------------------------------------
  const app = express();

  // Global middleware
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ----------------------------------------------------------------
  // Routes
  // ----------------------------------------------------------------

  // Health check
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'tiktok-klaviyo-crm',
      version: env.INTEGRATION_VERSION,
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness check
  app.get('/ready', (_req, res) => {
    res.json({ status: 'ready' });
  });

  // Queue metrics
  app.get('/metrics/queue', async (_req, res) => {
    try {
      const metrics = await retryQueue.getMetrics();
      res.json(metrics);
    } catch (err) {
      logger.error({ err }, 'Failed to get queue metrics');
      res.status(500).json({ error: 'Failed to get queue metrics' });
    }
  });

  // TikTok Lead webhook (raw body for signature verification)
  app.use(
    '/webhooks/tiktok/leads',
    createTikTokLeadWebhookRouter(inboundPipeline, env.TIKTOK_LEAD_WEBHOOK_SECRET)
  );

  // Klaviyo webhook (raw body middleware is applied inside the router)
  app.use(
    '/webhooks/klaviyo/events',
    createKlaviyoWebhookRouter(outboundPipeline, env.KLAVIYO_WEBHOOK_SECRET)
  );

  // OAuth routes
  app.use('/auth', createOAuthRouter(oauthClient, tokenStore, redis));

  // Event set routes
  app.use('/event-sets', createEventSetRouter(eventSetManager, tokenStore));

  // ----------------------------------------------------------------
  // Start server
  // ----------------------------------------------------------------
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Server started');
  });

  // ----------------------------------------------------------------
  // Graceful shutdown
  // ----------------------------------------------------------------
  async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, 'Received shutdown signal, shutting down gracefully');

    tokenRefresher.stop();

    await retryQueue.close();
    await redis.quit();
    await pool.end();

    server.close(() => {
      logger.info('HTTP server closed');
      process.exit(0);
    });

    // Force exit if graceful shutdown takes too long
    setTimeout(() => {
      logger.error('Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 10000);
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
