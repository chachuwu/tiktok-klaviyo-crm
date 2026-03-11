import { Pool } from 'pg';
import { logger } from '../logging/logger';

async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Enable uuid-ossp extension
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await client.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    // ----------------------------------------------------------------
    // crm_event_log table
    // ----------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS crm_event_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id TEXT UNIQUE NOT NULL,
        event_name TEXT NOT NULL,
        lead_id TEXT,
        direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
        source_payload JSONB,
        destination_payload JSONB,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'duplicate')),
        destination_response JSONB,
        attempt_count INT DEFAULT 0,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes for crm_event_log
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_crm_event_log_lead_id ON crm_event_log (lead_id)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_crm_event_log_status ON crm_event_log (status)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_crm_event_log_direction ON crm_event_log (direction)'
    );
    await client.query(
      'CREATE INDEX IF NOT EXISTS idx_crm_event_log_created_at ON crm_event_log (created_at DESC)'
    );

    // ----------------------------------------------------------------
    // tiktok_oauth_tokens table
    // ----------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS tiktok_oauth_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        advertiser_id TEXT UNIQUE NOT NULL,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        access_token_expires_at TIMESTAMPTZ NOT NULL,
        refresh_token_expires_at TIMESTAMPTZ NOT NULL,
        scope TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // advertiser_event_sets table
    // ----------------------------------------------------------------
    await client.query(`
      CREATE TABLE IF NOT EXISTS advertiser_event_sets (
        advertiser_id TEXT PRIMARY KEY,
        event_set_id TEXT NOT NULL,
        event_set_name TEXT,
        source TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ----------------------------------------------------------------
    // Auto-update updated_at trigger function
    // ----------------------------------------------------------------
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Triggers for each table
    const tables = ['crm_event_log', 'tiktok_oauth_tokens', 'advertiser_event_sets'];
    for (const table of tables) {
      const triggerName = `trigger_update_${table}_updated_at`;

      // Drop existing trigger before recreating to avoid conflicts
      await client.query(`
        DROP TRIGGER IF EXISTS ${triggerName} ON ${table};
      `);

      await client.query(`
        CREATE TRIGGER ${triggerName}
        BEFORE UPDATE ON ${table}
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
      `);
    }

    await client.query('COMMIT');
    logger.info('Database migration completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Database migration failed');
    throw err;
  } finally {
    client.release();
  }
}

// Run as standalone script
if (require.main === module) {
  const postgresUrl = process.env['POSTGRES_URL'];
  if (!postgresUrl) {
    logger.error('POSTGRES_URL environment variable is required');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: postgresUrl });

  migrate(pool)
    .then(() => {
      logger.info('Migration complete');
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Migration failed');
      pool.end().finally(() => process.exit(1));
    });
}

export { migrate };
