---
name: quant-iq
description: >
  Full-stack Next.js + Supabase options trading dashboard (betteroption.com.au).
  Use this skill whenever working on the Quant IQ project — any task involving
  WorkspaceClient.tsx, broker_service.py, conditional orders, PMCC/LEAPS strategies,
  daily price crons, Moomoo OpenD bridge, Cloudflare tunnel, Vercel deployment,
  or the strategy monitor. Also triggers for: option chain, IV rank, MACD evaluation,
  DCA stage orders, portfolio sync, watchlist bootstrap, or any file in
  quant-iq or quant-iq-engine repos.
---

# Quant IQ — Developer Skill

## Project Overview

**betteroption.com.au** — Personal options trading dashboard for the Australian market.

| Repo | Purpose |
|---|---|
| `quant-iq` | Next.js 14 dashboard (Vercel) |
| `quant-iq-engine` | **Deprecated** — replaced by Moomoo bridge |

**Core stack:** Next.js 14 · Supabase (Postgres + RLS) · Moomoo OpenD · FastAPI bridge · Cloudflare tunnel · Vercel

---

## Architecture

```
Browser → Vercel (Next.js)
              ↓
         Supabase (DB + Auth)
              ↓
    Cloudflare Tunnel → broker_service.py (FastAPI :8765)
                              ↓
                         Moomoo OpenD (:11111)
```

**Key env vars (Vercel):**
```
BRIDGE_URL          = https://<tunnel>.trycloudflare.com  # changes on restart!
CRON_SECRET         = a3f8c2e1d4b7a9f0e3c6d2b5a8f1e4c7d0b3a6f9e2c5d8b1a4f7e0c3d6b9a2f5
NEXT_PUBLIC_BASE_URL = https://www.betteroption.com.au
SUPABASE_URL        = https://uodgthfhflojqkppyifp.supabase.co
```

**Local bridge:**
- Port: `8765`
- OpenD: `127.0.0.1:11111`, firm `FUTUAU`
- Start: `.\broker-start.ps1` (Terminal 1) → `cloudflared tunnel --url http://localhost:8765` (Terminal 2)
- Tunnel URL saved to `moomoo/tunnel-url.txt` — update `BRIDGE_URL` in Vercel when it changes

---

## Key Files

### Frontend
| File | Destination |
|---|---|
| `WorkspaceClient.tsx` | `src/app/dashboard/workspace/WorkspaceClient.tsx` |
| `strategies-page.tsx` | `src/app/dashboard/strategies/page.tsx` |
| `watchlist-page.tsx` | `src/app/dashboard/watchlist/page.tsx` |
| `settings-page.tsx` | `src/app/dashboard/settings/page.tsx` |
| `HomeClient.tsx` | `src/app/dashboard/HomeClient.tsx` |

### API Routes
| File | Destination |
|---|---|
| `conditional-orders-route.ts` | `src/app/api/orders/conditional/route.ts` |
| `conditional-orders-cron.ts` | `src/app/api/cron/conditional-orders/route.ts` |
| `option-strategies-route.ts` | `src/app/api/strategies/option/route.ts` |
| `strategy-alerts-route.ts` | `src/app/api/strategies/alerts/route.ts` |
| `strategy-monitor-cron.ts` | `src/app/api/cron/strategy-monitor/route.ts` |
| `cron-prices-route.ts` | `src/app/api/cron/prices/route.ts` |
| `cron-bootstrap-route.ts` | `src/app/api/cron/bootstrap/route.ts` |
| `sync-route.ts` | `src/app/api/portfolio/sync/route.ts` |
| `watchlist-route-full.ts` | `src/app/api/portfolio/watchlist/route.ts` |
| `user-settings-route.ts` | `src/app/api/user/settings/route.ts` |
| `search-route.ts` | `src/app/api/assets/search/route.ts` |

### Bridge & Config
| File | Destination |
|---|---|
| `broker_service.py` | `moomoo/broker_service.py` |
| `broker-start.ps1` | `moomoo/broker-start.ps1` |
| `trigger-cron.ps1` | `moomoo/trigger-cron.ps1` |
| `vercel.json` | project root |
| `next.config.js` | project root |

---

## Cron Jobs

| Cron | Schedule | Trigger |
|---|---|---|
| `/api/cron/conditional-orders` | Every minute | Windows Task Scheduler (`trigger-cron.ps1`) |
| `/api/cron/prices` | `0 22 * * 1-5` | Vercel (after US market close) |
| `/api/cron/strategy-monitor` | `0 22 * * 1-5` | Vercel (after US market close) |
| `/api/cron/bootstrap?ticker=X` | On-demand | Watchlist add / manual |

**Cron auth:** `Authorization: Bearer <CRON_SECRET>` — fallback hardcoded secret also accepted.

---

## Conditional Orders System

### DB Table: `conditional_orders`
Key columns: `ticker`, `side`, `qty`, `order_type`, `limit_price`, `status`, `is_active`, `allow_24h`, `not_before_time`, `expires_at`, `iv_rank_below`, `iv_rank_above`, `premium_above`, `price_below`, `price_above`, `notes`, `strategy_id`, `leg_num`, `option_code`

### Evaluation Order (cron)
1. **Market hours** — skip if outside 9:30–16:00 ET unless `allow_24h=true` OR `profile.trading_24h=true`
2. **Time gate** — skip if before `not_before_time` ET. NULL = no gate
3. **Price conditions** — `price_above`, `price_below`
4. **IV Rank** — fetched from `/options/iv_rank` (HV-based from Moomoo price history). Non-blocking if unavailable
5. **Premium** — `premium_above` checked against live bid. Non-blocking if unavailable
6. **PMCC chain search** — if notes contains `PMCC LEG` + `CRITERIA:JSON`, searches live chain, selects best contract by delta/OI, sets `option_code` + `limit_price`
7. **MACD** — parsed from notes `MACD bullish/bearish cross on 1h/4h/1d`. Uses `/kline/macd` endpoint
8. **Execution** — places order via bridge, marks triggered

### Key behaviours
- `is_active = false` → order skipped (used for PMCC LEG2 waiting for LEG1 fill)
- `not_before_time = NULL` → no time gate (N/A option)
- `allow_24h = false` + outside market hours → skipped unless profile flag set

---

## LEAPS / PMCC Strategy System

### Flow
```
PMCCStageModal (WorkspaceClient.tsx)
  → POST /api/orders/conditional (LEG1: is_active=true, leg_num=1)
  → POST /api/orders/conditional (LEG2: is_active=false, leg_num=2)
  → POST /api/strategies/option  (links both via strategy_id)

Cron (every minute):
  LEG1: iv_rank_below check → PMCC chain search → execute → strategy.status = leg1_placed

Strategy Monitor (daily):
  leg1_placed → check broker fill → if filled:
    strategy.status = leg1_filled
    LEG2.is_active = true  (now evaluated by cron)
  active → check short leg DTE → if < 7: create roll alert
  active → update P&L snapshot
```

### DB Tables
- `option_strategies` — links both legs, tracks status/fill prices/P&L
- `strategy_alerts` — roll_due, leg1_filled, leg2_filled notifications

### Strategy statuses
`pending` → `leg1_placed` → `leg1_filled` → `active` → `rolling` → `closed`

### PMCC chain selection
- **LEG1 (buy LEAP)**: `select=best_delta` — closest delta to midpoint of range. Limit = mid (bid+ask)/2
- **LEG2 (sell short call)**: `select=best_premium` — highest bid within delta range. Limit = bid - 0.01
- Criteria stored as JSON in `notes`: `PMCC LEG1 CRITERIA:{"dte_min":180,"dte_max":365,"delta_min":0.75,"delta_max":0.90,"select":"best_delta"}`

---

## DCA Stage Orders

Modal: `DCAStageModal` in `WorkspaceClient.tsx`

Conditions: `immediate` / `price_below` / `price_above` / `macd_cross`

MACD stored in notes: `DCA #N — MACD bullish cross on 1h`

Key state: `qty` (editable shares), `notBefore` (default `''` = N/A), `allow24h`, `expireDate`

---

## Price Data (Moomoo Bridge)

### Bridge endpoints
```
GET /prices/daily?tickers=AAPL,QQQM&count=5     → last N days OHLCV
GET /prices/bootstrap?ticker=AAPL&count=752      → full 3yr history
GET /kline?symbol=US.TQQQ&kl_type=DAY&count=9999 → raw klines
GET /kline/macd?symbol=US.TQQQ&kl_type=1H        → MACD calculation
GET /options/iv_rank?symbol=US.QQQM              → HV-based IV rank
GET /options/expiries?symbol=US.AAPL             → option expiry dates
GET /options/chain?symbol=US.AAPL&expiry=...     → option chain
GET /health                                       → connectivity check
```

### Market prefix logic
```python
US stocks: US.AAPL (default)
ASX stocks: AU.BHP  (exchange='ASX' or country='AU')
HK stocks:  HK.00700
```

### Daily prices cron
- Fetches only tickers in `portfolio_holdings` + `user_watchlist` + `portfolio_watchlist`
- Batch size: 20 tickers per bridge call
- count=5 (last 5 days) — handles weekends/holidays
- Failure tracking: 5 failures → `is_active = false`

### Bootstrap
- Triggered on watchlist add (fire-and-forget)
- Two-stage: count=10 (quick, ~3s) then count=752 (full history, ~30s)
- Marks `assets.bootstrapped = true` on success

---

## IV Rank

Calculated from Moomoo daily price history using HV (Historical Volatility) as proxy:
```
HV = annualised std dev of 30-day log returns
IV Rank = (current HV - 52w low HV) / (52w high HV - 52w low HV) × 100
```

Non-blocking when unavailable (builds history over time). Requires 252 days of price data for accurate rank.

---

## MACD Calculation

Uses `calcMACDSeries()` in cron:
- EMA seeded with SMA of first `period` values (standard initialisation)
- Fast EMA(12), Slow EMA(26), Signal EMA(9)
- MACD line from index 25 onwards
- `bullish_state` = MACD > Signal (triggers for DCA buy orders)
- `bearish_state` = MACD < Signal
- Needs 1000+ hourly candles for accurate results (3yr lookback in `/kline/macd`)

---

## User Settings

`profiles` table key columns:
- `trading_mode` — `paper` | `live`
- `trading_24h` — global 24H flag
- `trade_account` — Moomoo account ID
- `moomoo_password` — trade PIN (injected per-request)

Settings page: `src/app/dashboard/settings/page.tsx`
API: `src/app/api/user/settings/route.ts` — ALLOWED fields list controls what can be updated.

---

## Common Gotchas

1. **BRIDGE_URL changes on every tunnel restart** — update Vercel env var after restarting cloudflared
2. **not_before_time** — must save as `NULL` not `''`. Route uses `body.not_before_time || null`
3. **allow_24h** — must be in the conditional_orders POST insert or it defaults false
4. **strategy_id FK** — null it out before deleting `conditional_orders` or `option_strategies`
5. **is_active filter** — cron uses `.or('is_active.is.null,is_active.eq.true')` to handle both old and new orders
6. **Vercel Hobby plan** — only daily crons allowed. Minute-level cron runs via Windows Task Scheduler locally
7. **CRON_SECRET** — must be set in Vercel env vars. Fallback hardcoded in cron routes for testing
8. **createClient() is async** — must `await createClient()` in server routes
9. **Unicode in broker_service.py** — set `PYTHONIOENCODING=utf-8` or use ASCII banner to avoid CP1252 errors on Windows
10. **count=1 not faster than count=752** — Moomoo OpenD has fixed per-request overhead (~221ms). Fetch full history always

---

## DB Migrations Run

```sql
-- 24H trading
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS trading_24h boolean DEFAULT false;
ALTER TABLE conditional_orders ADD COLUMN IF NOT EXISTS allow_24h boolean DEFAULT false;

-- Strategy system
ALTER TABLE conditional_orders ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
ALTER TABLE conditional_orders ADD COLUMN IF NOT EXISTS strategy_id uuid REFERENCES option_strategies(id);
ALTER TABLE conditional_orders ADD COLUMN IF NOT EXISTS leg_num integer;
ALTER TABLE option_strategies ADD COLUMN IF NOT EXISTS leg1_order_ref text;
ALTER TABLE option_strategies ADD COLUMN IF NOT EXISTS leg2_order_ref text;
ALTER TABLE option_strategies ADD COLUMN IF NOT EXISTS pnl_snapshot numeric;
ALTER TABLE option_strategies ADD COLUMN IF NOT EXISTS pnl_updated_at timestamptz;
-- ... (see migration_strategies_v2.sql for full list)

-- FK constraint (recommended)
ALTER TABLE conditional_orders
  ADD CONSTRAINT conditional_orders_strategy_id_fkey
  FOREIGN KEY (strategy_id) REFERENCES option_strategies(id) ON DELETE SET NULL;
```

---

## Testing

```powershell
# Health check
Invoke-RestMethod -Uri "http://localhost:8765/health"

# Test prices
Invoke-RestMethod -Uri "http://localhost:8765/prices/daily?tickers=AAPL,QQQM&count=5"

# Test MACD
Invoke-RestMethod -Uri "http://localhost:8765/kline/macd?symbol=US.TQQQ&kl_type=1H"

# Test IV rank
Invoke-RestMethod -Uri "http://localhost:8765/options/iv_rank?symbol=US.QQQM"

# Trigger conditional orders cron
Invoke-RestMethod -Uri "https://www.betteroption.com.au/api/cron/conditional-orders" `
  -Headers @{ Authorization = "Bearer a3f8c2e1d4b7a9f0e3c6d2b5a8f1e4c7d0b3a6f9e2c5d8b1a4f7e0c3d6b9a2f5" }

# Bootstrap single ticker
Invoke-RestMethod -Uri "https://www.betteroption.com.au/api/cron/bootstrap?ticker=AAPL" `
  -Headers @{ Authorization = "Bearer a3f8c2e1d4b7a9f0e3c6d2b5a8f1e4c7d0b3a6f9e2c5d8b1a4f7e0c3d6b9a2f5" }

# Run daily prices cron
Invoke-RestMethod -Uri "https://www.betteroption.com.au/api/cron/prices" `
  -Headers @{ Authorization = "Bearer a3f8c2e1d4b7a9f0e3c6d2b5a8f1e4c7d0b3a6f9e2c5d8b1a4f7e0c3d6b9a2f5" }
```
