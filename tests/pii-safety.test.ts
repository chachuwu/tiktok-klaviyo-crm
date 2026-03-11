import { buildTikTokPayload } from '../src/transformer/tiktok-event-builder';
import { buildKlaviyoEvent } from '../src/transformer/klaviyo-event-builder';
import { CanonicalCRMEvent } from '../src/types';
import { normalizeEmail, normalizePhone } from '../src/normalization/normalizer';
import { sha256 } from '../src/normalization/hasher';

const testEvent: CanonicalCRMEvent = {
  event_id: 'pii-test-id',
  event_name: 'Purchase',
  event_time: 1700000000,
  user: {
    email: 'sensitive@example.com',
    phone: '+14155559999',
    first_name: 'Alice',
    last_name: 'Smith',
    external_id: 'ext-999',
    ttclid: 'tiktok-click-xyz',
    tiktok_lead_id: 'lead-sensitive',
    ip: '10.0.0.1',
    user_agent: 'TestAgent/1.0',
  },
  direction: 'outbound',
};

describe('PII Safety — TikTok-bound payloads', () => {
  let tiktokPayload: ReturnType<typeof buildTikTokPayload>;

  beforeEach(() => {
    tiktokPayload = buildTikTokPayload(testEvent, 'Purchase', 'event-set-001');
  });

  it('verifies no plaintext email in TikTok-bound payload', () => {
    const payloadStr = JSON.stringify(tiktokPayload);
    expect(payloadStr).not.toContain('sensitive@example.com');
  });

  it('verifies no plaintext phone in TikTok-bound payload', () => {
    const payloadStr = JSON.stringify(tiktokPayload);
    expect(payloadStr).not.toContain('+14155559999');
  });

  it('verifies no plaintext first_name in TikTok-bound payload', () => {
    const payloadStr = JSON.stringify(tiktokPayload);
    // The hashed version should be present, but not the plaintext
    const hashedName = sha256('alice');
    expect(tiktokPayload.data[0].user.first_name).toBe(hashedName);
    expect(payloadStr).not.toContain('"Alice"');
  });

  it('verifies no plaintext last_name in TikTok-bound payload', () => {
    const payloadStr = JSON.stringify(tiktokPayload);
    const hashedName = sha256('smith');
    expect(tiktokPayload.data[0].user.last_name).toBe(hashedName);
    expect(payloadStr).not.toContain('"Smith"');
  });

  it('verifies email IS hashed (SHA-256) in TikTok payload', () => {
    const expectedHash = sha256(normalizeEmail('sensitive@example.com'));
    expect(tiktokPayload.data[0].user.email).toBe(expectedHash);
  });

  it('verifies phone IS hashed (SHA-256) in TikTok payload', () => {
    const expectedHash = sha256(normalizePhone('+14155559999'));
    expect(tiktokPayload.data[0].user.phone_number).toBe(expectedHash);
  });

  it('verifies ttclid is NOT hashed in TikTok payload', () => {
    expect(tiktokPayload.data[0].user.ttclid).toBe('tiktok-click-xyz');
  });

  it('verifies lead_id is NOT hashed in TikTok payload', () => {
    expect(tiktokPayload.data[0].user.lead_id).toBe('lead-sensitive');
  });
});

describe('PII Safety — Klaviyo-bound payloads', () => {
  let klaviyoPayload: ReturnType<typeof buildKlaviyoEvent>;

  beforeEach(() => {
    klaviyoPayload = buildKlaviyoEvent(testEvent);
  });

  it('verifies email IS plaintext in Klaviyo-bound payload (no hashing)', () => {
    expect(klaviyoPayload.data.attributes.profile.data.attributes.email).toBe(
      'sensitive@example.com'
    );
  });

  it('verifies phone IS plaintext in Klaviyo-bound payload (no hashing)', () => {
    expect(klaviyoPayload.data.attributes.profile.data.attributes.phone_number).toBe(
      '+14155559999'
    );
  });

  it('verifies first_name IS plaintext in Klaviyo-bound payload', () => {
    expect(klaviyoPayload.data.attributes.profile.data.attributes.first_name).toBe('Alice');
  });

  it('verifies last_name IS plaintext in Klaviyo-bound payload', () => {
    expect(klaviyoPayload.data.attributes.profile.data.attributes.last_name).toBe('Smith');
  });
});

describe('PII normalization before hashing', () => {
  it('normalizes email before hashing — same hash for different capitalizations', () => {
    const event1: CanonicalCRMEvent = { ...testEvent, user: { email: 'User@Example.COM' } };
    const event2: CanonicalCRMEvent = { ...testEvent, user: { email: 'user@example.com' } };

    const p1 = buildTikTokPayload(event1, 'Contact', 'set-001');
    const p2 = buildTikTokPayload(event2, 'Contact', 'set-001');

    expect(p1.data[0].user.email).toBe(p2.data[0].user.email);
  });

  it('normalizes phone before hashing — same hash for formatted/unformatted', () => {
    const event1: CanonicalCRMEvent = { ...testEvent, user: { phone: '(415) 555-1234' } };
    const event2: CanonicalCRMEvent = { ...testEvent, user: { phone: '+14155551234' } };

    const p1 = buildTikTokPayload(event1, 'Contact', 'set-001');
    const p2 = buildTikTokPayload(event2, 'Contact', 'set-001');

    expect(p1.data[0].user.phone_number).toBe(p2.data[0].user.phone_number);
  });
});
