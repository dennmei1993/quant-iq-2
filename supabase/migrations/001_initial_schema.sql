-- ============================================================
-- Quant IQ — Initial Schema
-- Run in Supabase SQL Editor or via: supabase db push
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  full_name    text,
  plan         text not null default 'free' check (plan in ('free', 'pro', 'advisor')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Auto-create profile when user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- EVENTS (macro/geopolitical news signals)
-- ============================================================
create table public.events (
  id              uuid primary key default uuid_generate_v4(),
  headline        text not null,
  summary         text,
  source          text,                        -- 'newsapi' | 'fred' | 'edgar' | 'manual'
  source_url      text,
  published_at    timestamptz not null,
  ingested_at     timestamptz not null default now(),

  -- AI classification
  event_type      text,                        -- 'monetary_policy' | 'geopolitical' | 'corporate' | 'economic_data' | 'regulatory'
  region          text default 'US',
  sectors         text[],                      -- ['technology', 'energy', 'financials', ...]
  sentiment_score numeric(4,3),                -- -1.000 to +1.000
  impact_level    text check (impact_level in ('low', 'medium', 'high')),
  tickers         text[],                      -- ['NVDA', 'SPY', ...]
  ai_processed    boolean not null default false,
  ai_summary      text,                        -- LLM-generated 2-sentence brief

  created_at      timestamptz not null default now()
);

create index events_published_at_idx on public.events(published_at desc);
create index events_sectors_idx on public.events using gin(sectors);
create index events_tickers_idx on public.events using gin(tickers);
create index events_sentiment_idx on public.events(sentiment_score);

-- ============================================================
-- THEMES (investment themes derived from clustered events)
-- ============================================================
create table public.themes (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,
  label           text not null,               -- e.g. 'Technology', 'Defence'
  timeframe       text not null check (timeframe in ('1m', '3m', '6m')),
  conviction      integer not null check (conviction between 0 and 100),
  momentum        text check (momentum in ('strong_up', 'moderate_up', 'neutral', 'moderate_down', 'strong_down')),
  brief           text,                        -- AI-generated investment thesis
  supporting_event_ids uuid[],
  candidate_tickers    text[],
  is_active       boolean not null default true,
  generated_at    timestamptz not null default now(),
  expires_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index themes_timeframe_idx on public.themes(timeframe);
create index themes_active_idx on public.themes(is_active, conviction desc);

-- ============================================================
-- ASSETS (candidate investment assets)
-- ============================================================
create table public.assets (
  id              uuid primary key default uuid_generate_v4(),
  ticker          text not null unique,
  name            text not null,
  asset_type      text not null check (asset_type in ('stock', 'etf', 'crypto', 'commodity')),
  sector          text,
  description     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ============================================================
-- ASSET SIGNALS (per-asset signal scores, updated regularly)
-- ============================================================
create table public.asset_signals (
  id              uuid primary key default uuid_generate_v4(),
  asset_id        uuid not null references public.assets(id) on delete cascade,
  theme_id        uuid references public.themes(id) on delete set null,
  signal          text not null check (signal in ('buy', 'watch', 'hold', 'avoid')),
  score           numeric(4,3),                -- -1.000 to +1.000
  rationale       text,
  price_at_signal numeric(12,4),
  scored_at       timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index asset_signals_asset_idx on public.asset_signals(asset_id, scored_at desc);

-- ============================================================
-- PORTFOLIOS (user portfolio)
-- ============================================================
create table public.portfolios (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  name            text not null default 'My Portfolio',
  created_at      timestamptz not null default now()
);

create table public.holdings (
  id              uuid primary key default uuid_generate_v4(),
  portfolio_id    uuid not null references public.portfolios(id) on delete cascade,
  ticker          text not null,
  name            text,
  asset_type      text check (asset_type in ('stock', 'etf', 'crypto', 'commodity')),
  quantity        numeric(18,8),
  avg_cost        numeric(12,4),
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index holdings_portfolio_idx on public.holdings(portfolio_id);

-- ============================================================
-- ADVISORY MEMOS (LLM-generated portfolio impact reports)
-- ============================================================
create table public.advisory_memos (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  portfolio_id    uuid references public.portfolios(id) on delete set null,
  trigger_event_id uuid references public.events(id) on delete set null,
  memo_text       text not null,
  risk_score      integer check (risk_score between 0 and 100),
  affected_tickers text[],
  generated_at    timestamptz not null default now()
);

create index advisory_memos_user_idx on public.advisory_memos(user_id, generated_at desc);

-- ============================================================
-- ALERTS
-- ============================================================
create table public.alerts (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  alert_type      text not null check (alert_type in ('portfolio_risk', 'new_theme', 'macro_shift', 'theme_update')),
  title           text not null,
  body            text,
  related_event_id uuid references public.events(id) on delete set null,
  related_theme_id uuid references public.themes(id) on delete set null,
  is_read         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index alerts_user_idx on public.alerts(user_id, is_read, created_at desc);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles        enable row level security;
alter table public.portfolios       enable row level security;
alter table public.holdings         enable row level security;
alter table public.advisory_memos  enable row level security;
alter table public.alerts           enable row level security;

-- Public tables (read-only for authenticated users)
alter table public.events          enable row level security;
alter table public.themes          enable row level security;
alter table public.assets          enable row level security;
alter table public.asset_signals   enable row level security;

-- Profiles: users can read/update their own
create policy "profiles: own read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: own update" on public.profiles for update using (auth.uid() = id);

-- Portfolios: own CRUD
create policy "portfolios: own"      on public.portfolios for all using (auth.uid() = user_id);
create policy "holdings: own"        on public.holdings   for all
  using (portfolio_id in (select id from public.portfolios where user_id = auth.uid()));

-- Advisory memos / alerts: own read
create policy "memos: own read"      on public.advisory_memos for select using (auth.uid() = user_id);
create policy "alerts: own read"     on public.alerts          for select using (auth.uid() = user_id);
create policy "alerts: own update"   on public.alerts          for update using (auth.uid() = user_id);

-- Events, themes, assets: any authenticated user can read
create policy "events: auth read"       on public.events       for select using (auth.role() = 'authenticated');
create policy "themes: auth read"       on public.themes       for select using (auth.role() = 'authenticated');
create policy "assets: auth read"       on public.assets       for select using (auth.role() = 'authenticated');
create policy "asset_signals: auth read" on public.asset_signals for select using (auth.role() = 'authenticated');

-- ============================================================
-- SEED: starter assets
-- ============================================================
insert into public.assets (ticker, name, asset_type, sector) values
  ('NVDA',  'Nvidia Corp',               'stock',     'technology'),
  ('AAPL',  'Apple Inc',                 'stock',     'technology'),
  ('MSFT',  'Microsoft Corp',            'stock',     'technology'),
  ('AMD',   'Advanced Micro Devices',    'stock',     'technology'),
  ('AMAT',  'Applied Materials',         'stock',     'technology'),
  ('LMT',   'Lockheed Martin',           'stock',     'defence'),
  ('RTX',   'RTX Corp',                  'stock',     'defence'),
  ('NOC',   'Northrop Grumman',          'stock',     'defence'),
  ('PLTR',  'Palantir Technologies',     'stock',     'technology'),
  ('XOM',   'Exxon Mobil',               'stock',     'energy'),
  ('FSLR',  'First Solar',               'stock',     'energy'),
  ('NEE',   'NextEra Energy',            'stock',     'energy'),
  ('SPY',   'SPDR S&P 500 ETF',          'etf',       'broad_market'),
  ('QQQ',   'Invesco QQQ Trust',         'etf',       'technology'),
  ('GLD',   'SPDR Gold Shares',          'etf',       'commodities'),
  ('TLT',   'iShares 20+ Year Treasury', 'etf',       'bonds'),
  ('XLE',   'Energy Select Sector ETF',  'etf',       'energy'),
  ('ICLN',  'iShares Clean Energy ETF',  'etf',       'energy'),
  ('BTC',   'Bitcoin',                   'crypto',    NULL),
  ('ETH',   'Ethereum',                  'crypto',    NULL),
  ('GC=F',  'Gold Futures',              'commodity', 'precious_metals'),
  ('CL=F',  'WTI Crude Oil',             'commodity', 'energy'),
  ('SI=F',  'Silver Futures',            'commodity', 'precious_metals');
