import axios from 'axios';
import Bottleneck from 'bottleneck';
import { TikTokAPIClient } from '../src/clients/tiktok-api-client';
import { TikTokEventsPayload, ActiveToken } from '../src/types';

jest.mock('axios');
jest.mock('axios-retry', () => jest.fn());
jest.mock('bottleneck');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedBottleneck = Bottleneck as jest.MockedClass<typeof Bottleneck>;

describe('TikTokAPIClient', () => {
  let client: TikTokAPIClient;
  let mockPost: jest.Mock;
  let mockSchedule: jest.Mock;
  let mockGetToken: jest.Mock;

  const config = {
    apiBaseUrl: 'https://business-api.tiktok.com',
    apiVersion: 'v1.3',
    maxRetries: 5,
    initialRetryDelayMs: 1000,
    rateLimitRps: 10,
    batchSize: 50,
  };

  const samplePayload: TikTokEventsPayload = {
    event_source: 'crm',
    event_source_id: 'event-set-001',
    data: [
      {
        event: 'Purchase',
        event_time: 1700000000,
        event_id: 'evt-001',
        user: { email: 'abc123hash' },
        properties: { dfo_stage: 4 },
      },
    ],
  };

  beforeEach(() => {
    mockPost = jest.fn().mockResolvedValue({
      data: { code: 0, message: 'OK', request_id: 'req-001' },
    });

    mockedAxios.create.mockReturnValue({
      post: mockPost,
      defaults: { headers: {} },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as unknown as ReturnType<typeof axios.create>);

    mockSchedule = jest.fn().mockImplementation((fn: () => unknown) => fn());
    mockedBottleneck.mockImplementation(() => ({
      schedule: mockSchedule,
    } as unknown as Bottleneck));

    mockGetToken = jest.fn().mockResolvedValue({
      access_token: 'test-access-token',
      advertiser_id: 'adv-001',
      expires_at: new Date(Date.now() + 3600000),
    } as ActiveToken);

    client = new TikTokAPIClient(mockGetToken, config);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sets correct Access-Token header when sending events', async () => {
    await client.sendEvents(samplePayload, 'adv-001');
    expect(mockGetToken).toHaveBeenCalledWith('adv-001');
    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      samplePayload,
      expect.objectContaining({
        headers: expect.objectContaining({
          'Access-Token': 'test-access-token',
        }),
      })
    );
  });

  it('posts to the correct events endpoint', async () => {
    await client.sendEvents(samplePayload, 'adv-001');
    expect(mockPost).toHaveBeenCalledWith(
      '/open_api/v1.3/event/track/',
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('returns API response on success', async () => {
    const response = await client.sendEvents(samplePayload, 'adv-001');
    expect(response.code).toBe(0);
    expect(response.message).toBe('OK');
  });

  it('throws on non-zero API response code', async () => {
    mockPost.mockResolvedValue({
      data: { code: 40002, message: 'Invalid parameter', request_id: 'req-002' },
    });
    await expect(client.sendEvents(samplePayload, 'adv-001')).rejects.toThrow(
      'TikTok API error'
    );
  });

  it('uses Bottleneck rate limiter', async () => {
    await client.sendEvents(samplePayload, 'adv-001');
    expect(mockSchedule).toHaveBeenCalled();
  });

  it('chunkPayload splits at batch size', () => {
    const events = Array.from({ length: 120 }, (_, i) => ({
      event: 'Contact' as const,
      event_time: 1700000000,
      event_id: `evt-${i}`,
      user: {},
      properties: {},
    }));

    const bigPayload: TikTokEventsPayload = {
      event_source: 'crm',
      event_source_id: 'set-001',
      data: events,
    };

    const chunks = client.chunkPayload(bigPayload);
    expect(chunks).toHaveLength(3); // 50 + 50 + 20
    expect(chunks[0].data).toHaveLength(50);
    expect(chunks[1].data).toHaveLength(50);
    expect(chunks[2].data).toHaveLength(20);
  });

  it('chunkPayload preserves event_source and event_source_id', () => {
    const chunks = client.chunkPayload(samplePayload);
    expect(chunks[0].event_source).toBe('crm');
    expect(chunks[0].event_source_id).toBe('event-set-001');
  });

  it('chunkPayload handles payload with exactly batch size events', () => {
    const events = Array.from({ length: 50 }, (_, i) => ({
      event: 'Contact' as const,
      event_time: 1700000000,
      event_id: `evt-${i}`,
      user: {},
      properties: {},
    }));

    const payload: TikTokEventsPayload = {
      event_source: 'crm',
      event_source_id: 'set-001',
      data: events,
    };

    const chunks = client.chunkPayload(payload);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].data).toHaveLength(50);
  });

  it('chunkPayload returns single empty chunk for empty payload', () => {
    const emptyPayload: TikTokEventsPayload = {
      event_source: 'crm',
      event_source_id: 'set-001',
      data: [],
    };
    const chunks = client.chunkPayload(emptyPayload);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].data).toHaveLength(0);
  });
});
