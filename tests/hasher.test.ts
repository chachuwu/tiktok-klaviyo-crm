import { sha256, hashUser, generateEventId } from '../src/normalization/hasher';
import { CanonicalUser } from '../src/types';

describe('sha256', () => {
  it('produces consistent output for same input', () => {
    const result1 = sha256('test@example.com');
    const result2 = sha256('test@example.com');
    expect(result1).toBe(result2);
  });

  it('produces different output for different input', () => {
    const result1 = sha256('test@example.com');
    const result2 = sha256('other@example.com');
    expect(result1).not.toBe(result2);
  });

  it('produces 64-character hex string', () => {
    const result = sha256('test');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[a-f0-9]+$/);
  });

  it('matches known SHA-256 hash', () => {
    // echo -n "abc" | sha256sum = ba7816bf8f01cfea414140de5dae2ec73b00361bbef0469f492c5e6a8f8dc3d5
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2ec73b00361bbef0469f492c5e6a8f8dc3d5');
  });
});

describe('hashUser', () => {
  const testUser: CanonicalUser = {
    email: 'test@example.com',
    phone: '+14155551234',
    first_name: 'John',
    last_name: 'Doe',
    external_id: 'ext-123',
    ttclid: 'tiktok-click-id-abc',
    ip: '192.168.1.1',
    user_agent: 'Mozilla/5.0',
    tiktok_lead_id: 'lead-456',
  };

  it('hashes email field', () => {
    const hashed = hashUser(testUser);
    expect(hashed.email).not.toBe(testUser.email);
    expect(hashed.email).toHaveLength(64);
  });

  it('hashes phone_number field', () => {
    const hashed = hashUser(testUser);
    expect(hashed.phone_number).not.toBe(testUser.phone);
    expect(hashed.phone_number).toHaveLength(64);
  });

  it('hashes first_name field', () => {
    const hashed = hashUser(testUser);
    expect(hashed.first_name).not.toBe(testUser.first_name);
    expect(hashed.first_name).toHaveLength(64);
  });

  it('hashes last_name field', () => {
    const hashed = hashUser(testUser);
    expect(hashed.last_name).not.toBe(testUser.last_name);
    expect(hashed.last_name).toHaveLength(64);
  });

  it('hashes external_id field', () => {
    const hashed = hashUser(testUser);
    expect(hashed.external_id).not.toBe(testUser.external_id);
    expect(hashed.external_id).toHaveLength(64);
  });

  it('does NOT hash ttclid', () => {
    const hashed = hashUser(testUser);
    expect(hashed.ttclid).toBe(testUser.ttclid);
  });

  it('does NOT hash ip', () => {
    const hashed = hashUser(testUser);
    expect(hashed.ip).toBe(testUser.ip);
  });

  it('does NOT hash user_agent', () => {
    const hashed = hashUser(testUser);
    expect(hashed.user_agent).toBe(testUser.user_agent);
  });

  it('maps tiktok_lead_id to lead_id plaintext', () => {
    const hashed = hashUser(testUser);
    expect(hashed.lead_id).toBe(testUser.tiktok_lead_id);
  });

  it('handles user with no PII fields', () => {
    const emptyUser: CanonicalUser = { ttclid: 'abc' };
    const hashed = hashUser(emptyUser);
    expect(hashed.email).toBeUndefined();
    expect(hashed.phone_number).toBeUndefined();
    expect(hashed.ttclid).toBe('abc');
  });
});

describe('generateEventId', () => {
  it('generates consistent deterministic ID for same inputs', () => {
    const id1 = generateEventId('lead-123', 'Purchase', 1700000000);
    const id2 = generateEventId('lead-123', 'Purchase', 1700000000);
    expect(id1).toBe(id2);
  });

  it('differs with different leadId', () => {
    const id1 = generateEventId('lead-123', 'Purchase', 1700000000);
    const id2 = generateEventId('lead-456', 'Purchase', 1700000000);
    expect(id1).not.toBe(id2);
  });

  it('differs with different eventName', () => {
    const id1 = generateEventId('lead-123', 'Purchase', 1700000000);
    const id2 = generateEventId('lead-123', 'Contact', 1700000000);
    expect(id1).not.toBe(id2);
  });

  it('differs with different eventTime', () => {
    const id1 = generateEventId('lead-123', 'Purchase', 1700000000);
    const id2 = generateEventId('lead-123', 'Purchase', 1700000001);
    expect(id1).not.toBe(id2);
  });
});
