import { TikTokStandardEvent, FilterResult, EVENT_TO_DFO_STAGE } from '../types';

// Comprehensive mapping of Klaviyo metric names (lowercase) to TikTok standard events
const METRIC_TO_TIKTOK_EVENT: Record<string, TikTokStandardEvent> = {
  // Stage 1 — SubmitForm
  'lead created': 'SubmitForm',
  'new lead': 'SubmitForm',
  'form submitted': 'SubmitForm',
  'lead submitted': 'SubmitForm',

  // Stage 2 — Contact
  'lead contacted': 'Contact',
  contacted: 'Contact',
  'lead contact': 'Contact',

  // Stage 2 — Schedule
  'demo scheduled': 'Schedule',
  'meeting scheduled': 'Schedule',
  'appointment scheduled': 'Schedule',
  'call scheduled': 'Schedule',
  'discovery call scheduled': 'Schedule',

  // Stage 3 — CompleteRegistration
  'lead qualified': 'CompleteRegistration',
  qualified: 'CompleteRegistration',
  mql: 'CompleteRegistration',
  'marketing qualified lead': 'CompleteRegistration',

  // Stage 3 — SubmitApplication
  'opportunity created': 'SubmitApplication',
  sql: 'SubmitApplication',
  'sales qualified lead': 'SubmitApplication',
  'proposal sent': 'SubmitApplication',

  // Stage 4 — Purchase
  'deal won': 'Purchase',
  'closed won': 'Purchase',
  converted: 'Purchase',
  customer: 'Purchase',

  // Stage 4 — ApplicationApproval
  'application approved': 'ApplicationApproval',
  approved: 'ApplicationApproval',
  'credit approved': 'ApplicationApproval',

  // Stage 4 — Subscribe
  'subscription started': 'Subscribe',
  subscribed: 'Subscribe',

  // Stage 4 — StartTrial
  'trial started': 'StartTrial',
  'free trial': 'StartTrial',
  trial: 'StartTrial',
};

// Valid TikTok standard events that can be created as Klaviyo metrics
const VALID_TIKTOK_EVENTS: Set<string> = new Set<TikTokStandardEvent>([
  'SubmitForm',
  'Contact',
  'Schedule',
  'CompleteRegistration',
  'SubmitApplication',
  'Purchase',
  'ApplicationApproval',
  'Subscribe',
  'StartTrial',
]);

/**
 * Filters an outbound event by mapping a Klaviyo metric name to a TikTok standard event.
 * Case-insensitive lookup.
 */
export function filterOutboundEvent(metricName: string): FilterResult {
  if (!metricName || !metricName.trim()) {
    return {
      shouldProcess: false,
      reason: 'Empty metric name',
    };
  }

  const normalized = metricName.trim().toLowerCase();
  const tiktokEvent = METRIC_TO_TIKTOK_EVENT[normalized];

  if (!tiktokEvent) {
    return {
      shouldProcess: false,
      reason: `No TikTok event mapping found for Klaviyo metric: "${metricName}"`,
    };
  }

  const dfoStage = EVENT_TO_DFO_STAGE[tiktokEvent];

  return {
    shouldProcess: true,
    reason: `Mapped "${metricName}" to TikTok event "${tiktokEvent}" (DFO stage ${dfoStage})`,
    tiktokEvent,
    dfoStage,
  };
}

/**
 * Filters an inbound event by checking if the TikTok event type is valid
 * for creating a Klaviyo metric.
 */
export function filterInboundEvent(tiktokEvent: string): FilterResult {
  if (!tiktokEvent || !tiktokEvent.trim()) {
    return {
      shouldProcess: false,
      reason: 'Empty TikTok event type',
    };
  }

  if (VALID_TIKTOK_EVENTS.has(tiktokEvent)) {
    return {
      shouldProcess: true,
      reason: `TikTok event "${tiktokEvent}" is valid for Klaviyo metric creation`,
      klaviyoMetric: tiktokEvent,
    };
  }

  return {
    shouldProcess: false,
    reason: `TikTok event "${tiktokEvent}" is not a recognized standard event`,
  };
}
