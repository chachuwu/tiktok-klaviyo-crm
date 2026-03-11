import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import express from 'express';
import { KlaviyoWebhookEvent } from '../types';
import { logger } from '../logging/logger';
import { OutboundPipeline } from '../outbound-pipeline';

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

      // Parse body
      let events: KlaviyoWebhookEvent[];
      try {
        const parsed: unknown = JSON.parse(rawBody.toString('utf8'));

        // Klaviyo may send a single event or an array
        if (Array.isArray(parsed)) {
          events = parsed as KlaviyoWebhookEvent[];
        } else if (parsed && typeof parsed === 'object' && 'type' in parsed) {
          events = [parsed as KlaviyoWebhookEvent];
        } else if (parsed && typeof parsed === 'object' && 'data' in parsed) {
          // Wrapped format: { data: { type: "event", ... } }
          const wrapped = parsed as { data: KlaviyoWebhookEvent };
          events = [wrapped.data];
        } else {
          logger.error('Unexpected Klaviyo webhook payload format');
          return res.status(400).json({ error: 'Unexpected payload format' });
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
