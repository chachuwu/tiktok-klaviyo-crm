import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import type { Redis } from 'ioredis';
import { TikTokOAuthClient } from './tiktok-oauth';
import { TokenStore } from './token-store';
import { StoredToken } from '../types';
import { logger } from '../logging/logger';

const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 minutes
const OAUTH_STATE_PREFIX = 'oauth:state:';

export function createOAuthRouter(
  oauthClient: TikTokOAuthClient,
  tokenStore: TokenStore,
  redis: Redis
): Router {
  const router = Router();

  /**
   * GET /auth/tiktok
   * Initiates the TikTok OAuth flow by redirecting to TikTok's authorization page.
   */
  router.get('/tiktok', async (_req: Request, res: Response) => {
    try {
      const csrfToken = uuidv4();
      const stateKey = `${OAUTH_STATE_PREFIX}${csrfToken}`;

      // Store CSRF state in Redis with 10-minute TTL
      await redis.set(
        stateKey,
        JSON.stringify({ csrf_token: csrfToken, created_at: Date.now() }),
        'EX',
        OAUTH_STATE_TTL_SECONDS
      );

      const authUrl = oauthClient.buildAuthUrl(csrfToken);
      logger.info({ csrf_token: csrfToken }, 'Initiating TikTok OAuth flow');

      res.redirect(authUrl);
    } catch (err) {
      logger.error({ err }, 'Failed to initiate TikTok OAuth');
      res.status(500).json({ error: 'Failed to initiate OAuth flow' });
    }
  });

  /**
   * GET /auth/tiktok/callback
   * Handles the OAuth callback from TikTok.
   */
  router.get('/tiktok/callback', async (req: Request, res: Response) => {
    try {
      const { code, state, error, error_description } = req.query as Record<string, string>;

      if (error) {
        logger.error({ error, error_description }, 'TikTok OAuth callback error');
        return res.status(400).json({ error, error_description });
      }

      if (!code || !state) {
        return res.status(400).json({ error: 'Missing code or state parameter' });
      }

      // Verify CSRF state
      const stateKey = `${OAUTH_STATE_PREFIX}${state}`;
      const storedState = await redis.get(stateKey);

      if (!storedState) {
        logger.warn({ state }, 'Invalid or expired OAuth state');
        return res.status(400).json({ error: 'Invalid or expired state parameter' });
      }

      // Delete state from Redis (one-time use)
      await redis.del(stateKey);

      // Exchange code for tokens
      const tokenResponse = await oauthClient.exchangeCode(code);
      const now = new Date();

      // Save tokens for each advertiser
      for (const advertiserId of tokenResponse.advertiser_ids) {
        const storedToken: StoredToken = {
          id: uuidv4(),
          advertiser_id: advertiserId,
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token,
          access_token_expires_at: new Date(
            now.getTime() + tokenResponse.access_token_expires_in * 1000
          ),
          refresh_token_expires_at: new Date(
            now.getTime() + tokenResponse.refresh_token_expires_in * 1000
          ),
          scope: tokenResponse.scope,
          created_at: now,
          updated_at: now,
        };

        await tokenStore.save(storedToken);
        logger.info({ advertiserId }, 'OAuth token saved for advertiser');
      }

      return res.json({
        success: true,
        advertiser_ids: tokenResponse.advertiser_ids,
        message: `Successfully authorized ${tokenResponse.advertiser_ids.length} advertiser(s)`,
      });
    } catch (err) {
      logger.error({ err }, 'OAuth callback processing failed');
      return res.status(500).json({ error: 'OAuth callback processing failed' });
    }
  });

  /**
   * GET /auth/tiktok/status
   * Returns a list of authorized advertiser IDs.
   */
  router.get('/tiktok/status', async (_req: Request, res: Response) => {
    try {
      const tokens = await tokenStore.getAll();
      const advertisers = tokens.map((t) => ({
        advertiser_id: t.advertiser_id,
        access_token_expires_at: t.access_token_expires_at,
        refresh_token_expires_at: t.refresh_token_expires_at,
        scope: t.scope,
        is_access_token_valid: t.access_token_expires_at > new Date(),
      }));

      res.json({ authorized_advertisers: advertisers, count: advertisers.length });
    } catch (err) {
      logger.error({ err }, 'Failed to get OAuth status');
      res.status(500).json({ error: 'Failed to retrieve authorization status' });
    }
  });

  /**
   * POST /auth/tiktok/refresh/:advertiserId
   * Manually refreshes the token for a specific advertiser.
   */
  router.post('/tiktok/refresh/:advertiserId', async (req: Request, res: Response) => {
    try {
      const { advertiserId } = req.params;
      const token = await tokenStore.get(advertiserId);

      if (!token) {
        return res.status(404).json({ error: `No token found for advertiser: ${advertiserId}` });
      }

      const refreshed = await oauthClient.refreshToken(token.refresh_token);
      const now = new Date();

      const updatedToken: StoredToken = {
        ...token,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        access_token_expires_at: new Date(
          now.getTime() + refreshed.access_token_expires_in * 1000
        ),
        refresh_token_expires_at: new Date(
          now.getTime() + refreshed.refresh_token_expires_in * 1000
        ),
        scope: refreshed.scope,
        updated_at: now,
      };

      await tokenStore.save(updatedToken);

      logger.info({ advertiserId }, 'Token manually refreshed');
      return res.json({
        success: true,
        advertiser_id: advertiserId,
        access_token_expires_at: updatedToken.access_token_expires_at,
      });
    } catch (err) {
      logger.error({ err, advertiserId: req.params['advertiserId'] }, 'Manual token refresh failed');
      return res.status(500).json({ error: 'Token refresh failed' });
    }
  });

  /**
   * POST /auth/tiktok/revoke/:advertiserId
   * Revokes and deletes the token for a specific advertiser.
   */
  router.post('/tiktok/revoke/:advertiserId', async (req: Request, res: Response) => {
    try {
      const { advertiserId } = req.params;
      await tokenStore.delete(advertiserId);

      logger.info({ advertiserId }, 'Token revoked');
      res.json({ success: true, advertiser_id: advertiserId, message: 'Token revoked' });
    } catch (err) {
      logger.error({ err, advertiserId: req.params['advertiserId'] }, 'Token revocation failed');
      res.status(500).json({ error: 'Token revocation failed' });
    }
  });

  return router;
}
