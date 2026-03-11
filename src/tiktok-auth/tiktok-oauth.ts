import axios from 'axios';
import { ActiveToken } from '../types';
import { logger } from '../logging/logger';

export interface TokenExchangeResponse {
  access_token: string;
  refresh_token: string;
  access_token_expires_in: number;
  refresh_token_expires_in: number;
  advertiser_ids: string[];
  scope: string;
}

export interface TikTokOAuthConfig {
  appId: string;
  appSecret: string;
  redirectUri: string;
  apiBaseUrl: string;
}

export class TikTokOAuthClient {
  private readonly config: TikTokOAuthConfig;
  private readonly getValidTokenFn?: (advertiserId: string) => Promise<ActiveToken>;

  constructor(
    config: TikTokOAuthConfig,
    getValidTokenFn?: (advertiserId: string) => Promise<ActiveToken>
  ) {
    this.config = config;
    this.getValidTokenFn = getValidTokenFn;
  }

  /**
   * Builds the TikTok OAuth authorization URL.
   */
  buildAuthUrl(state: string): string {
    const params = new URLSearchParams({
      app_id: this.config.appId,
      redirect_uri: this.config.redirectUri,
      state,
      scope: 'crm_event.write,campaign.read',
      response_type: 'code',
    });

    return `https://business-api.tiktok.com/portal/auth?${params.toString()}`;
  }

  /**
   * Exchanges an authorization code for access and refresh tokens.
   */
  async exchangeCode(code: string): Promise<TokenExchangeResponse> {
    const url = `${this.config.apiBaseUrl}/open_api/v1.3/oauth2/access_token/`;

    const response = await axios.post(
      url,
      {
        app_id: this.config.appId,
        secret: this.config.appSecret,
        auth_code: code,
        grant_type: 'authorization_code',
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const { data } = response;
    if (data.code !== 0) {
      throw new Error(`TikTok OAuth exchange failed: ${data.message} (code: ${data.code})`);
    }

    logger.info(
      { advertiser_ids: data.data.advertiser_ids },
      'TikTok OAuth code exchange successful'
    );

    return {
      access_token: data.data.access_token,
      refresh_token: data.data.refresh_token,
      access_token_expires_in: data.data.access_token_expires_in,
      refresh_token_expires_in: data.data.refresh_token_expires_in,
      advertiser_ids: data.data.advertiser_ids ?? [],
      scope: data.data.scope ?? '',
    };
  }

  /**
   * Refreshes an access token using a refresh token.
   */
  async refreshToken(refreshToken: string): Promise<TokenExchangeResponse> {
    const url = `${this.config.apiBaseUrl}/open_api/v1.3/oauth2/refresh_token/`;

    const response = await axios.post(
      url,
      {
        app_id: this.config.appId,
        secret: this.config.appSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      },
      {
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const { data } = response;
    if (data.code !== 0) {
      throw new Error(`TikTok token refresh failed: ${data.message} (code: ${data.code})`);
    }

    logger.info('TikTok OAuth token refresh successful');

    return {
      access_token: data.data.access_token,
      refresh_token: data.data.refresh_token,
      access_token_expires_in: data.data.access_token_expires_in,
      refresh_token_expires_in: data.data.refresh_token_expires_in,
      advertiser_ids: data.data.advertiser_ids ?? [],
      scope: data.data.scope ?? '',
    };
  }

  /**
   * Retrieves a valid token for the given advertiser ID.
   * Delegates to the provided token resolution function.
   */
  async getValidToken(advertiserId: string): Promise<ActiveToken> {
    if (!this.getValidTokenFn) {
      throw new Error('No token resolution function provided');
    }
    return this.getValidTokenFn(advertiserId);
  }
}
