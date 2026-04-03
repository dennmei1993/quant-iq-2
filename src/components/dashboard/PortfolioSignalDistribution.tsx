// src/components/dashboard/PortfolioSignalDistribution.tsx

"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  type Portfolio,
  type RiskAppetite,
  PREFERENCE_LABELS,
} from "@/types/portfolio-preferences";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type SignalLabel = "BUY" | "WATCH" | "HOLD" | "AVOID" | "CASH" | "UNSCORED";

interface Holding {
  id:         string;
  ticker:     string;
  quantity:   number | null;
  avg_cost:   number | null;
  name:       string | null;
  asset_type: string | null;
}

interface AssetSignal {
  ticker:            string;
  signal:            string;
  fundamental_score: number | null;
  technical_score:   number | null;
  price_usd:         number | null;
}

interface DistributionBucket {
  label:   SignalLabel;
  count:   number;
  value:   number;   // USD market value
  pct:     number;   // % of total portfolio value
  tickers: string[];
}

interface Props {
  userId: string;
}

// ----------------------------------------------------------------------------
// Signal thresholds
// ----------------------------------------------------------------------------

const T_THRESHOLD: Record<RiskAppetite, { buy: number; watch: number }> = {
  aggressive:   { buy: 50, watch: 30 },
  moderate:     { buy: 60, watch: 40 },
  conservative: { buy: 70, watch: 50 },
};

function computeSignal(
  f: number | null,
  t: number | null,
  appetite: RiskAppetite
): SignalLabel {
  if (f === null || t === null) return "UNSCORED";
  const { buy, watch } = T_THRESHOLD[appetite];

  if (f >= 65 && t >= buy)   return "BUY";
  if (f >= 65 && t >= watch) return "WATCH";
  if (f >= 65)               return "HOLD";
  if (f >= 40 && t >= buy)   return "WATCH";
  if (f >= 40)               return "HOLD";
  if (t >= buy)              return "HOLD";
  if (t < watch)             return "AVOID";
  return "HOLD";
}

// ----------------------------------------------------------------------------
// Visual config
// ----------------------------------------------------------------------------

const SIGNAL_CONFIG: Record<
  SignalLabel,
  { color: string; bg: string; border: string; description: string }
> = {
  BUY:      { color: "#00d97e", bg: "rgba(0,217,126,0.08)",   border: "rgba(0,217,126,0.25)",   description: "Strong conviction -- quality + timing aligned" },
  WATCH:    { color: "#f0b429", bg: "rgba(240,180,41,0.08)",  border: "rgba(240,180,41,0.25)",  description: "Good fundamentals, waiting on technicals" },
  HOLD:     { color: "#a0aec0", bg: "rgba(160,174,192,0.06)", border: "rgba(160,174,192,0.2)",  description: "Keep position, no action needed" },
  AVOID:    { color: "#fc5c65", bg: "rgba(252,92,101,0.08)",  border: "rgba(252,92,101,0.25)",  description: "Weak fundamentals and technicals" },
  CASH:     { color: "#63b3ed", bg: "rgba(99,179,237,0.08)",  border: "rgba(99,179,237,0.25)",  description: "Uninvested capital available to deploy" },
  UNSCORED: { color: "#718096", bg: "rgba(113,128,150,0.06)", border: "rgba(113,128,150,0.15)", description: "Signal not yet computed" },
};

const SIGNAL_ORDER: SignalLabel[] = ["BUY", "WATCH", "HOLD", "AVOID", "CASH", "UNSCORED"];

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function holdingValue(h: Holding, signals: Map<string, AssetSignal>): number {
  // CASH: balance stored in avg_cost directly
  if (h.ticker === "CASH") return h.avg_cost ?? 0;
  const price = signals.get(h.ticker)?.price_usd ?? h.avg_cost ?? 0;
  return price * (h.quantity ?? 0);
}

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000)     return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export function PortfolioSignalDistribution({ userId }: Props) {
  const supabase = createClient();

  const [portfolios,     setPortfolios]     = useState<Portfolio[]>([]);
  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [holdings,       setHoldings]       = useState<Holding[]>([]);
  const [signals,        setSignals]        = useState<Map<string, AssetSignal>>(new Map());
  const [loading,        setLoading]        = useState(true);
  const [savingPref,     setSavingPref]     = useState(false);

  // Load all portfolios for this user
  useEffect(() => {
    async function loadPortfolios() {
      const { data, error } = await supabase
        .from("portfolios")
        .select(`
          id, name, user_id, created_at,
          risk_appetite, benchmark, target_holdings,
          preferred_assets, cash_pct, investment_horizon
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: true });

      if (error) { console.error(error); return; }
      setPortfolios((data ?? []) as Portfolio[]);
      if (data?.length) setSelectedId(data[0].id);
    }
    loadPortfolios();
  }, [userId]);

  // Load holdings + signals for selected portfolio
  const loadPortfolioData = useCallback(async (portfolioId: string) => {
    setLoading(true);

    const { data: holdingsData, error: hErr } = await supabase
      .from("holdings")
      .select("id, ticker, quantity, avg_cost, name, asset_type")
      .eq("portfolio_id", portfolioId);

    if (hErr) { console.error(hErr); setLoading(false); return; }

    const tickers = (holdingsData ?? [])
      .map((h) => h.ticker)
      .filter((t) => t !== "CASH");

    let signalMap = new Map<string, AssetSignal>();
    if (tickers.length > 0) {
      const { data: signalData, error: sErr } = await supabase
        .from("asset_signals")
        .select("ticker, signal, fundamental_score, technical_score, price_usd")
        .in("ticker", tickers);

      if (sErr) console.error(sErr);
      else signalData?.forEach((s) => signalMap.set(s.ticker, s));
    }

    setHoldings(holdingsData ?? []);
    setSignals(signalMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedId) loadPortfolioData(selectedId);
  }, [selectedId, loadPortfolioData]);

  // Derived state
  const selectedPortfolio = portfolios.find((p) => p.id === selectedId) ?? null;
  const appetite: RiskAppetite = selectedPortfolio?.risk_appetite ?? "moderate";

  const totalValue = holdings.reduce((sum, h) => sum + holdingValue(h, signals), 0);

  const distribution = SIGNAL_ORDER.map((label) => {
    const matched = holdings.filter((h) => {
      if (label === "CASH")    return h.ticker === "CASH";
      if (h.ticker === "CASH") return false;
      const sig = signals.get(h.ticker);
      return computeSignal(
        sig?.fundamental_score ?? null,
        sig?.technical_score ?? null,
        appetite
      ) === label;
    });

    const value = matched.reduce((s, h) => s + holdingValue(h, signals), 0);
    return {
      label,
      count:   matched.length,
      value,
      pct:     totalValue > 0 ? (value / totalValue) * 100 : 0,
      tickers: matched.map((h) => h.ticker),
    } as DistributionBucket;
  });

  // Update any single portfolio preference and optimistically reflect in state
  async function updatePreference<K extends keyof Portfolio>(
    key: K,
    value: Portfolio[K]
  ) {
    if (!selectedId) return;
    setSavingPref(true);

    const { error } = await supabase
      .from("portfolios")
      .update({ [key]: value })
      .eq("id", selectedId);

    if (!error) {
      setPortfolios((prev) =>
        prev.map((p) => (p.id === selectedId ? { ...p, [key]: value } : p))
      );
    }
    setSavingPref(false);
  }

  // ----------------------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------------------

  if (!portfolios.length && !loading) return <EmptyPortfolioState />;

  const cashBucket     = distribution.find((b) => b.label === "CASH");
  const unscoredBucket = distribution.find((b) => b.label === "UNSCORED");
  const investedBuckets = distribution.filter(
    (b) => b.label !== "CASH" && b.label !== "UNSCORED" && b.count > 0
  );

  return (
    <div className="qiq-signal-dist">

      {/* Portfolio tabs + risk appetite */}
      <div className="port-header">
        <div className="port-tabs">
          {portfolios.map((p) => (
            <button
              key={p.id}
              className={`port-tab ${p.id === selectedId ? "active" : ""}`}
              onClick={() => setSelectedId(p.id)}
            >
              {p.name}
              <span className="port-tab-badge">
                {p.risk_appetite[0].toUpperCase()}
              </span>
            </button>
          ))}
        </div>

        {selectedPortfolio && (
          <div className="appetite-control">
            <span className="appetite-label">Risk</span>
            <div className="appetite-pills">
              {(["aggressive", "moderate", "conservative"] as RiskAppetite[]).map((a) => (
                <button
                  key={a}
                  disabled={savingPref}
                  className={`appetite-pill ${appetite === a ? "active" : ""}`}
                  onClick={() => updatePreference("risk_appetite", a)}
                >
                  {PREFERENCE_LABELS.risk_appetite[a]}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <LoadingState />
      ) : (
        <>
          {/* Total portfolio value */}
          <div className="total-row">
            <span className="total-label">Portfolio Value</span>
            <span className="total-value">{formatCurrency(totalValue)}</span>
          </div>

          {/* Distribution bar */}
          <DistributionBar buckets={distribution} />

          {/* Signal bucket cards */}
          <div className="buckets-grid">
            {investedBuckets.map((bucket) => (
              <BucketCard key={bucket.label} bucket={bucket} />
            ))}
          </div>

          {/* Cash + unscored */}
          <div className="secondary-row">
            {cashBucket && <CashCard bucket={cashBucket} />}
            {unscoredBucket && unscoredBucket.count > 0 && (
              <BucketCard bucket={unscoredBucket} small />
            )}
          </div>

          {/* Alignment summary */}
          <AlignmentSummary
            buckets={distribution}
            portfolio={selectedPortfolio}
          />
        </>
      )}

      <style>{styles}</style>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function DistributionBar({ buckets }: { buckets: DistributionBucket[] }) {
  return (
    <div className="dist-bar-wrap">
      <div className="dist-bar">
        {buckets.map(
          (b) =>
            b.pct > 0 && (
              <div
                key={b.label}
                className="dist-bar-seg"
                style={{
                  width:      `${b.pct}%`,
                  background: SIGNAL_CONFIG[b.label].color,
                  opacity:    b.label === "HOLD" || b.label === "UNSCORED" ? 0.5 : 0.85,
                }}
                title={`${b.label}: ${b.pct.toFixed(1)}%`}
              />
            )
        )}
      </div>
      <div className="dist-bar-labels">
        {buckets
          .filter((b) => b.pct > 2)
          .map((b) => (
            <div
              key={b.label}
              className="dist-bar-label"
              style={{ width: `${b.pct}%`, color: SIGNAL_CONFIG[b.label].color }}
            >
              {b.pct.toFixed(0)}%
            </div>
          ))}
      </div>
    </div>
  );
}

function BucketCard({
  bucket,
  small = false,
}: {
  bucket: DistributionBucket;
  small?: boolean;
}) {
  const cfg = SIGNAL_CONFIG[bucket.label];
  return (
    <div
      className={`bucket-card ${small ? "small" : ""}`}
      style={{ background: cfg.bg, borderColor: cfg.border }}
    >
      <div className="bucket-top">
        <span className="bucket-signal" style={{ color: cfg.color }}>
          {bucket.label}
        </span>
        <span className="bucket-count" style={{ color: cfg.color }}>
          {bucket.count} holding{bucket.count !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="bucket-value">{formatCurrency(bucket.value)}</div>
      <div className="bucket-pct">{bucket.pct.toFixed(1)}% of portfolio</div>
      {!small && (
        <div className="bucket-tickers">
          {bucket.tickers.slice(0, 6).map((t) => (
            <span key={t} className="ticker-chip">{t}</span>
          ))}
          {bucket.tickers.length > 6 && (
            <span className="ticker-more">+{bucket.tickers.length - 6}</span>
          )}
        </div>
      )}
      <p className="bucket-desc">{cfg.description}</p>
    </div>
  );
}

function CashCard({ bucket }: { bucket: DistributionBucket }) {
  const cfg = SIGNAL_CONFIG["CASH"];
  return (
    <div
      className="cash-card"
      style={{ background: cfg.bg, borderColor: cfg.border }}
    >
      <div className="cash-icon">◈</div>
      <div className="cash-body">
        <span className="cash-label" style={{ color: cfg.color }}>Cash</span>
        <span className="cash-value">{formatCurrency(bucket.value)}</span>
      </div>
      <div className="cash-pct" style={{ color: cfg.color }}>
        {bucket.pct.toFixed(1)}% uninvested
      </div>
    </div>
  );
}

function AlignmentSummary({
  buckets,
  portfolio,
}: {
  buckets: DistributionBucket[];
  portfolio: Portfolio | null;
}) {
  if (!portfolio) return null;

  const buyPct   = buckets.find((b) => b.label === "BUY")?.pct   ?? 0;
  const avoidPct = buckets.find((b) => b.label === "AVOID")?.pct ?? 0;
  const currentHoldings = buckets
    .filter((b) => b.label !== "CASH" && b.label !== "UNSCORED")
    .reduce((s, b) => s + b.count, 0);

  const score = Math.round(buyPct - avoidPct * 0.5);

  let label: string;
  let labelColor: string;
  if (score >= 40) {
    label = "Well-positioned";
    labelColor = "#00d97e";
  } else if (score >= 20) {
    label = "Moderately aligned";
    labelColor = "#f0b429";
  } else if (score >= 0) {
    label = "Needs attention";
    labelColor = "#f0b429";
  } else {
    label = "Poorly aligned";
    labelColor = "#fc5c65";
  }

  const holdingsGap = portfolio.target_holdings - currentHoldings;

  return (
    <div className="alignment-row">
      <div className="align-left">
        <span className="align-title">Portfolio alignment</span>
        <span className="align-label" style={{ color: labelColor }}>{label}</span>
      </div>
      <div className="align-score" style={{ color: labelColor }}>
        {score > 0 ? "+" : ""}{score}
      </div>
      <div className="align-meta">
        <span className="align-chip">
          {PREFERENCE_LABELS.risk_appetite[portfolio.risk_appetite]}
        </span>
        <span className="align-chip">{portfolio.benchmark}</span>
        <span className="align-chip">
          {PREFERENCE_LABELS.investment_horizon[portfolio.investment_horizon]}
        </span>
        <span className={`align-chip ${holdingsGap > 0 ? "warn" : ""}`}>
          {currentHoldings}/{portfolio.target_holdings} holdings
          {holdingsGap > 0 ? ` · ${holdingsGap} slots open` : ""}
        </span>
        {portfolio.cash_pct > 0 && (
          <span className="align-chip">{portfolio.cash_pct}% target cash</span>
        )}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loading-bar" />
      <div className="loading-bar short" />
    </div>
  );
}

function EmptyPortfolioState() {
  return (
    <div className="empty-state">
      <div className="empty-icon">⬡</div>
      <p className="empty-title">No portfolios yet</p>
      <p className="empty-desc">
        Create a portfolio and add holdings or a cash balance to see your signal distribution.
      </p>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------

const styles = `
  .qiq-signal-dist {
    font-family: 'DM Sans', 'Geist', system-ui, sans-serif;
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  /* Portfolio tabs */
  .port-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }
  .port-tabs { display: flex; gap: 6px; flex-wrap: wrap; }
  .port-tab {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    color: #718096;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .port-tab:hover { background: rgba(255,255,255,0.07); color: #a0aec0; }
  .port-tab.active {
    background: rgba(255,255,255,0.09);
    border-color: rgba(255,255,255,0.18);
    color: #e2e8f0;
  }
  .port-tab-badge {
    background: rgba(99,179,237,0.2);
    color: #63b3ed;
    border-radius: 3px;
    font-size: 10px;
    padding: 1px 5px;
    font-weight: 700;
    letter-spacing: 0.05em;
  }

  /* Risk appetite */
  .appetite-control { display: flex; align-items: center; gap: 10px; }
  .appetite-label { font-size: 12px; color: #4a5568; font-weight: 500; white-space: nowrap; }
  .appetite-pills {
    display: flex;
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 6px;
    overflow: hidden;
  }
  .appetite-pill {
    background: transparent;
    border: none;
    color: #4a5568;
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .appetite-pill:hover { color: #a0aec0; background: rgba(255,255,255,0.04); }
  .appetite-pill.active { background: rgba(255,255,255,0.1); color: #e2e8f0; }
  .appetite-pill:disabled { opacity: 0.5; cursor: not-allowed; }

  /* Total */
  .total-row { display: flex; justify-content: space-between; align-items: baseline; padding: 0 2px; }
  .total-label { font-size: 12px; color: #4a5568; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; }
  .total-value { font-size: 22px; font-weight: 600; color: #e2e8f0; letter-spacing: -0.02em; }

  /* Distribution bar */
  .dist-bar-wrap { display: flex; flex-direction: column; gap: 4px; }
  .dist-bar {
    height: 8px;
    border-radius: 4px;
    overflow: hidden;
    display: flex;
    gap: 1px;
    background: rgba(255,255,255,0.04);
  }
  .dist-bar-seg { height: 100%; border-radius: 1px; transition: width 0.5s cubic-bezier(0.4,0,0.2,1); }
  .dist-bar-labels { display: flex; height: 14px; }
  .dist-bar-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-align: center;
    overflow: hidden;
    transition: width 0.5s cubic-bezier(0.4,0,0.2,1);
  }

  /* Bucket cards */
  .buckets-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
  .bucket-card {
    border: 1px solid;
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: transform 0.15s;
  }
  .bucket-card:hover { transform: translateY(-1px); }
  .bucket-card.small { opacity: 0.7; }
  .bucket-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
  .bucket-signal { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; }
  .bucket-count { font-size: 11px; font-weight: 500; opacity: 0.8; }
  .bucket-value { font-size: 18px; font-weight: 600; color: #e2e8f0; letter-spacing: -0.02em; }
  .bucket-pct { font-size: 11px; color: #4a5568; }
  .bucket-tickers { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .ticker-chip {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 600;
    color: #a0aec0;
    letter-spacing: 0.04em;
  }
  .ticker-more { font-size: 10px; color: #4a5568; align-self: center; }
  .bucket-desc { font-size: 11px; color: #4a5568; margin-top: 6px; line-height: 1.4; }

  /* Secondary row */
  .secondary-row { display: flex; gap: 10px; flex-wrap: wrap; }

  /* Cash card */
  .cash-card {
    border: 1px solid;
    border-radius: 10px;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 14px;
    flex: 1;
    min-width: 200px;
  }
  .cash-icon { font-size: 20px; color: #63b3ed; opacity: 0.7; }
  .cash-body { display: flex; flex-direction: column; gap: 1px; flex: 1; }
  .cash-label { font-size: 11px; font-weight: 700; letter-spacing: 0.08em; }
  .cash-value { font-size: 18px; font-weight: 600; color: #e2e8f0; letter-spacing: -0.02em; }
  .cash-pct { font-size: 12px; font-weight: 500; white-space: nowrap; }

  /* Alignment summary */
  .alignment-row {
    background: rgba(255,255,255,0.02);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    padding: 14px 18px;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
  }
  .align-left { display: flex; flex-direction: column; gap: 2px; flex: 1; }
  .align-title { font-size: 11px; color: #4a5568; font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em; }
  .align-label { font-size: 15px; font-weight: 600; }
  .align-score { font-size: 28px; font-weight: 700; letter-spacing: -0.04em; min-width: 60px; text-align: right; }
  .align-meta { width: 100%; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
  .align-chip {
    background: rgba(255,255,255,0.05);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 11px;
    color: #718096;
    font-weight: 500;
  }
  .align-chip.warn {
    background: rgba(240,180,41,0.08);
    border-color: rgba(240,180,41,0.2);
    color: #f0b429;
  }

  /* Loading */
  .loading-state { display: flex; flex-direction: column; gap: 10px; padding: 20px 0; }
  .loading-bar {
    height: 36px;
    background: linear-gradient(90deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.06) 50%, rgba(255,255,255,0.03) 100%);
    background-size: 200% 100%;
    border-radius: 8px;
    animation: shimmer 1.5s infinite;
  }
  .loading-bar.short { height: 60px; width: 60%; }
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

  /* Empty */
  .empty-state { text-align: center; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .empty-icon { font-size: 32px; color: #2d3748; }
  .empty-title { font-size: 15px; font-weight: 600; color: #4a5568; }
  .empty-desc { font-size: 13px; color: #2d3748; max-width: 280px; line-height: 1.5; }
`;
