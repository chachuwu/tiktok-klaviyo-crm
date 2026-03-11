# TikTok ↔ Klaviyo CRM Integration

A production-grade, bidirectional CRM integration between TikTok Lead Ads and Klaviyo. Built with Node.js, TypeScript, BullMQ, PostgreSQL, and Redis.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    DIRECTION 1: INBOUND (TikTok → Klaviyo)              │
│                                                                          │
│  TikTok Lead Ad Form                                                     │
│       │                                                                  │
│       │ Lead Gen Webhook (HMAC-SHA256 verified)                          │
│       ▼                                                                  │
│  POST /webhooks/tiktok/leads                                             │
│       │                                                                  │
│       ▼                                                                  │
│  InboundPipeline                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  1. enrichFromTikTokLead() — parse field_data                    │   │
│  │  2. Deduplication check (Redis SET NX, key: lead_id)             │   │
│  │  3. buildKlaviyoEvent() — NO PII hashing                         │   │
│  │  4. klaviyoClient.upsertProfile() — ensure profile exists        │   │
│  │  5. klaviyoClient.createEvent("Lead Created")                    │   │
│  │  6. EventLog (Postgres) — track status                           │   │
│  │  7. RetryQueue (BullMQ) — on failure                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│       │                                                                  │
│       ▼                                                                  │
│  Klaviyo Profile + "Lead Created" Event                                  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                   DIRECTION 2: OUTBOUND (Klaviyo → TikTok)              │
│                                                                          │
│  Klaviyo CRM metric event (e.g., "Deal Won")                             │
│       │                                                                  │
│       │ Klaviyo Webhook (HMAC-SHA256 verified)                           │
│       ▼                                                                  │
│  POST /webhooks/klaviyo/events                                           │
│       │                                                                  │
│       ▼                                                                  │
│  OutboundPipeline                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  1. filterOutboundEvent() — map metric → TikTok event            │   │
│  │  2. enrichFromKlaviyoProfile() — extract user data               │   │
│  │  3. generateEventId() — deterministic SHA-256 for dedup          │   │
│  │  4. Deduplication check (Redis SET NX, key: eventId)             │   │
│  │  5. CRMEventSetManager.resolve() — find event set ID             │   │
│  │  6. buildTikTokPayload() — SHA-256 hash all PII                  │   │
│  │  7. tiktokClient.sendEvents() — CRM Events API                   │   │
│  │  8. EventLog (Postgres) — track status                           │   │
│  │  9. RetryQueue (BullMQ) — on failure                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│       │                                                                  │
│       ▼                                                                  │
│  TikTok CRM Events API (Deep Funnel Optimization)                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Klaviyo Metric → TikTok Event Mapping

| Klaviyo Metric Name | TikTok Standard Event | DFO Stage |
|---|---|---|
| `Lead Created` | `SubmitForm` | 1 |
| `Lead Contacted` | `Contact` | 2 |
| `Demo Scheduled` | `Schedule` | 2 |
| `Lead Qualified` | `CompleteRegistration` | 3 |
| `Opportunity Created` | `SubmitApplication` | 3 |
| `Deal Won` | `Purchase` | 4 |
| `Application Approved` | `ApplicationApproval` | 4 |
| `Subscription Started` | `Subscribe` | 4 |
| `Trial Started` | `StartTrial` | 4 |

The filter also accepts common variants (e.g., "Closed Won" → Purchase, "MQL" → CompleteRegistration). See `src/filters/event-filter.ts` for the full mapping.

---

## DFO Funnel Stages

| Stage | Events | Description |
|---|---|---|
| 1 | SubmitForm | Lead captured |
| 2 | Contact, Schedule | Engagement |
| 3 | CompleteRegistration, SubmitApplication | Qualification |
| 4 | Purchase, ApplicationApproval, Subscribe, StartTrial | Conversion |

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/tiktok/leads` | TikTok Lead Gen webhook (inbound) |
| `POST` | `/webhooks/klaviyo/events` | Klaviyo metric webhook (outbound) |
| `GET` | `/auth/tiktok` | Initiate TikTok OAuth |
| `GET` | `/auth/tiktok/callback` | OAuth callback |
| `GET` | `/auth/tiktok/status` | List authorized advertisers |
| `POST` | `/auth/tiktok/refresh/:advertiserId` | Manual token refresh |
| `POST` | `/auth/tiktok/revoke/:advertiserId` | Revoke advertiser token |
| `POST` | `/event-sets/:advertiserId/provision` | Auto-provision CRM event set |
| `GET` | `/event-sets/:advertiserId` | List event sets from TikTok |
| `POST` | `/event-sets/:advertiserId` | Create new event set |
| `POST` | `/event-sets/:advertiserId/select` | Manually select event set |
| `GET` | `/event-sets/:advertiserId/active` | Get active event set |
| `GET` | `/health` | Health check |
| `GET` | `/ready` | Readiness check |
| `GET` | `/metrics/queue` | BullMQ queue metrics |

---

## Environment Variables

See `.env.example` for the full list with descriptions.

**Required:**
- `TIKTOK_APP_ID`, `TIKTOK_APP_SECRET`, `TIKTOK_REDIRECT_URI`
- `TIKTOK_LEAD_WEBHOOK_SECRET`
- `KLAVIYO_PRIVATE_API_KEY`, `KLAVIYO_WEBHOOK_SECRET`
- `POSTGRES_URL`

**Optional with defaults:**
- `TIKTOK_API_BASE_URL` (https://business-api.tiktok.com)
- `REDIS_URL` (redis://localhost:6379)
- `PORT` (3000)
- `NODE_ENV` (development)

---

## Getting Started

### Prerequisites
- Node.js 20+
- Docker and docker-compose
- TikTok for Business account
- Klaviyo account

### Installation

```bash
# Install dependencies
npm install

# Copy and fill in environment variables
cp .env.example .env
vim .env

# Start Redis and PostgreSQL
docker-compose up -d

# Run migrations
npm run migrate

# Start development server
npm run dev
```

### Authorize TikTok

Navigate to `http://localhost:3000/auth/tiktok` and complete the OAuth flow.

---

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

Test files cover:
- `inbound-pipeline.test.ts` — TikTok Lead → Klaviyo flow
- `outbound-pipeline.test.ts` — Klaviyo metric → TikTok flow
- `pii-safety.test.ts` — PII hashing verification
- `event-filter.test.ts` — Metric name mapping
- `klaviyo-event-builder.test.ts` — Klaviyo payload construction
- `tiktok-event-builder.test.ts` — TikTok payload construction
- `normalizer.test.ts` — Data normalization
- `hasher.test.ts` — SHA-256 hashing
- `redis-dedup.test.ts` — Deduplication logic
- `identity-enrichment.test.ts` — Profile enrichment
- `klaviyo-api-client.test.ts` — Klaviyo API client
- `tiktok-api-client.test.ts` — TikTok API client

---

## Security

### PII Handling

| Destination | PII Treatment |
|---|---|
| **Klaviyo** | **Plaintext** — Klaviyo stores and uses actual PII values for segmentation, personalization, and analytics |
| **TikTok** | **SHA-256 hashed** — TikTok requires hashed PII for privacy compliance. Fields hashed: email, phone, first_name, last_name, external_id |

Fields that are **never hashed** (even to TikTok): `ttclid`, `ip`, `user_agent`, `lead_id`

### Webhook Signature Verification

- **TikTok webhooks**: HMAC-SHA256 of `timestamp + nonce + body` using `TIKTOK_LEAD_WEBHOOK_SECRET`. Verified using `crypto.timingSafeEqual()` to prevent timing attacks.
- **Klaviyo webhooks**: HMAC-SHA256 of raw request body using `KLAVIYO_WEBHOOK_SECRET`. Signature is base64-encoded in `X-Klaviyo-Signature`. Verified using `crypto.timingSafeEqual()`.

Both webhook routes use `express.raw()` middleware to receive the raw body bytes for accurate signature computation.

### Deduplication

- **Inbound**: Redis `SET NX` with 48h TTL, keyed on `lead_id`
- **Outbound**: Deterministic SHA-256 event ID from `leadId:eventName:eventTime`, Redis `SET NX` with 48h TTL

### OAuth Token Security

- Tokens stored in PostgreSQL (persistent) and Redis (cache with 23h TTL)
- Proactive token refresh runs every 23h, refreshes tokens expiring within 1h
- Tokens are never exposed in logs (Pino redaction configured)

---

## Production Deployment

### Docker

```bash
docker build -t tiktok-klaviyo-crm .
docker run \
  -p 3000:3000 \
  --env-file .env \
  --restart unless-stopped \
  tiktok-klaviyo-crm
```

### Health Checks

- `/health` — Application health
- `/ready` — Readiness probe
- `/metrics/queue` — BullMQ queue depth metrics

### Logging

Structured JSON logging via Pino. Sensitive fields are redacted in all environments. Use `LOG_LEVEL=debug` for verbose output during development.

---

## License

MIT
