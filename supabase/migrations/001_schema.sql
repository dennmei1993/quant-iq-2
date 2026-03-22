-- ============================================================
-- Quant IQ — Full Database Schema
-- File: supabase/migrations/001_schema.sql
-- Run:  supabase db push   OR   paste into Supabase SQL Editor
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── profiles ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id                     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email                  text NOT NULL,
  full_name              text,
  plan                   text NOT NULL DEFAULT 'free'
                           CHECK (plan IN ('free','pro','advisor')),
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO profiles (id, email)
  VALUES (new.id, new.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ── events ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  headline        text NOT NULL,
  source          text CHECK (source IN ('newsapi','fred','edgar','manual')),
  source_url      text UNIQUE,
  published_at    timestamptz NOT NULL,
  event_type      text CHECK (event_type IN (
                    'monetary_policy','geopolitical','corporate',
                    'economic_data','regulatory','market_structure')),
  sectors         text[],
  sentiment_score numeric(4,3) CHECK (sentiment_score BETWEEN -1 AND 1),
  impact_level    text CHECK (impact_level IN ('low','medium','high')),
  tickers         text[],
  ai_processed    boolean DEFAULT false,
  ai_summary      text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_sectors   ON events USING gin(sectors);
CREATE INDEX IF NOT EXISTS idx_events_tickers   ON events USING gin(tickers);
CREATE INDEX IF NOT EXISTS idx_events_published ON events(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_impact    ON events(impact_level, published_at DESC);

-- ── themes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS themes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  label             text,
  timeframe         text NOT NULL CHECK (timeframe IN ('1m','3m','6m')),
  conviction        integer CHECK (conviction BETWEEN 0 AND 100),
  momentum          text CHECK (momentum IN (
                      'strong_up','moderate_up','neutral',
                      'moderate_down','strong_down')),
  brief             text,
  candidate_tickers text[],
  is_active         boolean DEFAULT true,
  expires_at        timestamptz,
  created_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_themes_active  ON themes(is_active, timeframe);
CREATE INDEX IF NOT EXISTS idx_themes_created ON themes(created_at DESC);

-- ── assets (investable universe) ─────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  ticker      text PRIMARY KEY,
  name        text NOT NULL,
  asset_type  text NOT NULL CHECK (asset_type IN ('stock','etf','crypto','commodity')),
  sector      text,
  description text,
  created_at  timestamptz DEFAULT now()
);

-- ── asset_signals ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS asset_signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker      text NOT NULL REFERENCES assets(ticker) ON DELETE CASCADE,
  signal      text NOT NULL CHECK (signal IN ('buy','watch','hold','avoid')),
  score       numeric(5,2),
  price_usd   numeric(14,4),
  change_pct  numeric(7,3),
  sparkline   numeric[],       -- last 7 daily closes
  rationale   text,
  updated_at  timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_ticker ON asset_signals(ticker);
CREATE        INDEX IF NOT EXISTS idx_signals_signal ON asset_signals(signal);

-- ── portfolios ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portfolios (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL DEFAULT 'My Portfolio',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id);

-- ── holdings ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS holdings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id uuid NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  ticker       text NOT NULL,
  name         text,
  asset_type   text,
  quantity     numeric(18,8),
  avg_cost     numeric(14,4),
  notes        text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_holdings_portfolio ON holdings(portfolio_id);

-- ── advisory_memos ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS advisory_memos (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  portfolio_id uuid REFERENCES portfolios(id) ON DELETE SET NULL,
  content      text NOT NULL,
  model        text DEFAULT 'claude-sonnet-4-20250514',
  token_count  integer,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memos_user ON advisory_memos(user_id, created_at DESC);

-- ── alerts ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN (
               'portfolio_risk','new_theme','macro_shift',
               'theme_update','price_move')),
  title      text NOT NULL,
  body       text,
  ticker     text,
  is_read    boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user   ON alerts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(user_id, is_read)
  WHERE is_read = false;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios     ENABLE ROW LEVEL SECURITY;
ALTER TABLE holdings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE advisory_memos ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE themes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset_signals  ENABLE ROW LEVEL SECURITY;

-- User-owned tables: full CRUD on own rows
CREATE POLICY "profiles_own"
  ON profiles USING (auth.uid() = id);

CREATE POLICY "portfolios_own"
  ON portfolios USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "holdings_own"
  ON holdings USING (
    EXISTS (SELECT 1 FROM portfolios p
            WHERE p.id = holdings.portfolio_id AND p.user_id = auth.uid())
  );

CREATE POLICY "memos_own_read"
  ON advisory_memos FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "alerts_own_read"
  ON alerts FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "alerts_own_update"
  ON alerts FOR UPDATE USING (auth.uid() = user_id);

-- Shared read-only tables: any authenticated user
CREATE POLICY "events_authed_read"
  ON events FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "themes_authed_read"
  ON themes FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "assets_authed_read"
  ON assets FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "signals_authed_read"
  ON asset_signals FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- SEED — 23-asset investable universe
-- ============================================================

INSERT INTO assets (ticker, name, asset_type, sector) VALUES
  ('AAPL',  'Apple Inc.',                'stock',     'technology'),
  ('MSFT',  'Microsoft Corp.',           'stock',     'technology'),
  ('NVDA',  'NVIDIA Corp.',              'stock',     'technology'),
  ('GOOGL', 'Alphabet Inc.',             'stock',     'technology'),
  ('AMZN',  'Amazon.com Inc.',           'stock',     'consumer'),
  ('META',  'Meta Platforms Inc.',       'stock',     'technology'),
  ('JPM',   'JPMorgan Chase & Co.',      'stock',     'financials'),
  ('XOM',   'Exxon Mobil Corp.',         'stock',     'energy'),
  ('LMT',   'Lockheed Martin Corp.',     'stock',     'defence'),
  ('UNH',   'UnitedHealth Group Inc.',   'stock',     'healthcare'),
  ('SPY',   'SPDR S&P 500 ETF',          'etf',       'broad_market'),
  ('QQQ',   'Invesco QQQ Trust',         'etf',       'technology'),
  ('GLD',   'SPDR Gold Shares',          'etf',       'commodities'),
  ('TLT',   'iShares 20+ Yr Treasury',   'etf',       'bonds'),
  ('XLE',   'Energy Select SPDR ETF',    'etf',       'energy'),
  ('XLF',   'Financial Select SPDR',     'etf',       'financials'),
  ('IWM',   'iShares Russell 2000 ETF',  'etf',       'broad_market'),
  ('BTC',   'Bitcoin',                   'crypto',    'crypto'),
  ('ETH',   'Ethereum',                  'crypto',    'crypto'),
  ('SOL',   'Solana',                    'crypto',    'crypto'),
  ('GOLD',  'Gold Spot',                 'commodity', 'metals'),
  ('OIL',   'WTI Crude Oil',             'commodity', 'energy'),
  ('NG',    'Natural Gas',               'commodity', 'energy')
ON CONFLICT (ticker) DO NOTHING;

-- Seed default signals (overwritten by cron after first run)
INSERT INTO asset_signals (ticker, signal, score)
SELECT ticker, 'hold', 50.0 FROM assets
ON CONFLICT (ticker) DO NOTHING;
