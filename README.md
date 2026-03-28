# Quant IQ

Quant-grade macro and geopolitical intelligence for independent US market investors.
Real-time event ingestion → Claude AI classification → investment themes → portfolio advisory.

**Stack:** Next.js 16 · React 19 · Supabase (Postgres + Auth + RLS) · Vercel · Claude claude-sonnet-4-20250514 · Stripe

---

## Project structure

```
quant-iq/
├── app/
│   ├── page.tsx                          # Root — redirects to /dashboard or /auth/login
│   ├── layout.tsx                        # Root layout + metadata
│   ├── globals.css                       # Design system CSS variables
│   ├── auth/
│   │   ├── login/page.tsx                # Email + password login
│   │   ├── signup/page.tsx               # Account creation
│   │   └── callback/route.ts             # Supabase email confirmation handler
│   ├── dashboard/
│   │   ├── layout.tsx                    # Auth guard + sidebar shell
│   │   ├── page.tsx                      # Overview: KPIs, event feed, themes
│   │   ├── events/page.tsx               # Full classified event feed
│   │   ├── themes/page.tsx               # 1m / 3m / 6m investment themes
│   │   ├── assets/page.tsx               # Asset screener with signals
│   │   ├── portfolio/page.tsx            # Holdings + AI advisory memo
│   │   └── alerts/page.tsx               # Alert inbox
│   └── api/
│       ├── auth/signout/route.ts         # Sign-out handler
│       ├── cron/
│       │   ├── ingest/route.ts           # 08:00 UTC: NewsAPI → Claude → Supabase
│       │   └── themes/route.ts           # 09:00 UTC: themes + signals + Polygon prices
│       ├── events/route.ts               # GET /api/events
│       ├── themes/route.ts               # GET /api/themes
│       ├── assets/route.ts               # GET /api/assets
│       ├── portfolio/route.ts            # GET / POST / DELETE /api/portfolio
│       ├── advisory/route.ts             # GET / POST /api/advisory
│       ├── alerts/route.ts               # GET / PATCH /api/alerts
│       └── billing/
│           ├── checkout/route.ts         # POST — create Stripe Checkout session
│           ├── portal/route.ts           # POST — create Stripe Customer Portal session
│           └── webhook/route.ts          # POST — Stripe webhook handler
├── lib/
│   ├── supabase.ts                       # Client factory, requireUser, requirePlan
│   ├── ai.ts                             # Claude: classify, themes, signals, memos
│   └── stripe.ts                         # Stripe client singleton + price map
├── supabase/migrations/
│   └── 001_schema.sql                    # All tables, RLS policies, seed data
├── vercel.json                           # Cron schedule
├── next.config.ts
├── tsconfig.json
├── package.json
└── .env.local.example                    # All required env vars with setup notes
```

---

## Setup — step by step

### 1. Clone and install

```bash
git clone <your-repo> quant-iq
cd quant-iq
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project
2. Note your **Project URL** and **anon key** (Project Settings → API)
3. Copy the **service role key** — keep it secret, never commit it

### 3. Run the database migration

Option A — Supabase CLI:
```bash
npx supabase login
npx supabase link --project-ref your-project-ref
npx supabase db push
```

Option B — SQL Editor (simpler for first setup):
1. Supabase Dashboard → SQL Editor → New query
2. Paste the full contents of `supabase/migrations/001_schema.sql`
3. Click Run

This creates all 9 tables, RLS policies, and seeds the 23-asset universe.

### 4. Configure environment variables

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` for dev |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `CRON_SECRET` | Run: `openssl rand -hex 32` |
| `NEWSAPI_KEY` | [newsapi.org/account](https://newsapi.org/account) (free dev tier) |
| `POLYGON_API_KEY` | [polygon.io/dashboard](https://polygon.io/dashboard) (optional for dev) |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API Keys |
| `STRIPE_WEBHOOK_SECRET` | Created in step 6 below |
| `STRIPE_PRO_MONTHLY_PRICE_ID` | Created in step 5 below |
| `STRIPE_PRO_ANNUAL_PRICE_ID` | Created in step 5 below |
| `STRIPE_ADVISOR_MONTHLY_PRICE_ID` | Created in step 5 below |
| `STRIPE_ADVISOR_ANNUAL_PRICE_ID` | Created in step 5 below |

### 5. Create Stripe products

In [Stripe Dashboard](https://dashboard.stripe.com) → Products → Add product:

**Product 1: Quant IQ Pro**
- Price 1: $29.00 / month recurring → copy ID → `STRIPE_PRO_MONTHLY_PRICE_ID`
- Price 2: $290.00 / year recurring → copy ID → `STRIPE_PRO_ANNUAL_PRICE_ID`

**Product 2: Quant IQ Advisor**
- Price 1: $99.00 / month recurring → copy ID → `STRIPE_ADVISOR_MONTHLY_PRICE_ID`
- Price 2: $990.00 / year recurring → copy ID → `STRIPE_ADVISOR_ANNUAL_PRICE_ID`

### 6. Set up Stripe webhook (for production)

Stripe Dashboard → Developers → Webhooks → Add endpoint:
- URL: `https://your-app.vercel.app/api/billing/webhook`
- Events to listen for:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.payment_failed`

Copy the **Signing secret** → `STRIPE_WEBHOOK_SECRET`

For local testing use [Stripe CLI](https://stripe.com/docs/stripe-cli):
```bash
stripe listen --forward-to localhost:3000/api/billing/webhook
```

### 7. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to `/auth/login`.

Create an account, confirm via email, then sign in.

### 8. Test the cron jobs

The database will be empty until the crons run. Trigger them manually:

```bash
# Step 1 — ingest news and classify with Claude (takes ~2–3 min)
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/ingest

# Step 2 — generate themes and asset signals (run after ingest)
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/themes
```

Or use the npm shortcuts:
```bash
CRON_SECRET=your_secret npm run cron:ingest
CRON_SECRET=your_secret npm run cron:themes
```

After these complete, refresh the dashboard — events, themes, and signals will be populated.

### 9. Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

Then in **Vercel Dashboard → Project → Settings → Environment Variables**, add every variable from `.env.local`.

After deploying, update:
- `NEXT_PUBLIC_APP_URL` → your Vercel URL (e.g. `https://quant-iq.vercel.app`)
- **Supabase** → Authentication → URL Configuration:
  - Site URL: `https://quant-iq.vercel.app`
  - Redirect URLs: `https://quant-iq.vercel.app/**`
- **Stripe webhook** endpoint URL → your Vercel deployment URL

The `vercel.json` cron schedule runs automatically once deployed:
- `0 8 * * *` → ingest (8am UTC)
- `0 9 * * *` → themes + signals (9am UTC)

> **Note:** Cron jobs with `maxDuration: 300` require the **Vercel Pro plan** ($20/mo).
> On Hobby, reduce `maxDuration` to 60 and limit `QUERIES` to 2 topics in the ingest cron.

---

## API reference

All routes require a valid Supabase session cookie (set automatically on login) except cron routes.

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/events` | Session | Classified events. Params: `limit`, `impact`, `sector`, `since` |
| `GET` | `/api/themes` | Session | Active themes. Param: `timeframe` (1m\|3m\|6m) |
| `GET` | `/api/assets` | Session | Assets with signals. Params: `type`, `signal` |
| `GET` | `/api/portfolio` | Session | User's portfolio + holdings with signals |
| `POST` | `/api/portfolio` | Session | Add holding. Body: `{ticker, name?, quantity?, avg_cost?}` |
| `DELETE` | `/api/portfolio?holding_id=` | Session | Remove holding |
| `GET` | `/api/advisory` | Session | Last 5 advisory memos |
| `POST` | `/api/advisory` | Pro+ | Generate AI memo. Body: `{portfolio_id}` |
| `GET` | `/api/alerts` | Session | Last 20 alerts |
| `PATCH` | `/api/alerts` | Session | Mark as read. Body: `{ids: string[]}` |
| `POST` | `/api/billing/checkout` | Session | Stripe checkout. Body: `{plan, interval?}` |
| `POST` | `/api/billing/portal` | Session | Stripe customer portal URL |
| `POST` | `/api/billing/webhook` | Stripe sig | Subscription lifecycle handler |
| `GET` | `/api/cron/ingest` | CRON_SECRET | NewsAPI → Claude → Supabase |
| `GET` | `/api/cron/themes` | CRON_SECRET | Themes + signals + Polygon prices |

---

## Tier limits

| Feature | Free | Pro ($29/mo) | Advisor ($99/mo) |
|---|---|---|---|
| Event feed | 5 latest | Full (50) | Full (50) |
| Themes | 1m only | All timeframes | All timeframes |
| Asset screener | Read-only | Read-only | Read-only |
| Portfolio tracking | Yes | Yes | Yes |
| AI advisory memos | No | Yes | Yes |
| API access | No | No | Yes (future) |

---

## Pricing summary

- **Free** — forever, no card required
- **Pro** — $29/month or $290/year (14-day free trial)
- **Advisor** — $99/month or $990/year

---

## What the cron jobs do

**`/api/cron/ingest`** (8am UTC daily)
1. Fetches articles from NewsAPI across 5 financial topic queries
2. Deduplicates by URL against existing DB records
3. Inserts raw event rows (`ai_processed: false`)
4. Calls `classifyEvent()` via Claude with 1s delay between calls
5. Updates each row: `event_type`, `sectors`, `sentiment_score`, `impact_level`, `tickers`, `ai_summary`

**`/api/cron/themes`** (9am UTC daily)
1. Fetches last 48h of high/medium impact classified events
2. Deactivates existing active theme for each timeframe
3. Calls `generateTheme()` for 1m, 3m, and 6m horizons
4. Calls `generateAssetSignals()` to update buy/watch/hold/avoid across all 23 assets
5. Fetches live prices from Polygon.io and updates `asset_signals.price_usd`

---

## Troubleshooting

**Dashboard shows no data**
→ Run `npm run cron:ingest` then `npm run cron:themes` manually.

**Cron returns 401**
→ Check `CRON_SECRET` in `.env.local` matches the header value.

**Claude calls fail**
→ Verify `ANTHROPIC_API_KEY` is set. Check usage at console.anthropic.com.

**Supabase RLS blocking service role**
→ Confirm you're using `createServiceClient()` (service key) in cron routes, not the anon client.

**Stripe webhook 400**
→ For local dev, use `stripe listen --forward-to localhost:3000/api/billing/webhook` to get the correct signing secret.

**`maxDuration` exceeded on Vercel Hobby**
→ Set `maxDuration = 60` in both cron routes and reduce `QUERIES` array to 2 items.
#   u p d a t e d   0 3 / 2 8 / 2 0 2 6   1 7 : 2 9 : 2 8  
 #   u p d a t e d   0 3 / 2 8 / 2 0 2 6   1 7 : 3 0 : 0 1  
 