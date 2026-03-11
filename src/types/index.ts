// TikTok Lead Generation webhook types
export interface TikTokLeadWebhookPayload {
  advertiser_id: string;
  form_id: string;
  lead_id: string;
  ad_id: string;
  adgroup_id: string;
  campaign_id: string;
  create_time: number; // Unix timestamp
  field_data: TikTokLeadField[];
}

export interface TikTokLeadField {
  name: string; // e.g. "email", "phone_number", "full_name", "first_name", "last_name"
  values: string[];
}

// Klaviyo webhook types (for outbound pipeline)
export interface KlaviyoWebhookEvent {
  type: string; // "event"
  id: string;
  attributes: {
    metric: { name: string };
    profile: {
      data: {
        attributes: KlaviyoProfileAttributes;
      };
    };
    properties: Record<string, unknown>;
    time: string; // ISO 8601
    unique_id: string;
    value?: number;
  };
}

export interface KlaviyoProfileAttributes {
  email?: string;
  phone_number?: string;
  first_name?: string;
  last_name?: string;
  external_id?: string;
  properties?: Record<string, unknown>;
}

// Canonical event (internal format, pipeline-neutral)
export interface CanonicalCRMEvent {
  event_id: string; // deterministic SHA-256 for outbound, UUID for inbound
  event_name: string; // TikTok standard event name (outbound) or Klaviyo metric name (inbound)
  event_time: number; // Unix seconds
  lead_id?: string; // TikTok lead_id if available
  advertiser_id?: string;
  campaign_id?: string;
  ad_id?: string;
  user: CanonicalUser;
  direction: 'inbound' | 'outbound';
}

export interface CanonicalUser {
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  external_id?: string;
  ip?: string;
  user_agent?: string;
  ttclid?: string;
  tiktok_lead_id?: string;
}

// TikTok CRM Events API types (outbound)
export type TikTokStandardEvent =
  | 'SubmitForm'
  | 'Contact'
  | 'Schedule'
  | 'CompleteRegistration'
  | 'SubmitApplication'
  | 'Purchase'
  | 'ApplicationApproval'
  | 'Subscribe'
  | 'StartTrial';

export type DFOFunnelStage = 1 | 2 | 3 | 4;

export const EVENT_TO_DFO_STAGE: Record<TikTokStandardEvent, DFOFunnelStage> = {
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

export interface TikTokUserData {
  lead_id?: string;
  email?: string;
  phone_number?: string;
  external_id?: string;
  ttclid?: string;
  ip?: string;
  user_agent?: string;
  first_name?: string;
  last_name?: string;
}

export interface TikTokEventProperties {
  lead_status?: string;
  source?: string;
  campaign_id?: string;
  integration_version?: string;
  dfo_stage?: DFOFunnelStage;
  value?: number;
  currency?: string;
}

export interface TikTokEventData {
  event: TikTokStandardEvent;
  event_time: number;
  event_id: string;
  user: TikTokUserData;
  properties: TikTokEventProperties;
}

export interface TikTokEventsPayload {
  event_source: 'crm';
  event_source_id: string;
  data: TikTokEventData[];
}

export interface TikTokAPIResponse {
  code: number;
  message: string;
  request_id: string;
  data?: {
    batch_upload_status?: Array<{ event_id: string; status: string }>;
  };
}

// Klaviyo API types (inbound)
export interface KlaviyoEventPayload {
  data: {
    type: 'event';
    attributes: {
      metric: {
        data: {
          type: 'metric';
          attributes: { name: string };
        };
      };
      profile: {
        data: {
          type: 'profile';
          attributes: KlaviyoProfileAttributes;
        };
      };
      unique_id: string;
      time: string; // ISO 8601
      value?: number;
      properties: Record<string, unknown>;
    };
  };
}

// OAuth token types (for TikTok)
export interface StoredToken {
  id: string;
  advertiser_id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: Date;
  refresh_token_expires_at: Date;
  scope: string;
  created_at: Date;
  updated_at: Date;
}

export interface ActiveToken {
  access_token: string;
  advertiser_id: string;
  expires_at: Date;
}

export interface OAuthState {
  csrf_token: string;
  redirect_after?: string;
  created_at: number;
}

// Event log
export type EventDirection = 'inbound' | 'outbound';
export type EventStatus = 'pending' | 'sent' | 'failed' | 'duplicate';

export interface EventLogRecord {
  id: string;
  event_id: string;
  event_name: string;
  lead_id?: string;
  direction: EventDirection;
  source_payload: Record<string, unknown>;
  destination_payload: Record<string, unknown>;
  status: EventStatus;
  destination_response?: Record<string, unknown>;
  attempt_count: number;
  error?: string;
  created_at: Date;
  updated_at: Date;
}

// Event filter result
export interface FilterResult {
  shouldProcess: boolean;
  reason: string;
  tiktokEvent?: TikTokStandardEvent;
  klaviyoMetric?: string;
  dfoStage?: DFOFunnelStage;
}
