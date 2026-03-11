import {
  CanonicalCRMEvent,
  TikTokEventsPayload,
  TikTokEventData,
  TikTokUserData,
  TikTokEventProperties,
  TikTokStandardEvent,
  EVENT_TO_DFO_STAGE,
} from '../types';
import { hashUser } from '../normalization/hasher';

/**
 * Builds a TikTok CRM Events API payload from a canonical CRM event.
 * PII fields are SHA-256 hashed before being sent to TikTok.
 */
export function buildTikTokPayload(
  event: CanonicalCRMEvent,
  tiktokEvent: TikTokStandardEvent,
  eventSetId: string
): TikTokEventsPayload {
  // Hash PII fields
  const hashedUser = hashUser(event.user);

  // Build TikTok user data with hashed PII + plaintext non-PII
  const userData: TikTokUserData = {};

  if (hashedUser.email) userData.email = hashedUser.email;
  if (hashedUser.phone_number) userData.phone_number = hashedUser.phone_number;
  if (hashedUser.first_name) userData.first_name = hashedUser.first_name;
  if (hashedUser.last_name) userData.last_name = hashedUser.last_name;
  if (hashedUser.external_id) userData.external_id = hashedUser.external_id;

  // Plaintext fields — not hashed
  if (hashedUser.lead_id) userData.lead_id = hashedUser.lead_id;
  if (hashedUser.ttclid) userData.ttclid = hashedUser.ttclid;
  if (hashedUser.ip) userData.ip = hashedUser.ip;
  if (hashedUser.user_agent) userData.user_agent = hashedUser.user_agent;

  // Build event properties
  const dfoStage = EVENT_TO_DFO_STAGE[tiktokEvent];
  const properties: TikTokEventProperties = {
    dfo_stage: dfoStage,
    integration_version: process.env['INTEGRATION_VERSION'] ?? '1.0.0',
    source: 'klaviyo_crm',
  };

  if (event.campaign_id) properties.campaign_id = event.campaign_id;

  // Add value and currency for Purchase events
  if (tiktokEvent === 'Purchase') {
    properties.value = 0;
    properties.currency = 'USD';
  }

  const eventData: TikTokEventData = {
    event: tiktokEvent,
    event_time: event.event_time,
    event_id: event.event_id,
    user: userData,
    properties,
  };

  return {
    event_source: 'crm',
    event_source_id: eventSetId,
    data: [eventData],
  };
}
