import pino from 'pino';

const redactPaths = [
  '*.email',
  '*.phone',
  '*.phone_number',
  '*.first_name',
  '*.last_name',
  '*.access_token',
  '*.refresh_token',
  'req.headers.authorization',
  'user.email',
  'user.phone',
  'user.phone_number',
  'user.first_name',
  'user.last_name',
  'attributes.email',
  'attributes.phone_number',
  'attributes.first_name',
  'attributes.last_name',
];

const isDevelopment =
  process.env['NODE_ENV'] !== 'production' && process.env['NODE_ENV'] !== 'test';

const transport = isDevelopment
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    }
  : undefined;

export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]',
  },
  transport,
  base: {
    service: 'tiktok-klaviyo-crm',
    version: process.env['INTEGRATION_VERSION'] ?? '1.0.0',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label: string) {
      return { level: label };
    },
  },
});

export default logger;
