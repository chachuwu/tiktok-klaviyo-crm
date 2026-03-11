import crypto from 'crypto';
import { CanonicalUser } from '../types';
import { normalizeEmail, normalizePhone, normalizeName } from './normalizer';

export interface HashedUser {
  email?: string;
  phone_number?: string;
  first_name?: string;
  last_name?: string;
  external_id?: string;
  lead_id?: string;
  ttclid?: string;
  ip?: string;
  user_agent?: string;
}

/**
 * Computes SHA-256 hex hash of the given string value.
 */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Hashes PII fields in a CanonicalUser for TikTok API submission.
 * Hashed fields: email, phone, first_name, last_name, external_id
 * Plaintext fields: ttclid, ip, user_agent, tiktok_lead_id (lead_id)
 */
export function hashUser(user: CanonicalUser): HashedUser {
  const hashed: HashedUser = {};

  if (user.email) {
    const normalized = normalizeEmail(user.email);
    if (normalized) {
      hashed.email = sha256(normalized);
    }
  }

  if (user.phone) {
    const normalized = normalizePhone(user.phone);
    if (normalized) {
      hashed.phone_number = sha256(normalized);
    }
  }

  if (user.first_name) {
    const normalized = normalizeName(user.first_name);
    if (normalized) {
      hashed.first_name = sha256(normalized);
    }
  }

  if (user.last_name) {
    const normalized = normalizeName(user.last_name);
    if (normalized) {
      hashed.last_name = sha256(normalized);
    }
  }

  if (user.external_id) {
    hashed.external_id = sha256(user.external_id);
  }

  // Plaintext fields — do not hash
  if (user.tiktok_lead_id) {
    hashed.lead_id = user.tiktok_lead_id;
  }

  if (user.ttclid) {
    hashed.ttclid = user.ttclid;
  }

  if (user.ip) {
    hashed.ip = user.ip;
  }

  if (user.user_agent) {
    hashed.user_agent = user.user_agent;
  }

  return hashed;
}

/**
 * Generates a deterministic SHA-256 event ID from leadId, eventName, and eventTime.
 * Used for outbound deduplication.
 */
export function generateEventId(leadId: string, eventName: string, eventTime: number): string {
  const input = `${leadId}:${eventName}:${eventTime}`;
  return sha256(input);
}
