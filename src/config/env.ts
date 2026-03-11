import { z } from 'zod';

const envSchema = z.object({
  // TikTok
  TIKTOK_APP_ID: z.string().min(1, 'TIKTOK_APP_ID is required'),
  TIKTOK_APP_SECRET: z.string().min(1, 'TIKTOK_APP_SECRET is required'),
  TIKTOK_REDIRECT_URI: z.string().url('TIKTOK_REDIRECT_URI must be a valid URL'),
  TIKTOK_API_BASE_URL: z.string().url().default('https://business-api.tiktok.com'),
  TIKTOK_API_VERSION: z.string().default('v1.3'),
  TIKTOK_ACCESS_TOKEN: z.string().optional(),
  TIKTOK_CRM_EVENT_SET_ID: z.string().optional(),
  TIKTOK_DEFAULT_ADVERTISER_ID: z.string().optional(),
  TIKTOK_RATE_LIMIT_RPS: z.coerce.number().int().positive().default(10),
  TIKTOK_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  TIKTOK_INITIAL_RETRY_DELAY_MS: z.coerce.number().int().positive().default(1000),
  TIKTOK_BATCH_SIZE: z.coerce.number().int().positive().max(50).default(50),
  TIKTOK_LEAD_WEBHOOK_SECRET: z.string().min(1, 'TIKTOK_LEAD_WEBHOOK_SECRET is required'),

  // Klaviyo
  KLAVIYO_PRIVATE_API_KEY: z.string().min(1, 'KLAVIYO_PRIVATE_API_KEY is required'),
  KLAVIYO_WEBHOOK_SECRET: z.string().min(1, 'KLAVIYO_WEBHOOK_SECRET is required'),
  KLAVIYO_API_BASE_URL: z.string().url().default('https://a.klaviyo.com'),

  // Redis
  REDIS_URL: z.string().url().default('redis://localhost:6379'),
  REDIS_DEDUP_TTL_SECONDS: z.coerce.number().int().positive().default(172800),

  // Postgres
  POSTGRES_URL: z.string().min(1, 'POSTGRES_URL is required'),

  // App
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  INTEGRATION_VERSION: z.string().default('1.0.0'),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${errors}`);
  }

  return result.data;
}

export const env = validateEnv();
