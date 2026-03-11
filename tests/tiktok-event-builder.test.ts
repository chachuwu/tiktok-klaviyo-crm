import { buildTikTokPayload } from '../src/transformer/tiktok-event-builder';
import { CanonicalCRMEvent, TikTokStandardEvent } from '../src/types';
import { sha256 } from '../src/normalization/hasher';
import { normalizeEmail, normalizePhone, normalizeName } from '../src/normalization/normalizer';

const baseEvent: CanonicalCRMEvent = {
  event_id: 'test-event-id',
  event_name: 'Purchase',
  event_time: 1700000000,
  lead_id: 'lead-001',
  advertiser_id: 'adv-001',
  campaign_id: 'camp-001',
  user: {
    email: 'test@example.com',
    phone: '+14155551234',
    first_name: 'John',
    last_name: 'Doe',
    external_id: 'ext-123',
    ttclid: 'tiktok-click-abc',
    ip: '192.168.1.1',
    user_agent: 'Mozilla/5.0',
    tiktok_lead_id: 'lead-001',
  },
  direction: 'outbound',
};

describe('buildTikTokPayload', () => {
  it('hashes email before sending to TikTok', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    const expectedHash = sha256(normalizeEmail('test@example.com'));
    expect(payload.data[0].user.email).toBe(expectedHash);
  });

  it('hashes phone_number before sending to TikTok', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    const expectedHash = sha256(normalizePhone('+14155551234'));
    expect(payload.data[0].user.phone_number).toBe(expectedHash);
  });

  it('hashes first_name before sending to TikTok', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    const expectedHash = sha256(normalizeName('John'));
    expect(payload.data[0].user.first_name).toBe(expectedHash);
  });

  it('hashes last_name before sending to TikTok', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    const expectedHash = sha256(normalizeName('Doe'));
    expect(payload.data[0].user.last_name).toBe(expectedHash);
  });

  it('does NOT hash ttclid', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    expect(payload.data[0].user.ttclid).toBe('tiktok-click-abc');
  });

  it('does NOT hash ip', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    expect(payload.data[0].user.ip).toBe('192.168.1.1');
  });

  it('does NOT hash user_agent', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    expect(payload.data[0].user.user_agent).toBe('Mozilla/5.0');
  });

  it('does NOT hash lead_id', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    expect(payload.data[0].user.lead_id).toBe('lead-001');
  });

  it('sets correct event_source="crm"', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    expect(payload.event_source).toBe('crm');
  });

  it('sets correct event_source_id', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    expect(payload.event_source_id).toBe('event-set-001');
  });

  it('sets correct DFO stage for each event type', () => {
    const stageMap: Record<TikTokStandardEvent, number> = {
      SubmitForm: 1,
      Contact: 2,
      Schedule: 2,
      CompleteRegistration: 3,
      SubmitApplication: 3,
      Purchase: 4,
      ApplicationApproval: 4,
      Subscribe: 4,
      StartTrial: 4,
    };

    for (const [event, stage] of Object.entries(stageMap)) {
      const payload = buildTikTokPayload(baseEvent, event as TikTokStandardEvent, 'event-set-001');
      expect(payload.data[0].properties.dfo_stage).toBe(stage);
    }
  });

  it('adds value for Purchase events', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    expect(payload.data[0].properties.value).toBeDefined();
    expect(payload.data[0].properties.currency).toBe('USD');
  });

  it('sets integration_version in properties', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    expect(payload.data[0].properties.integration_version).toBeDefined();
  });

  it('sets event_time from canonical event', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    expect(payload.data[0].event_time).toBe(1700000000);
  });

  it('sets event_id from canonical event', () => {
    const payload = buildTikTokPayload(baseEvent, 'Purchase', 'event-set-001');
    expect(payload.data[0].event_id).toBe('test-event-id');
  });

  it('does not add value/currency for non-Purchase events', () => {
    const payload = buildTikTokPayload(baseEvent, 'Contact', 'event-set-001');
    expect(payload.data[0].properties.value).toBeUndefined();
    expect(payload.data[0].properties.currency).toBeUndefined();
  });
});
