# Home Page — Install Guide

## Files to copy

```
home_page.tsx     → src/app/dashboard/page.tsx        (replaces existing)
HomeClient.tsx    → src/app/dashboard/HomeClient.tsx   (new file)
home.module.css   → src/app/dashboard/home.module.css (new file)
```

## DB table assumption — market_regimes

The home page reads from a `market_regimes` table with these columns:
  id          uuid
  label       text        e.g. "Risk-off · Defensive"
  bias        text        'bullish' | 'bearish' | 'neutral'
  conviction  int         0–100
  description text        plain-English explanation
  is_active   boolean
  updated_at  timestamptz

If your table has different column names, update the `.select()` in home_page.tsx line ~70.

## DB table assumption — user_portfolio

Reads from `user_portfolio` with:
  user_id    uuid
  ticker     text
  quantity   numeric
  cost_basis numeric   (per share cost)

If your portfolio table has different column names (e.g. `shares` instead of `quantity`),
update the select on line ~95 of home_page.tsx.

## DB table assumption — alerts

Reads from `alerts` with:
  user_id    uuid
  title      text
  body       text
  is_read    boolean
  alert_type text
  created_at timestamptz

## What's auto-derived (no extra DB work needed)

- Macro snapshot (avg_sentiment, signals_today, buy/avoid counts) — derived from events + asset_signals
- Portfolio P&L — derived from user_portfolio × asset_signals prices
- Suggested actions — derived from regime bias + top themes + portfolio state
- All existing tables (events, themes, asset_signals) used as-is

## Discover page route

The Themes "All →" link and action items point to `/dashboard/discover`.
This page doesn't exist yet — it will be built next iteration.
For now you can change these links to `/dashboard/themes` temporarily:

  In HomeClient.tsx, replace:
    href="/dashboard/discover"
  with:
    href="/dashboard/themes"

## git commands

```powershell
git add src/app/dashboard/page.tsx
git add src/app/dashboard/HomeClient.tsx
git add src/app/dashboard/home.module.css
git commit -m "New home page with regime, macro, themes, events, portfolio"
git push
```
