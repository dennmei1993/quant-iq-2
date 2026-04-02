# Quant IQ — Product Vision & Roadmap
*Last updated: March 2026*

---

## 1. Platform Purpose

Quant IQ is an AI-powered macro intelligence platform for self-directed retail investors. It bridges the gap between overwhelming financial data and actionable investment decisions — not by displaying more information, but by structuring it into clear, contextualised guidance.

**Core job-to-be-done:**
The platform answers three questions every primary investor has:
1. *"Is my portfolio well-positioned for current market conditions?"*
2. *"What should I change, and why?"*
3. *"How am I doing compared to just buying SPY?"*

---

## 2. Target Users

### Primary — The Self-Directed Retail Investor
The core audience. Designs all UX decisions.

**Profile:**
- Manages own portfolio, not delegating to a fund manager
- Has some financial literacy but is not a professional analyst
- Spends 2–5 hours per week on investment research
- Uses a mix of news, broker platforms, and gut feel today
- Wants to be smarter without spending more time

**Pain points today:**
- Financial news is overwhelming — hard to filter signal from noise
- Broker platforms show data but don't help interpret it
- Professional analysis (Bloomberg, Morningstar) is expensive and jargon-heavy
- Misses opportunities because they don't have time to monitor everything
- Second-guesses timing — "should I buy now or wait?"

**What they want:**
- *Clarity* — tell me what's worth paying attention to right now
- *Confidence* — give me a reason for the signal, not just a number
- *Timeliness* — alert me when something changes, don't make me check daily
- *Context* — is this a good company AND is now a good time?
- *Simplicity* — don't make me learn a new financial framework

---

### Secondary — The Active Trader
- Checks markets daily, trades more frequently
- Comfortable with technical analysis
- Wants momentum signals, MA crossovers, RSI levels
- Cares more about technical score than fundamental
- Would use risk appetite toggle (aggressive mode)

---

### Tertiary — The Macro-Aware Investor
- Invests thematically (e.g. "I believe AI is the next big thing")
- Wants to know which tickers align with macro trends
- Cares about themes, sector rotation, geopolitical impacts
- Less interested in individual stock technicals
- Uses themes page and macro heatmap heavily

---

## 3. UX Philosophy

> Every page should have a **single primary action or insight** — not just a table of data.

The platform is not an information display tool. It is a portfolio advisor. The difference:

| Information Display | Portfolio Advisor |
|---|---|
| "AAPL signal: Hold, F=53, T=45" | "AAPL needs Technical +15 to upgrade to Watch" |
| "Your holdings: AAPL, MSFT, LMT..." | "Your portfolio is 68% aligned with current market conditions" |
| "SPY is up 1.8% this month" | "You're outperforming SPY by +2.4% this month" |

---

## 4. Signal Architecture

### Two-Dimensional Signal Model

Signals are computed on two orthogonal dimensions:

#### Fundamental Score (0–100) — "Quality & Tailwinds"
Answers: *Is this a good company in a favourable environment?*

| Component | Weight | Source |
|---|---|---|
| Valuation (PE vs sector avg) | 20% | FMP ratios-ttm |
| Profitability (margin + EPS growth) | 20% | FMP ratios-ttm |
| Consensus (analyst Buy/Hold/Sell) | 20% | FMP grades-consensus |
| Theme conviction | 20% | theme_tickers table |
| Macro alignment | 20% | macro_scores × sector map |

#### Technical Score (0–100) — "Is now the right time?"
Answers: *Is the market confirming the fundamental view?*

| Component | Weight | Source |
|---|---|---|
| Trend (price vs 5d/20d MA) | 30% | sparkline (30d closes) |
| Momentum (RSI 14) | 25% | sparkline |
| Relative strength vs SPY | 25% | sparkline + SPY sparkline |
| Volatility (inverse) | 20% | sparkline |

#### Signal Matrix (moderate default)

| Fundamental | Technical | Signal |
|---|---|---|
| F ≥ 65 | T ≥ 60 | **BUY** |
| F ≥ 65 | T ≥ 40 | **WATCH** |
| F ≥ 65 | T < 40 | **HOLD** |
| F 40–64 | T ≥ 60 | **WATCH** |
| F 40–64 | T < 60 | **HOLD** |
| F < 40 | T ≥ 60 | **HOLD** |
| F < 40 | T < 40 | **AVOID** |

#### Risk Appetite
Shifts the Technical threshold:
- **Aggressive**: T threshold –10 (acts sooner on momentum)
- **Moderate**: default thresholds
- **Conservative**: T threshold +10 (requires stronger confirmation)

Stored per user in `profiles.risk_appetite`.

#### Signal Upgrade Path
When signal is not BUY, the ticker page shows:
- Next achievable signal
- F gap and T gap in points
- Plain English explanation of what needs to change (e.g. "Price needs to sustain above MA20", "Next earnings report is a key catalyst")

---

## 5. Platform Structure (Target State)

### Dashboard — "Your Portfolio Health"
Single-screen answer to "how am I positioned today?"
- Portfolio signal distribution (Buy/Watch/Hold/Avoid breakdown)
- Portfolio alignment score vs current themes + macro
- Performance vs SPY (7d, 30d, 90d, 1yr)
- Top alert: signal changes on watched/held tickers
- Suggested action: highest-conviction opportunity right now

### Portfolio Builder — "Structure your portfolio"
Active advisor, not just a holdings list:
- Holdings with signal, weight, and sector
- Portfolio gaps: missing high-conviction themes/sectors
- Over-exposure warnings (concentration risk)
- Rebalancing suggestions based on current signals
- Risk profile toggle that re-weights suggestions

### Asset Screener — "Find opportunities"
Already exists, needs a portfolio lens:
- Filter by "not in my portfolio"
- Sort by signal strength × theme conviction
- "Add to portfolio" with target weight from screener

### Ticker Detail — "Should I buy/hold/sell this?"
Current state is well-built. Future additions:
- "How would adding this affect my portfolio balance?"
- Sector comparison vs current holdings

### Performance — "How am I doing?"
New page:
- Portfolio value over time vs SPY (and ASX200 for AU users)
- Risk-adjusted return
- Attribution by holding and by theme
- Example: "Energy theme contributed +3.2% this month"

### Alerts — "Tell me when something matters"
- Signal change alerts (e.g. LMT flipped Hold → Buy)
- Price threshold alerts
- Weekly digest email: portfolio health summary

---

## 6. Build Roadmap

### Phase 1 — Portfolio Intelligence *(current focus)*
1. Portfolio performance page vs SPY benchmark
2. Portfolio signal distribution widget on dashboard
3. Concentration + sector exposure analysis
4. Signal change detection (flag when signal changes in DB)

### Phase 2 — Active Advisor
5. Portfolio alignment score vs current themes/macro
6. Rebalancing suggestions
7. Gap analysis (missing themes/sectors)
8. Alert emails on signal changes

### Phase 3 — Growth
9. Weekly digest email
10. Price threshold alerts
11. "Add this ticker" — portfolio impact preview
12. Broker API integration (manual entry for now)

---

## 7. Current Technical Stack

### Data Sources
| Source | Purpose | Plan |
|---|---|---|
| Polygon.io | Price, sparkline, OHLCV | Free tier (5 req/min) |
| FMP (Financial Modeling Prep) | PE, EPS, P/B, analyst ratings, dividend yield, profit margin | Starter |
| Anthropic Claude API | Signal rationale, event classification, theme generation, macro scoring | Pay per use |

### Key Data Flows
```
Daily cron (6am UTC Mon):
  Polygon → prices + sparklines
  → signal-scorer.ts (fundamental + technical)
  → asset_signals (signal, f/t scores, components)

Weekly cron (5am UTC Sun):
  FMP → PE, EPS, analyst ratings
  → assets table (financials_updated_at)
  → trigger signal re-score

On ticker page visit:
  if no signal or sparkline → auto-sync from Polygon
  if no FMP data or stale (>7d) → auto-sync from FMP
  if no rationale or signal changed → generate via Claude
```

### Asset Universe
- 152 tickers total: 80 stocks, 34 ETFs, 23 crypto, 15 commodities
- Bootstrap priority 1: 17 core tickers (daily sync)
- Bootstrap priority 2: 116 tickers (on-demand + weekly)
- FMP coverage: 77/80 stocks have PE + analyst rating

### Database Schema (key tables)
```
assets           — ticker metadata, FMP financials
asset_signals    — price, signal, fundamental_score, technical_score, f/t components, sparkline, rationale
themes           — active investment themes with conviction scores
theme_tickers    — ticker ↔ theme mappings with weights
macro_scores     — 6 macro aspects scored –10 to +10
events           — RSS-ingested news, AI-classified with sentiment + impact
user_watchlist   — per-user watchlist
holdings         — per-user portfolio holdings
profiles         — user settings including risk_appetite
```

### Infrastructure
- Next.js 15 (App Router) on Vercel Hobby plan
- Supabase (PostgreSQL + Auth)
- 4 daily crons (ingest, macro, themes, financials)
- FMP cron manual-only (5th cron exceeds Hobby limit)

---

## 8. Design Principles

1. **Advice over data** — every screen should tell the user what to do, not just what is
2. **Context over raw numbers** — a score of 53/100 means nothing; "below threshold for Buy" means something
3. **Progressive disclosure** — show the signal first, the reason second, the components third
4. **Mobile-first simplicity** — primary investor checks on phone, not a Bloomberg terminal
5. **Earn trust through transparency** — show *why* the signal is what it is, not just what it is

---

## 9. Open Questions / Future Decisions

- **Broker API integration**: manual entry for now — which broker APIs to support later? (CommSec, SelfWealth, Interactive Brokers)
- **Pricing model**: freemium (free screener, paid portfolio advisor) vs subscription-only
- **Benchmark**: SPY as default — add ASX200 for AU users?
- **Mobile app**: progressive web app vs native iOS/Android
- **Social features**: shared watchlists, community themes — future Phase 4
