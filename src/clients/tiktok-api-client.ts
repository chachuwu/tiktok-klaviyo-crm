import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';
import { TikTokEventsPayload, TikTokAPIResponse, ActiveToken } from '../types';
import { logger } from '../logging/logger';

export interface TikTokAPIConfig {
  apiBaseUrl: string;
  apiVersion: string;
  maxRetries: number;
  initialRetryDelayMs: number;
  rateLimitRps: number;
  batchSize: number;
}

export class TikTokAPIClient {
  private readonly axiosInstance: AxiosInstance;
  private readonly limiter: Bottleneck;
  private readonly config: TikTokAPIConfig;
  private readonly getToken: (advertiserId: string) => Promise<ActiveToken>;

  constructor(
    getToken: (advertiserId: string) => Promise<ActiveToken>,
    config: TikTokAPIConfig
  ) {
    this.getToken = getToken;
    this.config = config;

    this.axiosInstance = axios.create({
      baseURL: config.apiBaseUrl,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });

    // Configure retry logic
    axiosRetry(this.axiosInstance, {
      retries: config.maxRetries,
      retryDelay: (retryCount: number) => {
        // Exponential backoff with jitter
        const base = config.initialRetryDelayMs * Math.pow(2, retryCount - 1);
        const jitter = Math.random() * base * 0.2;
        return Math.min(base + jitter, 30000);
      },
      retryCondition: (error) => {
        // Don't retry on client errors (4xx) — only server errors (5xx) and network issues
        if (error.response) {
          const status = error.response.status;
          // Skip retry for 400 Bad Request, 401 Unauthorized, 403 Forbidden
          if (status === 400 || status === 401 || status === 403) {
            return false;
          }
          // Retry on 5xx and 429
          return status >= 500 || status === 429;
        }
        // Retry on network errors
        return axiosRetry.isNetworkError(error);
      },
      onRetry: (retryCount, error) => {
        logger.warn(
          { retryCount, status: error.response?.status, message: error.message },
          'TikTok API request retry'
        );
      },
    });

    // Configure rate limiter
    this.limiter = new Bottleneck({
      maxConcurrent: config.rateLimitRps,
      minTime: Math.floor(1000 / config.rateLimitRps),
      reservoir: config.rateLimitRps,
      reservoirRefreshAmount: config.rateLimitRps,
      reservoirRefreshInterval: 1000,
    });
  }

  /**
   * Sends events to TikTok CRM Events API.
   */
  async sendEvents(
    payload: TikTokEventsPayload,
    advertiserId: string
  ): Promise<TikTokAPIResponse> {
    return this.limiter.schedule(async () => {
      const token = await this.getToken(advertiserId);
      const url = `/open_api/${this.config.apiVersion}/event/track/`;

      logger.debug(
        { advertiserId, event_count: payload.data.length, event_source_id: payload.event_source_id },
        'Sending events to TikTok CRM API'
      );

      const response = await this.axiosInstance.post<TikTokAPIResponse>(url, payload, {
        headers: { 'Access-Token': token.access_token },
      });

      const apiResponse = response.data;

      if (apiResponse.code !== 0) {
        const err = new Error(
          `TikTok API error: ${apiResponse.message} (code: ${apiResponse.code})`
        );
        logger.error(
          {
            code: apiResponse.code,
            message: apiResponse.message,
            request_id: apiResponse.request_id,
            advertiserId,
          },
          'TikTok API returned error code'
        );
        throw err;
      }

      logger.info(
        {
          event_count: payload.data.length,
          request_id: apiResponse.request_id,
          advertiserId,
        },
        'Events sent to TikTok CRM API successfully'
      );

      return apiResponse;
    });
  }

  /**
   * Splits a payload into chunks of TIKTOK_BATCH_SIZE.
   */
  chunkPayload(payload: TikTokEventsPayload): TikTokEventsPayload[] {
    const { data, ...rest } = payload;
    const chunks: TikTokEventsPayload[] = [];

    for (let i = 0; i < data.length; i += this.config.batchSize) {
      chunks.push({
        ...rest,
        data: data.slice(i, i + this.config.batchSize),
      });
    }

    // Return at least one chunk (even if empty)
    if (chunks.length === 0) {
      chunks.push({ ...rest, data: [] });
    }

    return chunks;
  }
}
