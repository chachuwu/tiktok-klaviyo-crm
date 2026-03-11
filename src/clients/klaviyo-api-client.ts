import axios, { AxiosInstance, AxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { KlaviyoEventPayload, KlaviyoProfileAttributes } from '../types';
import { logger } from '../logging/logger';

const KLAVIYO_API_REVISION = '2024-02-15';

export class KlaviyoAPIClient {
  private readonly axiosInstance: AxiosInstance;

  constructor(privateApiKey: string, baseUrl: string) {
    this.axiosInstance = axios.create({
      baseURL: baseUrl,
      headers: {
        Authorization: `Klaviyo-API-Key ${privateApiKey}`,
        revision: KLAVIYO_API_REVISION,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 30000,
    });

    // Configure retry logic
    axiosRetry(this.axiosInstance, {
      retries: 3,
      retryDelay: (retryCount: number, error: AxiosError) => {
        // Respect Retry-After header on 429
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'];
          if (retryAfter) {
            const waitMs = parseInt(String(retryAfter), 10) * 1000;
            if (!isNaN(waitMs) && waitMs > 0) {
              return Math.min(waitMs, 60000);
            }
          }
          return 5000; // Default 5s on rate limit
        }
        // Exponential backoff for other errors
        return 1000 * Math.pow(2, retryCount - 1);
      },
      retryCondition: (error: AxiosError) => {
        if (error.response) {
          const status = error.response.status;
          // Don't retry on client errors except 429 (rate limit)
          if (status === 400 || status === 401 || status === 403 || status === 404) {
            return false;
          }
          return status === 429 || status >= 500;
        }
        return axiosRetry.isNetworkError(error);
      },
      onRetry: (retryCount, error) => {
        logger.warn(
          { retryCount, status: error.response?.status, message: error.message },
          'Klaviyo API request retry'
        );
      },
    });
  }

  /**
   * Creates a single event in Klaviyo.
   */
  async createEvent(payload: KlaviyoEventPayload): Promise<void> {
    logger.debug(
      { metric: payload.data.attributes.metric.data.attributes.name },
      'Creating Klaviyo event'
    );

    await this.axiosInstance.post('/api/events/', payload);

    logger.info(
      {
        metric: payload.data.attributes.metric.data.attributes.name,
        unique_id: payload.data.attributes.unique_id,
      },
      'Klaviyo event created'
    );
  }

  /**
   * Upserts a profile in Klaviyo. Returns the Klaviyo profile ID.
   */
  async upsertProfile(attributes: KlaviyoProfileAttributes): Promise<string> {
    logger.debug('Upserting Klaviyo profile');

    const payload = {
      data: {
        type: 'profile',
        attributes,
      },
    };

    const response = await this.axiosInstance.post<{
      data: { id: string };
    }>('/api/profile-import/', payload);

    const profileId = response.data.data.id;

    logger.debug({ profile_id: profileId }, 'Klaviyo profile upserted');
    return profileId;
  }

  /**
   * Bulk creates up to 1000 events in Klaviyo using the bulk create jobs endpoint.
   */
  async bulkCreateEvents(events: KlaviyoEventPayload[]): Promise<void> {
    if (events.length === 0) return;

    // Klaviyo bulk create supports up to 1000 events
    const MAX_BULK_SIZE = 1000;
    const chunks: KlaviyoEventPayload[][] = [];

    for (let i = 0; i < events.length; i += MAX_BULK_SIZE) {
      chunks.push(events.slice(i, i + MAX_BULK_SIZE));
    }

    for (const chunk of chunks) {
      const payload = {
        data: {
          type: 'event-bulk-create-job',
          attributes: {
            events_bulk_create: {
              data: chunk.map((e) => e.data),
            },
          },
        },
      };

      await this.axiosInstance.post('/api/event-bulk-create-jobs/', payload);

      logger.info({ event_count: chunk.length }, 'Klaviyo bulk events created');
    }
  }
}
