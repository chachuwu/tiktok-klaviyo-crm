import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import { TikTokLeadWebhookPayload } from '../types';
import { logger } from '../logging/logger';
import { InboundPipeline } from '../inbound-pipeline';

/**
 * Verifies a TikTok Lead Gen webhook signature.
 * TikTok signs webhooks with HMAC-SHA256(secret, timestamp + nonce + body).
 * The signature is delivered in the X-TikTok-Signature header.
 */
function verifyTikTokSignature(
  secret: string,
  signature: string,
  timestamp: string,
  nonce: string,
  rawBody: Buffer
): boolean {
  try {
    // TikTok signature: HMAC-SHA256 of concatenated timestamp + nonce + body
    const message = timestamp + nonce + rawBody.toString('utf8');
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(message, 'utf8')
      .digest('hex');

    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (sigBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function createTikTokLeadWebhookRouter(
  inboundPipeline: InboundPipeline,
  webhookSecret: string
): Router {
  const router = Router();

  /**
   * POST /webhooks/tiktok/leads
   * Receives TikTok Lead Generation webhook events.
   */
  router.post('/', express.raw({ type: '*/*' }), (req: Request, res: Response) => {
    // Get signature headers
    const signature = req.headers['x-tiktok-signature'] as string | undefined;
    const timestamp = req.headers['x-tiktok-timestamp'] as string | undefined;
    const nonce = req.headers['x-tiktok-nonce'] as string | undefined;

    if (!signature || !timestamp || !nonce) {
      logger.warn(
        { signature: !!signature, timestamp: !!timestamp, nonce: !!nonce },
        'TikTok webhook missing signature headers'
      );
      return res.status(401).json({ error: 'Missing signature headers' });
    }

    const rawBody = req.body as Buffer;

    if (!verifyTikTokSignature(webhookSecret, signature, timestamp, nonce, rawBody)) {
      logger.warn('TikTok webhook signature verification failed');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Parse body
    let payload: TikTokLeadWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as TikTokLeadWebhookPayload;
    } catch (err) {
      logger.error({ err }, 'Failed to parse TikTok webhook payload');
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    // Respond 200 immediately, process asynchronously
    res.status(200).json({ received: true });

    // Async processing
    inboundPipeline.process(payload).catch((err: unknown) => {
      logger.error({ err, lead_id: payload.lead_id }, 'Inbound pipeline error');
    });

    return;
  });

  return router;
}
