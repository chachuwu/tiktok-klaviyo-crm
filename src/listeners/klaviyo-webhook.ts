import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import express from 'express';
import { z } from 'zod';
import { KlaviyoWebhookEvent } from '../types';
import { logger } from '../logging/logger';
import { OutboundPipeline } from '../outbound-pipeline';

const KlaviyoProfileAttributesSchema = z.object({
  email: z.string().optional(),
  phone_number: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  external_id: z.string().optional(),
  properties: z.record(z.unknown()).optional(),
});

const KlaviyoWebhookEventSchema = z.object({
  type: z.string(),
  id: z.string().min(1),
  attributes: z.object({
    metric: z.object({ name: z.string().min(1) }),
    profile: z.object({
      data: z.object({ attributes: KlaviyoProfileAttributesSchema }),
    }),
    properties: z.record(z.unknown()),
    time: z.string().min(1),
    unique_id: z.string().min(1),
    value: z.number().optional(),
  }),
});

/**
 * Verifies a Klaviyo webhook signature.
 * Klaviyo signs webhooks with HMAC-SHA256 using the webhook secret.
 * The signature is base64-encoded in the X-Klaviyo-Signature header.
 */
function verifyKlaviyoSignature(secret: string, signature: string, rawBody: Buffer): boolean {
  try {
    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('base64');

    const sigBuffer = Buffer.from(signature, 'base64');
    const expectedBuffer = Buffer.from(expectedHmac, 'base64');

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function createKlaviyoWebhookRouter(
  outboundPipeline: OutboundPipeline,
  webhookSecret: string
): Router {
  const router = Router();

  /**
   * POST /webhooks/klaviyo/events
   * Receives Klaviyo metric/event webhooks for the outbound pipeline.
   * Uses raw body middleware for signature verification.
   */
  router.post(
    '/',
    express.raw({ type: 'application/json' }),
    (req: Request, res: Response) => {
      const signature = req.headers['x-klaviyo-signature'] as string | undefined;

      if (!signature) {
        logger.warn('Klaviyo webhook missing X-Klaviyo-Signature header');
        return res.status(401).json({ error: 'Missing signature header' });
      }

      const rawBody = req.body as Buffer;

      if (!verifyKlaviyoSignature(webhookSecret, signature, rawBody)) {
        logger.warn('Klaviyo webhook signature verification failed');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Parse and validate body
      let events: KlaviyoWebhookEvent[];
      try {
        const parsed: unknown = JSON.parse(rawBody.toString('utf8'));

        // Klaviyo may send a single event or an array
        let rawEvents: unknown[];
        if (Array.isArray(parsed)) {
          rawEvents = parsed;
        } else if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          rawEvents = [parsed];
        } else if (parsed && typeof parsed === 'object' && 'data' in parsed) {
          // Wrapped format: { data: { type: "event", ... } }
          rawEvents = [(parsed as { data: unknown }).data];
        } else {
          logger.error('Unexpected Klaviyo webhook payload format');
          return res.status(400).json({ error: 'Unexpected payload format' });
        }

        // Validate each event against the schema
        events = [];
        for (const raw of rawEvents) {
          const result = KlaviyoWebhookEventSchema.safeParse(raw);
          if (!result.success) {
            logger.error({ errors: result.error.errors }, 'Klaviyo webhook event failed schema validation');
            return res.status(400).json({ error: 'Invalid event schema', details: result.error.errors });
          }
          events.push(result.data as KlaviyoWebhookEvent);
        }
      } catch (err) {
        logger.error({ err }, 'Failed to parse Klaviyo webhook payload');
        return res.status(400).json({ error: 'Invalid JSON payload' });
      }

      // Respond 200 immediately
      res.status(200).json({ received: true, event_count: events.length });

      // Process each event asynchronously
      for (const event of events) {
        outboundPipeline.process(event).catch((err: unknown) => {
          logger.error({ err, event_id: event.id }, 'Outbound pipeline error');
        });
      }

      return;
    }
  );

  return router;
}
