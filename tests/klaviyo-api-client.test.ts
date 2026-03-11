import axios from 'axios';
import { KlaviyoAPIClient } from '../src/clients/klaviyo-api-client';
import { KlaviyoEventPayload, KlaviyoProfileAttributes } from '../src/types';

jest.mock('axios');
jest.mock('axios-retry', () => jest.fn());

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('KlaviyoAPIClient', () => {
  let client: KlaviyoAPIClient;
  let mockPost: jest.Mock;

  beforeEach(() => {
    mockPost = jest.fn();
    mockedAxios.create.mockReturnValue({
      post: mockPost,
      defaults: { headers: {} },
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    } as unknown as ReturnType<typeof axios.create>);

    client = new KlaviyoAPIClient('pk_test_key', 'https://a.klaviyo.com');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const sampleEventPayload: KlaviyoEventPayload = {
    data: {
      type: 'event',
      attributes: {
        metric: {
          data: {
            type: 'metric',
            attributes: { name: 'Lead Created' },
          },
        },
        profile: {
          data: {
            type: 'profile',
            attributes: {
              email: 'test@example.com',
            },
          },
        },
        unique_id: 'test-uuid-1',
        time: new Date().toISOString(),
        properties: {},
      },
    },
  };

  it('sets correct Authorization header', () => {
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Klaviyo-API-Key pk_test_key',
        }),
      })
    );
  });

  it('sets correct revision header', () => {
    expect(mockedAxios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({
          revision: '2024-02-15',
        }),
      })
    );
  });

  it('creates event with POST to /api/events/', async () => {
    mockPost.mockResolvedValue({ data: {}, status: 202 });
    await client.createEvent(sampleEventPayload);
    expect(mockPost).toHaveBeenCalledWith('/api/events/', sampleEventPayload);
  });

  it('upsertProfile returns profile ID', async () => {
    mockPost.mockResolvedValue({
      data: { data: { id: 'klaviyo-profile-123' } },
      status: 200,
    });

    const profileAttrs: KlaviyoProfileAttributes = {
      email: 'test@example.com',
      first_name: 'Test',
    };

    const profileId = await client.upsertProfile(profileAttrs);
    expect(profileId).toBe('klaviyo-profile-123');
  });

  it('upsertProfile sends to /api/profile-import/', async () => {
    mockPost.mockResolvedValue({
      data: { data: { id: 'prof-456' } },
    });

    const attrs: KlaviyoProfileAttributes = { email: 'x@y.com' };
    await client.upsertProfile(attrs);

    expect(mockPost).toHaveBeenCalledWith(
      '/api/profile-import/',
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'profile',
          attributes: attrs,
        }),
      })
    );
  });

  it('bulkCreateEvents sends correct payload', async () => {
    mockPost.mockResolvedValue({ data: {}, status: 202 });

    await client.bulkCreateEvents([sampleEventPayload, sampleEventPayload]);

    expect(mockPost).toHaveBeenCalledWith(
      '/api/event-bulk-create-jobs/',
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'event-bulk-create-job',
        }),
      })
    );
  });

  it('bulkCreateEvents handles empty array without making API call', async () => {
    await client.bulkCreateEvents([]);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('createEvent does not throw on successful response', async () => {
    mockPost.mockResolvedValue({ data: {}, status: 202 });
    await expect(client.createEvent(sampleEventPayload)).resolves.not.toThrow();
  });

  it('upsertProfile sends data type as profile', async () => {
    mockPost.mockResolvedValue({ data: { data: { id: 'prof-001' } } });
    await client.upsertProfile({ email: 'a@b.com' });

    const call = mockPost.mock.calls[0];
    expect(call[1].data.type).toBe('profile');
  });

  it('createEvent propagates errors from API', async () => {
    mockPost.mockRejectedValue(new Error('Network error'));
    await expect(client.createEvent(sampleEventPayload)).rejects.toThrow('Network error');
  });
});
