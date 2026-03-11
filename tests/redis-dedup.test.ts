import { RedisDeduplicator } from '../src/deduplication/redis-dedup';
import type { Redis } from 'ioredis';

function createMockRedis(): jest.Mocked<Pick<Redis, 'set'>> {
  return {
    set: jest.fn(),
  };
}

describe('RedisDeduplicator', () => {
  let mockRedis: ReturnType<typeof createMockRedis>;
  let deduplicator: RedisDeduplicator;

  beforeEach(() => {
    mockRedis = createMockRedis();
    deduplicator = new RedisDeduplicator(mockRedis as unknown as Redis, 172800);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns false for a new event (SET NX returns OK)', async () => {
    mockRedis.set.mockResolvedValue('OK');
    const result = await deduplicator.isDuplicate('event-123');
    expect(result).toBe(false);
  });

  it('returns true for a duplicate event (SET NX returns null)', async () => {
    mockRedis.set.mockResolvedValue(null);
    const result = await deduplicator.isDuplicate('event-123');
    expect(result).toBe(true);
  });

  it('calls Redis with correct key prefix', async () => {
    mockRedis.set.mockResolvedValue('OK');
    await deduplicator.isDuplicate('event-456');
    expect(mockRedis.set).toHaveBeenCalledWith(
      'dedup:event-456',
      '1',
      'EX',
      172800,
      'NX'
    );
  });

  it('calls Redis with correct TTL', async () => {
    const customDeduplicator = new RedisDeduplicator(mockRedis as unknown as Redis, 3600);
    mockRedis.set.mockResolvedValue('OK');
    await customDeduplicator.isDuplicate('event-789');
    expect(mockRedis.set).toHaveBeenCalledWith('dedup:event-789', '1', 'EX', 3600, 'NX');
  });

  it('returns false (fail-open) when Redis throws', async () => {
    mockRedis.set.mockRejectedValue(new Error('Redis connection failed'));
    const result = await deduplicator.isDuplicate('event-fail');
    expect(result).toBe(false);
  });

  it('calls set with NX flag for atomicity', async () => {
    mockRedis.set.mockResolvedValue('OK');
    await deduplicator.isDuplicate('atomic-test');
    const callArgs = mockRedis.set.mock.calls[0];
    expect(callArgs).toContain('NX');
  });

  it('handles multiple sequential calls correctly', async () => {
    mockRedis.set
      .mockResolvedValueOnce('OK')    // First call: new event
      .mockResolvedValueOnce(null);   // Second call: duplicate

    const first = await deduplicator.isDuplicate('event-multi');
    const second = await deduplicator.isDuplicate('event-multi');

    expect(first).toBe(false);
    expect(second).toBe(true);
  });

  it('does not throw even when Redis throws network error', async () => {
    mockRedis.set.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(deduplicator.isDuplicate('event-network-err')).resolves.toBe(false);
  });

  it('handles different event IDs independently', async () => {
    mockRedis.set
      .mockResolvedValueOnce('OK')  // event-a: new
      .mockResolvedValueOnce(null); // event-b: duplicate

    const resultA = await deduplicator.isDuplicate('event-a');
    const resultB = await deduplicator.isDuplicate('event-b');

    expect(resultA).toBe(false);
    expect(resultB).toBe(true);
  });

  it('uses TTL value from constructor', async () => {
    const ttl = 86400;
    const d = new RedisDeduplicator(mockRedis as unknown as Redis, ttl);
    mockRedis.set.mockResolvedValue('OK');
    await d.isDuplicate('ttl-test');
    expect(mockRedis.set).toHaveBeenCalledWith(expect.any(String), '1', 'EX', ttl, 'NX');
  });
});
