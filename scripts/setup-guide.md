# TikTok ↔ Klaviyo CRM Integration — Setup Guide

## 1. TikTok Setup

### 1.1 Create a TikTok for Business App

1. Visit the [TikTok for Business Developer portal](https://ads.tiktok.com/marketing_api/apps/management)
2. Create a new app and note your **App ID** and **App Secret**
3. In your app settings, add the OAuth redirect URI: `https://your-domain.com/auth/tiktok/callback`
4. Enable the following scopes: `crm_event.write`, `campaign.read`

### 1.2 Configure TikTok Lead Gen Webhook

1. Go to your TikTok Ads Manager → **Lead Generation** → **Forms**
2. For each lead form that should trigger this integration:
   - Navigate to form settings → **Webhook**
   - Set the webhook URL to: `https://your-domain.com/webhooks/tiktok/leads`
   - Note the **Webhook Secret** provided (set as `TIKTOK_LEAD_WEBHOOK_SECRET`)

### 1.3 TikTok CRM Event Set

The integration auto-provisions a CRM Event Set. After authenticating:

```bash
# Trigger event set provisioning for your advertiser
curl -X POST https://your-domain.com/event-sets/{advertiser_id}/provision
```

Or manually specify one using `TIKTOK_CRM_EVENT_SET_ID`.

### 1.4 OAuth Authorization Flow

1. Visit: `https://your-domain.com/auth/tiktok`
2. You will be redirected to TikTok's authorization page
3. Authorize your advertiser accounts
4. The integration saves tokens automatically

---

## 2. Klaviyo Setup

### 2.1 Get Private API Key

1. In Klaviyo → **Settings** → **API Keys**
2. Create a **Private API Key** with full access
3. Copy the key (starts with `pk_`) and set as `KLAVIYO_PRIVATE_API_KEY`

### 2.2 Configure Klaviyo Webhook

1. In Klaviyo → **Integrations** → **Webhooks**
2. Create a new webhook:
   - **Endpoint URL**: `https://your-domain.com/webhooks/klaviyo/events`
   - **Events to track**: Select all CRM metric events:
     - Lead Created
     - Lead Contacted
     - Demo Scheduled
     - Lead Qualified
     - Opportunity Created
     - Deal Won
     - Application Approved
     - Subscription Started
     - Trial Started
3. Note the **Signing Secret** (set as `KLAVIYO_WEBHOOK_SECRET`)

### 2.3 Create Klaviyo Metrics

These metrics are automatically created when inbound events are received. You can also create them manually in Klaviyo → **Analytics** → **Metrics**.

---

## 3. Lead Field Mapping

TikTok Lead Form fields are mapped to Klaviyo profile attributes as follows:

| TikTok Field Name | Klaviyo Profile Attribute |
|---|---|
| `email` | `email` |
| `phone_number` | `phone_number` |
| `full_name` | `first_name` + `last_name` (split on first space) |
| `first_name` | `first_name` |
| `last_name` | `last_name` |

All TikTok lead form data is stored in the Klaviyo profile **without hashing** (Klaviyo handles raw PII). When this data is sent back to TikTok via CRM Events API, PII fields are SHA-256 hashed.

---

## 4. Environment Variable Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `TIKTOK_APP_ID` | Yes | — | TikTok app ID |
| `TIKTOK_APP_SECRET` | Yes | — | TikTok app secret |
| `TIKTOK_REDIRECT_URI` | Yes | — | OAuth callback URL |
| `TIKTOK_API_BASE_URL` | No | `https://business-api.tiktok.com` | API base URL |
| `TIKTOK_API_VERSION` | No | `v1.3` | API version |
| `TIKTOK_ACCESS_TOKEN` | No | — | Static access token (fallback) |
| `TIKTOK_CRM_EVENT_SET_ID` | No | — | Event set ID (fallback) |
| `TIKTOK_DEFAULT_ADVERTISER_ID` | No | — | Default advertiser ID |
| `TIKTOK_LEAD_WEBHOOK_SECRET` | Yes | — | Lead Gen webhook HMAC secret |
| `TIKTOK_RATE_LIMIT_RPS` | No | `10` | API requests per second |
| `TIKTOK_MAX_RETRIES` | No | `5` | Max retry attempts |
| `TIKTOK_INITIAL_RETRY_DELAY_MS` | No | `1000` | Initial retry delay |
| `TIKTOK_BATCH_SIZE` | No | `50` | Events per API batch |
| `KLAVIYO_PRIVATE_API_KEY` | Yes | — | Klaviyo private API key |
| `KLAVIYO_WEBHOOK_SECRET` | Yes | — | Klaviyo webhook HMAC secret |
| `KLAVIYO_API_BASE_URL` | No | `https://a.klaviyo.com` | Klaviyo API base URL |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis connection URL |
| `REDIS_DEDUP_TTL_SECONDS` | No | `172800` | Dedup window (48 hours) |
| `POSTGRES_URL` | Yes | — | PostgreSQL connection URL |
| `PORT` | No | `3000` | HTTP server port |
| `NODE_ENV` | No | `development` | Environment mode |
| `LOG_LEVEL` | No | `info` | Logging level |
| `INTEGRATION_VERSION` | No | `1.0.0` | Version tag for events |

---

## 5. Getting Started

### Prerequisites
- Node.js 20+
- Docker (for Redis and PostgreSQL)
- A TikTok for Business account with Lead Gen ads
- A Klaviyo account

### Installation

```bash
# Clone the repository
cd tiktok-klaviyo-crm

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your credentials

# Start infrastructure
docker-compose up -d

# Run database migrations
npm run migrate

# Start the development server
npm run dev
```

### Production Deployment

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

Or using Docker:

```bash
docker build -t tiktok-klaviyo-crm .
docker run -p 3000:3000 --env-file .env tiktok-klaviyo-crm
```

### Authorize TikTok

1. Navigate to: `http://localhost:3000/auth/tiktok`
2. Complete the OAuth flow
3. Check status: `GET http://localhost:3000/auth/tiktok/status`

---

## 6. Testing Webhooks Locally

### Using ngrok

```bash
# Install ngrok and expose local server
ngrok http 3000

# Use the ngrok URL as your webhook endpoint:
# https://abc123.ngrok.io/webhooks/tiktok/leads
# https://abc123.ngrok.io/webhooks/klaviyo/events
```

### Simulating TikTok Lead Webhook

```bash
# Generate a test signature
BODY='{"advertiser_id":"123","lead_id":"test-lead-001","form_id":"form-001","ad_id":"ad-001","adgroup_id":"adg-001","campaign_id":"camp-001","create_time":1700000000,"field_data":[{"name":"email","values":["test@example.com"]},{"name":"full_name","values":["Test User"]}]}'
TIMESTAMP=$(date +%s)
NONCE=$(uuidgen)
SIGNATURE=$(echo -n "${TIMESTAMP}${NONCE}${BODY}" | openssl dgst -sha256 -hmac "your_webhook_secret" | awk '{print $2}')

curl -X POST http://localhost:3000/webhooks/tiktok/leads \
  -H "Content-Type: application/json" \
  -H "X-TikTok-Signature: $SIGNATURE" \
  -H "X-TikTok-Timestamp: $TIMESTAMP" \
  -H "X-TikTok-Nonce: $NONCE" \
  -d "$BODY"
```

### Simulating Klaviyo Webhook

```bash
BODY='{"type":"event","id":"evt-001","attributes":{"metric":{"name":"Deal Won"},"profile":{"data":{"attributes":{"email":"customer@example.com","first_name":"Customer","properties":{"tiktok_lead_id":"lead-001","advertiser_id":"your_advertiser_id"}}}},"properties":{"advertiser_id":"your_advertiser_id"},"time":"2024-01-15T10:00:00Z","unique_id":"unique-001"}}'
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha256 -binary -hmac "your_klaviyo_webhook_secret" | base64)

curl -X POST http://localhost:3000/webhooks/klaviyo/events \
  -H "Content-Type: application/json" \
  -H "X-Klaviyo-Signature: $SIGNATURE" \
  -d "$BODY"
```

### Health Check

```bash
curl http://localhost:3000/health
# {"status":"ok","service":"tiktok-klaviyo-crm","version":"1.0.0","timestamp":"..."}
```

### Queue Metrics

```bash
curl http://localhost:3000/metrics/queue
# {"outbound":{"waiting":0,"active":0,"completed":42,"failed":0,"delayed":0},...}
```
