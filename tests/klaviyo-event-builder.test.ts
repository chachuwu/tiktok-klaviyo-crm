import { buildKlaviyoEvent } from '../src/transformer/klaviyo-event-builder';
import { CanonicalCRMEvent } from '../src/types';

const baseEvent: CanonicalCRMEvent = {
  event_id: 'test-uuid-1234',
  event_name: 'Lead Created',
  event_time: 1700000000,
  lead_id: 'lead-001',
  advertiser_id: 'adv-001',
  campaign_id: 'camp-001',
  ad_id: 'ad-001',
  user: {
    email: 'test@example.com',
    phone: '+14155551234',
    first_name: 'John',
    last_name: 'Doe',
    external_id: 'ext-123',
    ttclid: 'tiktok-click-abc',
  },
  direction: 'inbound',
};

describe('buildKlaviyoEvent', () => {
  it('builds correct JSON:API structure', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    expect(payload.data).toBeDefined();
    expect(payload.data.type).toBe('event');
    expect(payload.data.attributes).toBeDefined();
  });

  it('sets metric name correctly', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    expect(payload.data.attributes.metric.data.attributes.name).toBe('Lead Created');
  });

  it('sets profile attributes without hashing', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    const attrs = payload.data.attributes.profile.data.attributes;
    expect(attrs.email).toBe('test@example.com');
    expect(attrs.phone_number).toBe('+14155551234');
    expect(attrs.first_name).toBe('John');
    expect(attrs.last_name).toBe('Doe');
  });

  it('sets unique_id from event_id', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    expect(payload.data.attributes.unique_id).toBe('test-uuid-1234');
  });

  it('converts event_time to ISO 8601', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    expect(payload.data.attributes.time).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('includes lead_id in properties', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    expect(payload.data.attributes.properties['lead_id']).toBe('lead-001');
  });

  it('includes advertiser_id in properties', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    expect(payload.data.attributes.properties['advertiser_id']).toBe('adv-001');
  });

  it('includes campaign_id in properties', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    expect(payload.data.attributes.properties['campaign_id']).toBe('camp-001');
  });

  it('handles event with no email gracefully', () => {
    const event: CanonicalCRMEvent = {
      ...baseEvent,
      user: { phone: '+14155551234' },
    };
    const payload = buildKlaviyoEvent(event);
    expect(payload.data.attributes.profile.data.attributes.email).toBeUndefined();
    expect(payload.data.attributes.profile.data.attributes.phone_number).toBe('+14155551234');
  });

  it('handles event with no phone gracefully', () => {
    const event: CanonicalCRMEvent = {
      ...baseEvent,
      user: { email: 'test@example.com' },
    };
    const payload = buildKlaviyoEvent(event);
    expect(payload.data.attributes.profile.data.attributes.phone_number).toBeUndefined();
  });

  it('stores ttclid in profile properties', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    const profileProps = payload.data.attributes.profile.data.attributes.properties;
    expect(profileProps?.['ttclid']).toBe('tiktok-click-abc');
  });

  it('sets profile type correctly', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    expect(payload.data.attributes.profile.data.type).toBe('profile');
  });

  it('sets metric type correctly', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    expect(payload.data.attributes.metric.data.type).toBe('metric');
  });

  it('includes external_id in profile attributes', () => {
    const payload = buildKlaviyoEvent(baseEvent);
    expect(payload.data.attributes.profile.data.attributes.external_id).toBe('ext-123');
  });

  it('handles outbound event (different metric name)', () => {
    const outboundEvent: CanonicalCRMEvent = {
      ...baseEvent,
      event_name: 'Deal Won',
      direction: 'outbound',
    };
    const payload = buildKlaviyoEvent(outboundEvent);
    expect(payload.data.attributes.metric.data.attributes.name).toBe('Deal Won');
  });
});
