import { Router, Request, Response } from 'express';
import { CRMEventSetManager } from './crm-event-set-manager';
import { TokenStore } from '../tiktok-auth/token-store';
import { logger } from '../logging/logger';

export function createEventSetRouter(
  eventSetManager: CRMEventSetManager,
  tokenStore: TokenStore
): Router {
  const router = Router();

  /**
   * POST /event-sets/:advertiserId/provision
   * Auto-provisions a CRM event set for the advertiser.
   */
  router.post('/:advertiserId/provision', async (req: Request, res: Response) => {
    try {
      const { advertiserId } = req.params;
      const tokenRecord = await tokenStore.get(advertiserId);

      if (!tokenRecord) {
        return res.status(404).json({
          error: `No OAuth token found for advertiser: ${advertiserId}. Please authorize first.`,
        });
      }

      const result = await eventSetManager.provision(advertiserId, tokenRecord.access_token);

      if (result.status === 'error') {
        return res.status(500).json({ error: result.error });
      }

      if (result.status === 'multiple_found') {
        return res.status(409).json({
          message: 'Multiple event sets found. Please select one manually.',
          event_sets: result.data,
        });
      }

      return res.json({
        status: result.status,
        data: result.data,
      });
    } catch (err) {
      logger.error({ err, advertiserId: req.params['advertiserId'] }, 'Event set provisioning failed');
      return res.status(500).json({ error: 'Provisioning failed' });
    }
  });

  /**
   * GET /event-sets/:advertiserId
   * Lists all CRM event sets for the advertiser from TikTok API.
   */
  router.get('/:advertiserId', async (req: Request, res: Response) => {
    try {
      const { advertiserId } = req.params;
      const tokenRecord = await tokenStore.get(advertiserId);

      if (!tokenRecord) {
        return res.status(404).json({
          error: `No OAuth token found for advertiser: ${advertiserId}`,
        });
      }

      const eventSets = await eventSetManager.list(advertiserId, tokenRecord.access_token);
      return res.json({ event_sets: eventSets, count: eventSets.length });
    } catch (err) {
      logger.error({ err, advertiserId: req.params['advertiserId'] }, 'Failed to list event sets');
      return res.status(500).json({ error: 'Failed to list event sets' });
    }
  });

  /**
   * POST /event-sets/:advertiserId
   * Creates a new CRM event set for the advertiser.
   */
  router.post('/:advertiserId', async (req: Request, res: Response) => {
    try {
      const { advertiserId } = req.params;
      const { name } = req.body as { name?: string };

      if (!name) {
        return res.status(400).json({ error: 'name is required' });
      }

      const tokenRecord = await tokenStore.get(advertiserId);
      if (!tokenRecord) {
        return res.status(404).json({
          error: `No OAuth token found for advertiser: ${advertiserId}`,
        });
      }

      const created = await eventSetManager.create(advertiserId, tokenRecord.access_token, name);
      return res.status(201).json(created);
    } catch (err) {
      logger.error({ err, advertiserId: req.params['advertiserId'] }, 'Failed to create event set');
      return res.status(500).json({ error: 'Failed to create event set' });
    }
  });

  /**
   * POST /event-sets/:advertiserId/select
   * Manually selects an event set for the advertiser.
   */
  router.post('/:advertiserId/select', async (req: Request, res: Response) => {
    try {
      const { advertiserId } = req.params;
      const { event_set_id, event_set_name } = req.body as {
        event_set_id?: string;
        event_set_name?: string;
      };

      if (!event_set_id) {
        return res.status(400).json({ error: 'event_set_id is required' });
      }

      const record = await eventSetManager.select(
        advertiserId,
        event_set_id,
        event_set_name ?? event_set_id
      );

      return res.json(record);
    } catch (err) {
      logger.error({ err, advertiserId: req.params['advertiserId'] }, 'Failed to select event set');
      return res.status(500).json({ error: 'Failed to select event set' });
    }
  });

  /**
   * GET /event-sets/:advertiserId/active
   * Returns the currently active event set ID for the advertiser.
   */
  router.get('/:advertiserId/active', async (req: Request, res: Response) => {
    try {
      const { advertiserId } = req.params;
      const eventSetId = await eventSetManager.resolve(advertiserId);

      if (!eventSetId) {
        return res.status(404).json({
          error: `No active event set found for advertiser: ${advertiserId}`,
        });
      }

      return res.json({ advertiser_id: advertiserId, event_set_id: eventSetId });
    } catch (err) {
      logger.error({ err, advertiserId: req.params['advertiserId'] }, 'Failed to get active event set');
      return res.status(500).json({ error: 'Failed to get active event set' });
    }
  });

  return router;
}
