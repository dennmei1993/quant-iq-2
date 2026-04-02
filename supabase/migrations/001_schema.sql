-- ============================================================
-- Quant IQ — Full Database Schema v2
-- File: supabase/migrations/001_schema.sql
-- Run:  Paste into Supabase SQL Editor → Run All
-- ============================================================

-- ── Extensions ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ── Enums ────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE asset_class_enum AS ENUM ('equities','oil','metals','bonds','crypto','fx');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE direction_enum AS ENUM ('bullish','bearish','neutral');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── profiles ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            text NOT NULL,
  full_name        text,
  plan             text NOT NULL DEFAULT 'free'
                     CHECK (plan IN ('free','pro','advisor')),
  tier             text NOT NULL DEFAULT 'free',
  tier_updated_at  timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

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
  source          text,
  source_name     text,
  source_url      text UNIQUE,
  published_at    timestamptz NOT NULL,
  event_type      text CHECK (event_type IN (
                    'monetary_policy','geopolitical','corporate',
                    'economic_data','regulatory','market_structure')),
  sectors         text[],
  sentiment_score numeric(4,3) CHECK (sentiment_score BETWEEN -1 AND 1),
  impact_score    numeric(4,1) CHECK (impact_score BETWEEN 0 AND 10),
  tickers         text[],
  ai_processed    boolean DEFAULT false,
  ai_summary      text,
  created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_published    ON events(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_impact       ON events(impact_score DESC);
CREATE INDEX IF NOT EXISTS idx_events_composite    ON events(ai_processed, published_at DESC, impact_score DESC);
CREATE INDEX IF NOT EXISTS idx_events_sectors      ON events USING gin(sectors);
CREATE INDEX IF NOT EXISTS idx_events_tickers      ON events USING gin(tickers);

-- ── themes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS themes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  label            text,
  timeframe        text NOT NULL CHECK (timeframe IN ('1m','3m','6m')),
  conviction       integer CHECK (conviction BETWEEN 0 AND 100),
  momentum         text CHECK (momentum IN (
                     'strong_up','moderate_up','neutral',
                     'moderate_down','strong_down')),
  brief            text,
  candidate_tickers text[],
  is_active        boolean DEFAULT true,
  expires_at       timestamptz,
  -- Anchor scoring
  anchor_score     numeric(8,4) NOT NULL DEFAULT 0,
  anchor_event_id  uuid REFERENCES events(id) ON DELETE SET NULL,
  anchor_reason    text,
  anchored_since   timestamptz,
  is_anchored      boolean NOT NULL DEFAULT false,
  created_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_themes_active       ON themes(is_active, timeframe) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_themes_anchor       ON themes(anchor_score DESC);
CREATE INDEX IF NOT EXISTS idx_themes_created      ON themes(created_at DESC);

-- ── assets ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assets (
  ticker             text PRIMARY KEY,
  name               text NOT NULL,
  asset_type         text NOT NULL CHECK (asset_type IN ('stock','etf','crypto','commodity')),
  sector             text,
  description        text,
  is_active          boolean NOT NULL DEFAULT true,
  bootstrap_priority integer,          -- lower = process first in signal bootstrap
  market_cap_tier    text,             -- 'large','mid','small'
  created_at         timestamptz DEFAULT now()
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
CREATE INDEX IF NOT EXISTS idx_alerts_unread ON alerts(user_id, is_read) WHERE is_read = false;

-- ── subscriptions (Stripe) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_customer_id  text,
  stripe_sub_id       text,
  tier                text NOT NULL DEFAULT 'free',
  status              text NOT NULL DEFAULT 'inactive',
  current_period_end  timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_tier(uid uuid DEFAULT auth.uid())
RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(tier, 'free') FROM profiles WHERE id = uid;
$$;

CREATE OR REPLACE FUNCTION is_pro(uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(tier IN ('pro','advisor'), false) FROM profiles WHERE id = uid;
$$;

CREATE OR REPLACE FUNCTION is_admin(uid uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$
  SELECT COALESCE(tier = 'admin', false) FROM profiles WHERE id = uid;
$$;

CREATE OR REPLACE FUNCTION set_user_tier(target_user_id uuid, new_tier text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE profiles SET tier = new_tier, tier_updated_at = now() WHERE id = target_user_id;
  UPDATE subscriptions SET tier = new_tier, updated_at = now() WHERE user_id = target_user_id;
END;
$$;

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
ALTER TABLE subscriptions  ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "profiles_own"
  ON profiles USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- portfolios
CREATE POLICY "portfolios_own"
  ON portfolios USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- holdings
CREATE POLICY "holdings_own"
  ON holdings USING (
    EXISTS (SELECT 1 FROM portfolios p WHERE p.id = holdings.portfolio_id AND p.user_id = auth.uid())
  );

-- advisory_memos
CREATE POLICY "memos_own_read"
  ON advisory_memos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "memos_own_insert"
  ON advisory_memos FOR INSERT WITH CHECK (auth.uid() = user_id);

-- alerts
CREATE POLICY "alerts_own_read"
  ON alerts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "alerts_own_update"
  ON alerts FOR UPDATE USING (auth.uid() = user_id);

-- subscriptions
CREATE POLICY "subscriptions_own"
  ON subscriptions FOR SELECT USING (auth.uid() = user_id);

-- Shared read-only: any authenticated user
CREATE POLICY "events_authed_read"
  ON events FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "themes_authed_read"
  ON themes FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "assets_authed_read"
  ON assets FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "signals_authed_read"
  ON asset_signals FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================
-- SEED — investable universe
-- ============================================================

INSERT INTO assets (ticker, name, asset_type, sector, is_active, bootstrap_priority) VALUES
  -- Stocks (high priority)
  ('NVDA',  'NVIDIA Corp.',              'stock',     'technology',   true, 1),
  ('AAPL',  'Apple Inc.',                'stock',     'technology',   true, 2),
  ('MSFT',  'Microsoft Corp.',           'stock',     'technology',   true, 3),
  ('GOOGL', 'Alphabet Inc.',             'stock',     'technology',   true, 4),
  ('AMZN',  'Amazon.com Inc.',           'stock',     'consumer',     true, 5),
  ('META',  'Meta Platforms Inc.',       'stock',     'technology',   true, 6),
  ('JPM',   'JPMorgan Chase & Co.',      'stock',     'financials',   true, 7),
  ('XOM',   'Exxon Mobil Corp.',         'stock',     'energy',       true, 8),
  ('LMT',   'Lockheed Martin Corp.',     'stock',     'defence',      true, 9),
  ('UNH',   'UnitedHealth Group Inc.',   'stock',     'healthcare',   true, 10),
  -- ETFs
  ('SPY',   'SPDR S&P 500 ETF',          'etf',       'broad_market', true, 11),
  ('QQQ',   'Invesco QQQ Trust',         'etf',       'technology',   true, 12),
  ('GLD',   'SPDR Gold Shares',          'etf',       'commodities',  true, 13),
  ('TLT',   'iShares 20+ Yr Treasury',   'etf',       'bonds',        true, 14),
  ('XLE',   'Energy Select SPDR ETF',    'etf',       'energy',       true, 15),
  ('XLF',   'Financial Select SPDR',     'etf',       'financials',   true, 16),
  ('IWM',   'iShares Russell 2000 ETF',  'etf',       'broad_market', true, 17),
  -- Crypto
  ('BTC',   'Bitcoin',                   'crypto',    'crypto',       true, 18),
  ('ETH',   'Ethereum',                  'crypto',    'crypto',       true, 19),
  ('SOL',   'Solana',                    'crypto',    'crypto',       true, 20),
  -- Commodities
  ('GOLD',  'Gold Spot',                 'commodity', 'metals',       true, 21),
  ('OIL',   'WTI Crude Oil',             'commodity', 'energy',       true, 22),
  ('NG',    'Natural Gas',               'commodity', 'energy',       true, 23)
ON CONFLICT (ticker) DO NOTHING;

-- Seed default signals
INSERT INTO asset_signals (ticker, signal, score)
SELECT ticker, 'hold', 50.0 FROM assets
ON CONFLICT (ticker) DO NOTHING;

-- ============================================================
-- AUTO-CLEANUP: delete events older than 30 days
-- Prevents IO budget depletion on free tier
-- ============================================================

CREATE OR REPLACE FUNCTION delete_old_events()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM events WHERE published_at < NOW() - INTERVAL '30 days';
END;
$$;
