import { KlaviyoProfileAttributes, TikTokLeadWebhookPayload, CanonicalUser } from '../types';
import { parseFullName } from '../normalization/normalizer';

/**
 * Builds a CanonicalUser from a Klaviyo profile's attributes.
 * Checks profile.properties for additional CRM-specific fields.
 */
export function enrichFromKlaviyoProfile(profile: KlaviyoProfileAttributes): CanonicalUser {
  const user: CanonicalUser = {};

  if (profile.email) {
    user.email = profile.email;
  }

  if (profile.phone_number) {
    user.phone = profile.phone_number;
  }

  if (profile.first_name) {
    user.first_name = profile.first_name;
  }

  if (profile.last_name) {
    user.last_name = profile.last_name;
  }

  if (profile.external_id) {
    user.external_id = profile.external_id;
  }

  // Check nested properties for additional tracking fields
  if (profile.properties && typeof profile.properties === 'object') {
    const props = profile.properties as Record<string, unknown>;

    if (typeof props['ttclid'] === 'string' && props['ttclid']) {
      user.ttclid = props['ttclid'];
    }

    if (typeof props['ip_address'] === 'string' && props['ip_address']) {
      user.ip = props['ip_address'];
    }

    if (typeof props['user_agent'] === 'string' && props['user_agent']) {
      user.user_agent = props['user_agent'];
    }

    if (typeof props['tiktok_lead_id'] === 'string' && props['tiktok_lead_id']) {
      user.tiktok_lead_id = props['tiktok_lead_id'];
    }
  }

  return user;
}

/**
 * Builds a CanonicalUser from a TikTok Lead Gen webhook payload.
 * Parses field_data array for email, phone, name fields.
 */
export function enrichFromTikTokLead(payload: TikTokLeadWebhookPayload): CanonicalUser {
  const user: CanonicalUser = {};

  // Always set tiktok_lead_id from the webhook payload
  if (payload.lead_id) {
    user.tiktok_lead_id = payload.lead_id;
  }

  // Parse field_data array
  for (const field of payload.field_data) {
    const value = field.values && field.values.length > 0 ? field.values[0] : '';

    if (!value) continue;

    const fieldName = field.name.toLowerCase().trim();

    switch (fieldName) {
      case 'email':
        user.email = value;
        break;

      case 'phone_number':
      case 'phone':
        user.phone = value;
        break;

      case 'full_name': {
        const { first_name, last_name } = parseFullName(value);
        if (first_name) user.first_name = first_name;
        if (last_name) user.last_name = last_name;
        break;
      }

      case 'first_name':
        user.first_name = value;
        break;

      case 'last_name':
        user.last_name = value;
        break;

      default:
        // Ignore unknown fields
        break;
    }
  }

  return user;
}
