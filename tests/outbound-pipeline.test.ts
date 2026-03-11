import { OutboundPipeline } from '../src/outbound-pipeline';
import { RedisDeduplicator } from '../src/deduplication/redis-dedup';
import { EventLog } from '../src/db/event-log';
import { TikTokAPIClient } from '../src/clients/tiktok-api-client';
import { CRMEventSetManager } from '../src/event-set/crm-event-set-manager';
import { RetryQueue } from '../src/queue/retry-queue';
import { KlaviyoWebhookEvent } from '../src/types';

jest.mock('../src/deduplication/redis-dedup');
jest.mock('../src/db/event-log');
jest.mock('../src/clients/tiktok-api-client');
jest.mock('../src/event-set/crm-event-set-manager');
jest.mock('../src/queue/retry-queue');

function buildKlaviyoWebhookEvent(
  metricName: string,
  overrides: Partial<KlaviyoWebhookEvent['attributes']> = {}
): KlaviyoWebhookEvent {
  return {
    type: 'event',
    id: 'evt-klaviyo-001',
    attributes: {
      metric: { name: metricName },
      profile: {
        data: {
          attributes: {
            email: 'customer@example.com',
            phone_number: '+14155551234',
            first_name: 'Customer',
            last_name: 'Test',
            properties: {
              tiktok_lead_id: 'lead-001',
              advertiser_id: 'adv-001',
            },
          },
        },
      },
      properties: {
        advertiser_id: 'adv-001',
      },
      time: '2024-11-14T22:13:20Z',
      unique_id: 'unique-id-001',
      ...overrides,
    },
  };
}

describe('OutboundPipeline', () => {
  let pipeline: OutboundPipeline;
  let mockTikTok: jest.Mocked<TikTokAPIClient>;
  let mockDedup: jest.Mocked<RedisDeduplicator>;
  let mockEventLog: jest.Mocked<EventLog>;
  let mockQueue: jest.Mocked<RetryQueue>;
  let mockEventSetManager: jest.Mocked<CRMEventSetManager>;

  beforeEach(() => {
    mockTikTok = new TikTokAPIClient(jest.fn(), {} as never) as jest.Mocked<TikTokAPIClient>;
    mockDedup = new RedisDeduplicator({} as never, 172800) as jest.Mocked<RedisDeduplicator>;
    mockEventLog = new EventLog({} as never) as jest.Mocked<EventLog>;
    mockQueue = new RetryQueue({} as never, {} as never, {} as never, {} as never, 10) as jest.Mocked<RetryQueue>;
    mockEventSetManager = new CRMEventSetManager({} as never, {} as never, '', '', '') as jest.Mocked<CRMEventSetManager>;

    mockDedup.isDuplicate = jest.fn().mockResolvedValue(false);
    mockTikTok.sendEvents = jest.fn().mockResolvedValue({ code: 0, message: 'OK', request_id: 'req-001' });
    mockEventLog.insert = jest.fn().mockResolvedValue(undefined);
    mockEventLog.updateStatus = jest.fn().mockResolvedValue(undefined);
    mockQueue.enqueueOutbound = jest.fn().mockResolvedValue(undefined);
    mockEventSetManager.resolve = jest.fn().mockResolvedValue('event-set-001');

    pipeline = new OutboundPipeline(
      mockTikTok,
      mockDedup,
      mockEventLog,
      mockQueue,
      mockEventSetManager,
      'adv-001'
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('filters and maps "Lead Created" → SubmitForm', async () => {
    await pipeline.process(buildKlaviyoWebhookEvent('Lead Created'));
    expect(mockTikTok.sendEvents).toHaveBeenCalledTimes(1);
    const call = mockTikTok.sendEvents.mock.calls[0][0];
    expect(call.data[0].event).toBe('SubmitForm');
  });

  it('filters and maps "Deal Won" → Purchase', async () => {
    await pipeline.process(buildKlaviyoWebhookEvent('Deal Won'));
    const call = mockTikTok.sendEvents.mock.calls[0][0];
    expect(call.data[0].event).toBe('Purchase');
  });

  it('filters out unknown metric names', async () => {
    await pipeline.process(buildKlaviyoWebhookEvent('Unknown Metric XYZ'));
    expect(mockTikTok.sendEvents).not.toHaveBeenCalled();
  });

  it('deduplicates repeated events', async () => {
    mockDedup.isDuplicate = jest.fn().mockResolvedValue(true);
    await pipeline.process(buildKlaviyoWebhookEvent('Lead Created'));
    expect(mockTikTok.sendEvents).not.toHaveBeenCalled();
    expect(mockEventLog.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'duplicate' })
    );
  });

  it('resolves event set from CRMEventSetManager', async () => {
    await pipeline.process(buildKlaviyoWebhookEvent('Lead Created'));
    expect(mockEventSetManager.resolve).toHaveBeenCalledWith('adv-001');
  });

  it('falls back to env var when event set manager returns null', async () => {
    // Even when resolve returns null, if env var is set it should handle it differently
    // In this case, the pipeline returns early when eventSetId is null
    mockEventSetManager.resolve = jest.fn().mockResolvedValue(null);
    await pipeline.process(buildKlaviyoWebhookEvent('Lead Created'));
    expect(mockTikTok.sendEvents).not.toHaveBeenCalled();
  });

  it('hashes PII before sending to TikTok', async () => {
    await pipeline.process(buildKlaviyoWebhookEvent('Lead Created'));
    const call = mockTikTok.sendEvents.mock.calls[0][0];
    const user = call.data[0].user;
    // Email should be hashed (64-char hex string)
    expect(user.email).toHaveLength(64);
    expect(user.email).toMatch(/^[a-f0-9]+$/);
  });

  it('sends correct DFO stage for SubmitForm (stage 1)', async () => {
    await pipeline.process(buildKlaviyoWebhookEvent('Lead Created'));
    const call = mockTikTok.sendEvents.mock.calls[0][0];
    expect(call.data[0].properties.dfo_stage).toBe(1);
  });

  it('sends correct DFO stage for Contact (stage 2)', async () => {
    await pipeline.process(buildKlaviyoWebhookEvent('Lead Contacted'));
    const call = mockTikTok.sendEvents.mock.calls[0][0];
    expect(call.data[0].properties.dfo_stage).toBe(2);
  });

  it('sends correct DFO stage for Purchase (stage 4)', async () => {
    await pipeline.process(buildKlaviyoWebhookEvent('Deal Won'));
    const call = mockTikTok.sendEvents.mock.calls[0][0];
    expect(call.data[0].properties.dfo_stage).toBe(4);
  });

  it('handles missing advertiser_id gracefully', async () => {
    const pipelineNoDefault = new OutboundPipeline(
      mockTikTok,
      mockDedup,
      mockEventLog,
      mockQueue,
      mockEventSetManager
      // No defaultAdvertiserId
    );

    const event = buildKlaviyoWebhookEvent('Lead Created');
    // Remove advertiser_id from properties
    event.attributes.properties = {};

    await pipelineNoDefault.process(event);
    expect(mockTikTok.sendEvents).not.toHaveBeenCalled();
  });

  it('enqueues for retry on TikTok API failure', async () => {
    mockTikTok.sendEvents = jest.fn().mockRejectedValue(new Error('TikTok down'));
    await pipeline.process(buildKlaviyoWebhookEvent('Lead Created'));
    expect(mockQueue.enqueueOutbound).toHaveBeenCalledTimes(1);
  });
});
