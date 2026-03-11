import { v4 as uuidv4 } from 'uuid';
import { TokenStore } from './token-store';
import { TikTokOAuthClient } from './tiktok-oauth';
import { StoredToken } from '../types';
import { logger } from '../logging/logger';

const CHECK_INTERVAL_MS = 23 * 60 * 60 * 1000; // 23 hours
const EXPIRY_BUFFER_MS = 60 * 60 * 1000; // 1 hour

export class ProactiveTokenRefresher {
  private readonly tokenStore: TokenStore;
  private readonly oauthClient: TikTokOAuthClient;
  private intervalHandle?: ReturnType<typeof setInterval>;

  constructor(tokenStore: TokenStore, oauthClient: TikTokOAuthClient) {
    this.tokenStore = tokenStore;
    this.oauthClient = oauthClient;
  }

  /**
   * Starts the proactive refresh loop.
   * Runs immediately on start, then every 23 hours.
   */
  start(): void {
    logger.info('ProactiveTokenRefresher started');

    // Run immediately
    void this.refreshExpiringTokens();

    // Then run every 23 hours
    this.intervalHandle = setInterval(() => {
      void this.refreshExpiringTokens();
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Stops the proactive refresh loop.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
      logger.info('ProactiveTokenRefresher stopped');
    }
  }

  /**
   * Checks all stored tokens and refreshes any expiring within 1 hour.
   */
  private async refreshExpiringTokens(): Promise<void> {
    try {
      const tokens = await this.tokenStore.getAll();
      const now = new Date();
      const expiryThreshold = new Date(now.getTime() + EXPIRY_BUFFER_MS);

      logger.debug({ token_count: tokens.length }, 'Checking tokens for proactive refresh');

      for (const token of tokens) {
        if (token.access_token_expires_at <= expiryThreshold) {
          await this.refreshToken(token);
        }
      }
    } catch (err) {
      logger.error({ err }, 'ProactiveTokenRefresher: error checking tokens');
    }
  }

  /**
   * Refreshes a single token and saves it back to the store.
   */
  private async refreshToken(token: StoredToken): Promise<void> {
    try {
      logger.info(
        { advertiser_id: token.advertiser_id },
        'ProactiveTokenRefresher: refreshing token'
      );

      const refreshed = await this.oauthClient.refreshToken(token.refresh_token);

      const now = new Date();
      const updatedToken: StoredToken = {
        id: token.id || uuidv4(),
        advertiser_id: token.advertiser_id,
        access_token: refreshed.access_token,
        refresh_token: refreshed.refresh_token,
        access_token_expires_at: new Date(
          now.getTime() + refreshed.access_token_expires_in * 1000
        ),
        refresh_token_expires_at: new Date(
          now.getTime() + refreshed.refresh_token_expires_in * 1000
        ),
        scope: refreshed.scope,
        created_at: token.created_at,
        updated_at: now,
      };

      await this.tokenStore.save(updatedToken);

      logger.info(
        { advertiser_id: token.advertiser_id },
        'ProactiveTokenRefresher: token refreshed successfully'
      );
    } catch (err) {
      logger.error(
        { err, advertiser_id: token.advertiser_id },
        'ProactiveTokenRefresher: failed to refresh token'
      );
    }
  }
}
