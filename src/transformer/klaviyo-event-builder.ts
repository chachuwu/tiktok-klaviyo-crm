import { CanonicalCRMEvent, KlaviyoEventPayload, KlaviyoProfileAttributes } from '../types';

/**
 * Builds a Klaviyo JSON:API event payload from a canonical CRM event.
 * PII is NOT hashed — Klaviyo stores and uses actual values.
 */
export function buildKlaviyoEvent(event: CanonicalCRMEvent): KlaviyoEventPayload {
  const profileAttributes: KlaviyoProfileAttributes = {};

  if (event.user.email) {
    profileAttributes.email = event.user.email;
  }

  if (event.user.phone) {
    profileAttributes.phone_number = event.user.phone;
  }

  if (event.user.first_name) {
    profileAttributes.first_name = event.user.first_name;
  }

  if (event.user.last_name) {
    profileAttributes.last_name = event.user.last_name;
  }

  if (event.user.external_id) {
    profileAttributes.external_id = event.user.external_id;
  }

  // Store TikTok-specific identifiers in profile properties
  const profileProperties: Record<string, unknown> = {};
  if (event.user.ttclid) profileProperties['ttclid'] = event.user.ttclid;
  if (event.user.ip) profileProperties['ip_address'] = event.user.ip;
  if (event.user.user_agent) profileProperties['user_agent'] = event.user.user_agent;
  if (event.user.tiktok_lead_id) profileProperties['tiktok_lead_id'] = event.user.tiktok_lead_id;
  if (Object.keys(profileProperties).length > 0) {
    profileAttributes.properties = profileProperties;
  }

  // Build event properties
  const properties: Record<string, unknown> = {
    integration_version: process.env['INTEGRATION_VERSION'] ?? '1.0.0',
  };

  if (event.lead_id) properties['lead_id'] = event.lead_id;
  if (event.advertiser_id) properties['advertiser_id'] = event.advertiser_id;
  if (event.campaign_id) properties['campaign_id'] = event.campaign_id;
  if (event.ad_id) properties['ad_id'] = event.ad_id;

  // Convert Unix seconds to ISO 8601
  const eventTimeIso = new Date(event.event_time * 1000).toISOString();

  return {
    data: {
      type: 'event',
      attributes: {
        metric: {
          data: {
            type: 'metric',
            attributes: {
              name: event.event_name,
            },
          },
        },
        profile: {
          data: {
            type: 'profile',
            attributes: profileAttributes,
          },
        },
        unique_id: event.event_id,
        time: eventTimeIso,
        properties,
      },
    },
  };
}
