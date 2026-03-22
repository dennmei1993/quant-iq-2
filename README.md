# Quant IQ

Quant-grade macro and geopolitical intelligence for US market investors.
Built with **Next.js 14 · Supabase · Vercel · Claude AI**.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend + API | Next.js 14 (App Router) |
| Database + Auth | Supabase (Postgres + RLS) |
| AI / LLM | Anthropic Claude API |
| Hosting | Vercel |
| Data sources | NewsAPI, Polygon.io, FRED, CoinGecko |
| Cron jobs | Vercel Cron (every 15 min + hourly) |

---

## Local development

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/quant-iq.git
cd quant-iq
npm install
```

### 2. Set up Supabase

1. Go to [supabase.com](https://supabase.com) → New project
2. Once created, go to **Settings → API** and copy:
   - Project URL
   - anon/public key
   - service_role key (keep secret)
3. Go to **SQL Editor** and run the full contents of:
   ```
   supabase/migrations/001_initial_schema.sql
   ```
   This creates all tables, RLS policies, indexes, and seeds starter assets.

### 3. Configure environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

ANTHROPIC_API_KEY=sk-ant-...

NEWSAPI_KEY=your_key        # newsapi.org — free tier: 100 req/day
POLYGON_API_KEY=your_key    # polygon.io  — free tier available

NEXT_PUBLIC_APP_URL=http://localhost:3000
CRON_SECRET=any_random_32_char_string
```

### 4. Add the landing page

Copy the `quant-iq.html` file (built separately) into the `public/` folder and rename it:

```bash
cp /path/to/quant-iq.html public/landing.html
```

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/quant-iq.git
git push -u origin main
```

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) → **Add New Project**
2. Import your GitHub repo
3. Framework preset: **Next.js** (auto-detected)
4. Click **Deploy** — the first deploy will fail because env vars aren't set yet

### 3. Add environment variables in Vercel

Go to your Vercel project → **Settings → Environment Variables** and add all variables from `.env.local.example`:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `NEWSAPI_KEY` | [newsapi.org/register](https://newsapi.org/register) |
| `POLYGON_API_KEY` | [polygon.io](https://polygon.io) |
| `NEXT_PUBLIC_APP_URL` | Your Vercel domain e.g. `https://quant-iq.vercel.app` |
| `CRON_SECRET` | Generate: `openssl rand -hex 16` |

### 4. Redeploy

After adding env vars, go to **Deployments → Redeploy**.

### 5. Configure Supabase Auth redirect URLs

In Supabase → **Authentication → URL Configuration**:

- **Site URL**: `https://your-app.vercel.app`
- **Redirect URLs**: `https://your-app.vercel.app/auth/callback`

---

## Cron jobs

Vercel Cron is configured in `vercel.json`:

| Endpoint | Schedule | What it does |
|---|---|---|
| `/api/cron/ingest` | Every 15 min | Fetches news, classifies with Claude, stores events |
| `/api/cron/themes` | Every hour | Clusters events into investment themes |

Cron requests are authenticated via `Authorization: Bearer YOUR_CRON_SECRET`.

To trigger manually during development:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  http://localhost:3000/api/cron/ingest
```

---

## Project structure

```
quant-iq/
├── public/
│   └── landing.html              ← copy your quant-iq.html here
├── src/
│   ├── app/
│   │   ├── (marketing)/          ← landing page route (/)
│   │   ├── auth/
│   │   │   ├── login/
│   │   │   └── signup/
│   │   ├── dashboard/
│   │   │   ├── layout.tsx        ← auth gate + shell
│   │   │   ├── page.tsx          ← overview
│   │   │   ├── events/
│   │   │   ├── themes/
│   │   │   ├── assets/
│   │   │   ├── portfolio/
│   │   │   └── alerts/
│   │   └── api/
│   │       ├── events/
│   │       ├── themes/
│   │       ├── advisory/
│   │       ├── portfolio/
│   │       ├── assets/
│   │       ├── alerts/
│   │       └── cron/
│   │           ├── ingest/       ← every 15 min
│   │           └── themes/       ← every hour
│   ├── components/
│   │   ├── dashboard/            ← DashboardShell, KpiCard, widgets
│   │   └── landing/              ← LandingPage iframe wrapper
│   ├── lib/
│   │   ├── ai.ts                 ← Claude API helpers
│   │   ├── ingest.ts             ← NewsAPI / FRED fetchers
│   │   └── supabase/
│   │       ├── client.ts         ← browser client
│   │       └── server.ts         ← server + service-role client
│   ├── middleware.ts             ← session refresh + route protection
│   └── types/
│       └── supabase.ts           ← generated DB types
└── supabase/
    └── migrations/
        └── 001_initial_schema.sql
```

---

## Development roadmap

| Phase | Status |
|---|---|
| Landing page | ✅ Done |
| Auth (login/signup) | ✅ Done |
| Database schema | ✅ Done |
| Event ingest pipeline | ✅ Done |
| AI event classification | ✅ Done |
| Theme generation | ✅ Done |
| Dashboard UI (all pages) | ✅ Done |
| Portfolio management | ✅ Done |
| Advisory memo generation | ✅ Done |
| Alerts system | ✅ Done |
| Asset price history / sparklines | 🔲 Next |
| Stripe billing / plan enforcement | 🔲 Next |
| Real-time updates (Supabase Realtime) | 🔲 Future |
| Mobile app (React Native) | 🔲 Future |

---

## API reference

All endpoints require a valid Supabase session cookie (authenticated user).

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/events` | Fetch scored events (filter: `impact`, `sector`, `since`, `limit`) |
| GET | `/api/themes` | Fetch active themes (filter: `timeframe`) |
| GET | `/api/assets` | Fetch assets with signals (filter: `type`, `signal`) |
| GET | `/api/portfolio` | Fetch user portfolio + holdings |
| POST | `/api/portfolio` | Add a holding |
| DELETE | `/api/portfolio?holding_id=` | Remove a holding |
| GET | `/api/advisory` | Fetch recent advisory memos |
| POST | `/api/advisory` | Generate new advisory memo (body: `{ portfolio_id }`) |
| GET | `/api/alerts` | Fetch alerts |
| PATCH | `/api/alerts` | Mark alerts as read (body: `{ ids: [] }`) |

---

## License

MIT
