import { InboundPipeline } from '../src/inbound-pipeline';
import { RedisDeduplicator } from '../src/deduplication/redis-dedup';
import { EventLog } from '../src/db/event-log';
import { KlaviyoAPIClient } from '../src/clients/klaviyo-api-client';
import { RetryQueue } from '../src/queue/retry-queue';
import { TikTokLeadWebhookPayload } from '../src/types';

// Mock dependencies
jest.mock('../src/deduplication/redis-dedup');
jest.mock('../src/db/event-log');
jest.mock('../src/clients/klaviyo-api-client');
jest.mock('../src/queue/retry-queue');

describe('InboundPipeline', () => {
  let pipeline: InboundPipeline;
  let mockKlaviyo: jest.Mocked<KlaviyoAPIClient>;
  let mockDedup: jest.Mocked<RedisDeduplicator>;
  let mockEventLog: jest.Mocked<EventLog>;
  let mockQueue: jest.Mocked<RetryQueue>;

  const basePayload: TikTokLeadWebhookPayload = {
    advertiser_id: 'adv-001',
    form_id: 'form-001',
    lead_id: 'lead-001',
    ad_id: 'ad-001',
    adgroup_id: 'adgrp-001',
    campaign_id: 'camp-001',
    create_time: 1700000000,
    field_data: [
      { name: 'email', values: ['test@example.com'] },
      { name: 'phone_number', values: ['+14155551234'] },
      { name: 'first_name', values: ['John'] },
      { name: 'last_name', values: ['Doe'] },
    ],
  };

  beforeEach(() => {
    mockKlaviyo = new KlaviyoAPIClient('key', 'url') as jest.Mocked<KlaviyoAPIClient>;
    mockDedup = new RedisDeduplicator({} as never, 172800) as jest.Mocked<RedisDeduplicator>;
    mockEventLog = new EventLog({} as never) as jest.Mocked<EventLog>;
    mockQueue = new RetryQueue({} as never, {} as never, {} as never, {} as never, 10) as jest.Mocked<RetryQueue>;

    mockDedup.isDuplicate = jest.fn().mockResolvedValue(false);
    mockKlaviyo.upsertProfile = jest.fn().mockResolvedValue('profile-123');
    mockKlaviyo.createEvent = jest.fn().mockResolvedValue(undefined);
    mockEventLog.insert = jest.fn().mockResolvedValue(undefined);
    mockEventLog.updateStatus = jest.fn().mockResolvedValue(undefined);
    mockQueue.enqueueInbound = jest.fn().mockResolvedValue(undefined);

    pipeline = new InboundPipeline(mockKlaviyo, mockDedup, mockEventLog, mockQueue);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('processes a valid TikTok lead webhook payload', async () => {
    await pipeline.process(basePayload);
    expect(mockKlaviyo.createEvent).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated lead_id', async () => {
    mockDedup.isDuplicate = jest.fn().mockResolvedValue(true);
    await pipeline.process(basePayload);
    expect(mockKlaviyo.createEvent).not.toHaveBeenCalled();
  });

  it('handles missing email gracefully', async () => {
    const payload = {
      ...basePayload,
      field_data: [{ name: 'phone_number', values: ['+14155551234'] }],
    };
    await expect(pipeline.process(payload)).resolves.not.toThrow();
    expect(mockKlaviyo.createEvent).toHaveBeenCalled();
  });

  it('handles missing phone gracefully', async () => {
    const payload = {
      ...basePayload,
      field_data: [{ name: 'email', values: ['test@example.com'] }],
    };
    await expect(pipeline.process(payload)).resolves.not.toThrow();
    expect(mockKlaviyo.createEvent).toHaveBeenCalled();
  });

  it('calls klaviyoAPIClient.upsertProfile before createEvent', async () => {
    const callOrder: string[] = [];
    mockKlaviyo.upsertProfile = jest.fn().mockImplementation(async () => {
      callOrder.push('upsert');
      return 'profile-id';
    });
    mockKlaviyo.createEvent = jest.fn().mockImplementation(async () => {
      callOrder.push('create');
    });

    await pipeline.process(basePayload);

    expect(callOrder[0]).toBe('upsert');
    expect(callOrder[1]).toBe('create');
  });

  it('enqueues for retry on Klaviyo API failure', async () => {
    mockKlaviyo.createEvent = jest.fn().mockRejectedValue(new Error('Klaviyo down'));
    await pipeline.process(basePayload);
    expect(mockQueue.enqueueInbound).toHaveBeenCalledTimes(1);
  });

  it('inserts event log with correct direction="inbound"', async () => {
    await pipeline.process(basePayload);
    expect(mockEventLog.insert).toHaveBeenCalledWith(
      expect.objectContaining({ direction: 'inbound' })
    );
  });

  it('parses full_name field correctly', async () => {
    const payload = {
      ...basePayload,
      field_data: [
        { name: 'email', values: ['john@example.com'] },
        { name: 'full_name', values: ['John Doe'] },
      ],
    };
    await pipeline.process(payload);
    const eventCall = mockKlaviyo.createEvent.mock.calls[0][0];
    const attrs = eventCall.data.attributes.profile.data.attributes;
    expect(attrs.first_name).toBe('John');
    expect(attrs.last_name).toBe('Doe');
  });

  it('handles first_name + last_name fields separately', async () => {
    await pipeline.process(basePayload);
    const eventCall = mockKlaviyo.createEvent.mock.calls[0][0];
    const attrs = eventCall.data.attributes.profile.data.attributes;
    expect(attrs.first_name).toBe('John');
    expect(attrs.last_name).toBe('Doe');
  });

  it('updates event log to "sent" on success', async () => {
    await pipeline.process(basePayload);
    expect(mockEventLog.updateStatus).toHaveBeenCalledWith(
      expect.any(String),
      'sent'
    );
  });

  it('handles numeric create_time correctly', async () => {
    const payload = { ...basePayload, create_time: 1700000000 };
    await pipeline.process(payload);
    const eventCall = mockKlaviyo.createEvent.mock.calls[0][0];
    expect(eventCall.data.attributes.time).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('processes multiple field_data entries', async () => {
    const payload = {
      ...basePayload,
      field_data: [
        { name: 'email', values: ['a@b.com'] },
        { name: 'phone_number', values: ['+14155554321'] },
        { name: 'first_name', values: ['Alice'] },
        { name: 'last_name', values: ['Wonder'] },
      ],
    };
    await pipeline.process(payload);
    const eventCall = mockKlaviyo.createEvent.mock.calls[0][0];
    const attrs = eventCall.data.attributes.profile.data.attributes;
    expect(attrs.email).toBe('a@b.com');
    expect(attrs.phone_number).toBe('+14155554321');
    expect(attrs.first_name).toBe('Alice');
    expect(attrs.last_name).toBe('Wonder');
  });
});
