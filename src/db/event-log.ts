import { Pool } from 'pg';
import { EventLogRecord, EventStatus } from '../types';
import { logger } from '../logging/logger';

export class EventLog {
  private readonly pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Inserts a new event log record.
   * Uses ON CONFLICT (event_id) DO NOTHING for idempotency.
   */
  async insert(record: Partial<EventLogRecord>): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO crm_event_log (
          event_id, event_name, lead_id, direction,
          source_payload, destination_payload, status,
          destination_response, attempt_count, error
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (event_id) DO NOTHING`,
        [
          record.event_id,
          record.event_name,
          record.lead_id ?? null,
          record.direction,
          record.source_payload ? JSON.stringify(record.source_payload) : null,
          record.destination_payload ? JSON.stringify(record.destination_payload) : null,
          record.status ?? 'pending',
          record.destination_response ? JSON.stringify(record.destination_response) : null,
          record.attempt_count ?? 0,
          record.error ?? null,
        ]
      );
    } catch (err) {
      logger.error({ err, event_id: record.event_id }, 'Failed to insert event log record');
    }
  }

  /**
   * Updates the status of an event log record.
   */
  async updateStatus(
    eventId: string,
    status: EventStatus,
    response?: unknown,
    error?: string
  ): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE crm_event_log
         SET status = $1,
             destination_response = $2,
             error = $3,
             updated_at = NOW()
         WHERE event_id = $4`,
        [
          status,
          response ? JSON.stringify(response) : null,
          error ?? null,
          eventId,
        ]
      );
    } catch (err) {
      logger.error({ err, event_id: eventId }, 'Failed to update event log status');
    }
  }

  /**
   * Increments the attempt count for an event log record.
   */
  async incrementAttempt(eventId: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE crm_event_log
         SET attempt_count = attempt_count + 1,
             updated_at = NOW()
         WHERE event_id = $1`,
        [eventId]
      );
    } catch (err) {
      logger.error({ err, event_id: eventId }, 'Failed to increment attempt count');
    }
  }
}
