import {
  enrichFromKlaviyoProfile,
  enrichFromTikTokLead,
} from '../src/enrichment/identity-enrichment';
import { KlaviyoProfileAttributes, TikTokLeadWebhookPayload } from '../src/types';

describe('enrichFromKlaviyoProfile', () => {
  it('extracts all standard fields', () => {
    const profile: KlaviyoProfileAttributes = {
      email: 'test@example.com',
      phone_number: '+14155551234',
      first_name: 'John',
      last_name: 'Doe',
      external_id: 'ext-123',
    };
    const user = enrichFromKlaviyoProfile(profile);
    expect(user.email).toBe('test@example.com');
    expect(user.phone).toBe('+14155551234');
    expect(user.first_name).toBe('John');
    expect(user.last_name).toBe('Doe');
    expect(user.external_id).toBe('ext-123');
  });

  it('checks properties for ttclid', () => {
    const profile: KlaviyoProfileAttributes = {
      email: 'test@example.com',
      properties: { ttclid: 'tiktok-click-abc' },
    };
    const user = enrichFromKlaviyoProfile(profile);
    expect(user.ttclid).toBe('tiktok-click-abc');
  });

  it('checks properties for ip_address', () => {
    const profile: KlaviyoProfileAttributes = {
      properties: { ip_address: '192.168.1.1' },
    };
    const user = enrichFromKlaviyoProfile(profile);
    expect(user.ip).toBe('192.168.1.1');
  });

  it('checks properties for user_agent', () => {
    const profile: KlaviyoProfileAttributes = {
      properties: { user_agent: 'Mozilla/5.0' },
    };
    const user = enrichFromKlaviyoProfile(profile);
    expect(user.user_agent).toBe('Mozilla/5.0');
  });

  it('checks properties for tiktok_lead_id', () => {
    const profile: KlaviyoProfileAttributes = {
      properties: { tiktok_lead_id: 'lead-789' },
    };
    const user = enrichFromKlaviyoProfile(profile);
    expect(user.tiktok_lead_id).toBe('lead-789');
  });

  it('handles profile with no optional fields', () => {
    const profile: KlaviyoProfileAttributes = {};
    const user = enrichFromKlaviyoProfile(profile);
    expect(user.email).toBeUndefined();
    expect(user.phone).toBeUndefined();
    expect(user.ttclid).toBeUndefined();
  });

  it('ignores non-string properties', () => {
    const profile: KlaviyoProfileAttributes = {
      properties: { ttclid: 123 as unknown as string },
    };
    const user = enrichFromKlaviyoProfile(profile);
    expect(user.ttclid).toBeUndefined();
  });
});

describe('enrichFromTikTokLead', () => {
  const basePayload: TikTokLeadWebhookPayload = {
    advertiser_id: 'adv-001',
    form_id: 'form-001',
    lead_id: 'lead-001',
    ad_id: 'ad-001',
    adgroup_id: 'adgrp-001',
    campaign_id: 'camp-001',
    create_time: 1700000000,
    field_data: [],
  };

  it('sets tiktok_lead_id from payload.lead_id', () => {
    const user = enrichFromTikTokLead(basePayload);
    expect(user.tiktok_lead_id).toBe('lead-001');
  });

  it('parses email field', () => {
    const payload = {
      ...basePayload,
      field_data: [{ name: 'email', values: ['test@example.com'] }],
    };
    const user = enrichFromTikTokLead(payload);
    expect(user.email).toBe('test@example.com');
  });

  it('parses phone_number field', () => {
    const payload = {
      ...basePayload,
      field_data: [{ name: 'phone_number', values: ['+14155551234'] }],
    };
    const user = enrichFromTikTokLead(payload);
    expect(user.phone).toBe('+14155551234');
  });

  it('parses full_name and splits into first/last', () => {
    const payload = {
      ...basePayload,
      field_data: [{ name: 'full_name', values: ['John Doe'] }],
    };
    const user = enrichFromTikTokLead(payload);
    expect(user.first_name).toBe('John');
    expect(user.last_name).toBe('Doe');
  });

  it('parses separate first_name and last_name fields', () => {
    const payload = {
      ...basePayload,
      field_data: [
        { name: 'first_name', values: ['Jane'] },
        { name: 'last_name', values: ['Smith'] },
      ],
    };
    const user = enrichFromTikTokLead(payload);
    expect(user.first_name).toBe('Jane');
    expect(user.last_name).toBe('Smith');
  });

  it('handles missing field_data gracefully', () => {
    const payload = { ...basePayload, field_data: [] };
    const user = enrichFromTikTokLead(payload);
    expect(user.email).toBeUndefined();
    expect(user.phone).toBeUndefined();
    expect(user.tiktok_lead_id).toBe('lead-001');
  });

  it('handles empty values array', () => {
    const payload = {
      ...basePayload,
      field_data: [{ name: 'email', values: [] }],
    };
    const user = enrichFromTikTokLead(payload);
    expect(user.email).toBeUndefined();
  });

  it('parses all fields together', () => {
    const payload = {
      ...basePayload,
      field_data: [
        { name: 'email', values: ['user@test.com'] },
        { name: 'phone_number', values: ['4155551234'] },
        { name: 'first_name', values: ['Alice'] },
        { name: 'last_name', values: ['Wonder'] },
      ],
    };
    const user = enrichFromTikTokLead(payload);
    expect(user.email).toBe('user@test.com');
    expect(user.phone).toBe('4155551234');
    expect(user.first_name).toBe('Alice');
    expect(user.last_name).toBe('Wonder');
  });
});
