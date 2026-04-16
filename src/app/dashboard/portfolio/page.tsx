"use client";
// src/app/dashboard/portfolio/page.tsx
// Portfolio page:
// - Each section in expandable panel
// - Creation inherits QA-derived user_profiles defaults
// - Single "Build Portfolio" button (data-driven + LLM narrative)
// - Total separation per portfolio

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PortfolioSignalDistribution } from "@/components/dashboard/PortfolioSignalDistribution";
import { PortfolioWatchlist } from "@/components/dashboard/PortfolioWatchlist";
import { PortfolioBuildHistory } from "@/components/dashboard/PortfolioBuildHistory";
import {
  computeCapitalMetrics,
  type PortfolioCapitalMetrics,
} from "@/types/portfolio-preferences";
import type { RiskAppetite, InvestmentHorizon } from "@/types/portfolio-preferences";

// ─── Types ────────────────────────────────────────────────────────────────────

type Holding = {
  id:         string;
  ticker:     string;
  name:       string | null;
  asset_type: string | null;
  quantity:   number | null;
  avg_cost:   number | null;
  notes:      string | null;
  signal: {
    signal:     string;
    price_usd:  number | null;
    change_pct: number | null;
  } | null;
};

type Portfolio = {
  id:                 string;
  name:               string;
  risk_appetite:      RiskAppetite;
  benchmark:          string;
  target_holdings:    number;
  preferred_assets:   string[];
  cash_pct:           number;
  investment_horizon: InvestmentHorizon;
  total_capital:      number;
};

type Memo   = { id: string; content: string; created_at: string };
type AssetMatch = { ticker: string; name: string; asset_type: string; sector: string | null };
type ProfileDefaults = Omit<Portfolio, "id" | "name" | "user_id" | "created_at">;

// ─── Constants ────────────────────────────────────────────────────────────────

const SIG_COLOR: Record<string, string> = {
  buy:   "var(--signal-bull)",
  watch: "var(--signal-neut)",
  hold:  "rgba(232,226,217,0.3)",
  avoid: "var(--signal-bear)",
};

const ASSET_TYPE_OPTIONS = ["equities", "etf", "crypto", "commodities", "bonds", "fx"];

const PREF_LABELS = {
  risk_appetite:      { aggressive: "Aggressive", moderate: "Moderate", conservative: "Conservative" },
  investment_horizon: { short: "Short <1yr", medium: "Medium 1-3yr", long: "Long 3+yr" },
};

// ─── Styles ───────────────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.68rem", color: "rgba(232,226,217,0.45)",
  marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.08em",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.7rem", background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--dash-border)", borderRadius: 6, color: "var(--cream)",
  fontSize: "0.85rem", outline: "none", boxSizing: "border-box",
};

function pillStyle(active: boolean, saving = false): React.CSSProperties {
  return {
    padding: "0.3rem 0.75rem",
    background: active ? "rgba(200,169,110,0.18)" : "rgba(255,255,255,0.04)",
    border: `1px solid ${active ? "rgba(200,169,110,0.45)" : "var(--dash-border)"}`,
    color: active ? "var(--gold)" : "rgba(232,226,217,0.40)",
    borderRadius: 5, fontSize: "0.75rem", fontWeight: active ? 600 : 400,
    cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.5 : 1,
    transition: "all 0.15s", whiteSpace: "nowrap" as const,
  };
}

function formatCurrency(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function formatPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

// ─── Expandable panel ─────────────────────────────────────────────────────────

function Panel({
  title, badge, defaultOpen = true, children, action,
}: {
  title:        string;
  badge?:       React.ReactNode;
  defaultOpen?: boolean;
  children:     React.ReactNode;
  action?:      React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: "var(--navy2)", border: "1px solid var(--dash-border)",
      borderRadius: 10, marginBottom: "1rem", overflow: "hidden",
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.75rem 1.2rem", background: "none", border: "none",
          cursor: "pointer", borderBottom: open ? "1px solid var(--dash-border)" : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ fontSize: "0.6rem", color: open ? "var(--green)" : "rgba(232,226,217,0.35)", transition: "color 0.15s" }}>
            {open ? "▼" : "▶"}
          </span>
          <span style={{ fontSize: "0.72rem", fontFamily: "var(--font-mono)", color: "rgba(232,226,217,0.60)", textTransform: "uppercase", letterSpacing: "0.12em" }}>
            {title}
          </span>
          {badge}
        </div>
        {action && <div onClick={e => e.stopPropagation()}>{action}</div>}
      </button>
      {open && (
        <div style={{ padding: "1rem 1.2rem" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Capital summary ──────────────────────────────────────────────────────────

function CapitalSummaryBar({ metrics, cashFloorPct = 0 }: {
  metrics: PortfolioCapitalMetrics; cashFloorPct?: number;
}) {
  const investedPct  = metrics.total_capital > 0 ? (metrics.invested / metrics.total_capital) * 100 : 0;
  const gainColor    = metrics.capital_gain >= 0 ? "var(--signal-bull)" : "var(--signal-bear)";
  const cashFloorAmt = metrics.total_capital * (cashFloorPct / 100);
  const belowFloor   = cashFloorPct > 0 && metrics.cash_available < cashFloorAmt;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1rem" }}>
        <Metric label="Total Capital"   value={formatCurrency(metrics.total_capital)} sub="Allocated to this portfolio" />
        <Metric label="Invested"        value={formatCurrency(metrics.invested)} sub={`${investedPct.toFixed(0)}% deployed`} />
        <Metric label="Cash Available"  value={formatCurrency(metrics.cash_available)} valueColor="#63b3ed" sub="Ready to invest" />
        <Metric label="Current Value"   value={formatCurrency(metrics.current_value)} sub={
          <span>
            <span style={{ color: gainColor, fontWeight: 600 }}>{metrics.capital_gain >= 0 ? "+" : ""}{formatCurrency(Math.abs(metrics.capital_gain))}</span>
            {" "}<span style={{ color: gainColor, fontWeight: 700 }}>{formatPct(metrics.return_pct)}</span> return
          </span>
        } />
      </div>

      {belowFloor && (
        <div style={{ background: "rgba(252,92,101,0.08)", border: "1px solid rgba(252,92,101,0.25)", borderRadius: 6, padding: "0.4rem 0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <span style={{ color: "#fc5c65", fontSize: "0.75rem", fontWeight: 600 }}>⚠ Below min cash reserve</span>
          <span style={{ color: "rgba(232,226,217,0.45)", fontSize: "0.72rem" }}>
            Floor is {cashFloorPct}% ({formatCurrency(cashFloorAmt)}). Available: {formatCurrency(metrics.cash_available)}.
          </span>
        </div>
      )}

      {metrics.total_capital > 0 && (
        <div>
          <div style={{ height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.min(100, investedPct)}%`, background: "linear-gradient(90deg, rgba(200,169,110,0.6), rgba(200,169,110,0.9))", borderRadius: 3, transition: "width 0.5s" }} />
          </div>

        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, valueColor }: { label: string; value: string; sub?: React.ReactNode; valueColor?: string }) {
  return (
    <div>
      <div style={{ fontSize: "0.62rem", color: "rgba(232,226,217,0.40)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.25rem" }}>{label}</div>
      <div style={{ fontSize: "1.25rem", fontWeight: 700, color: valueColor ?? "var(--cream)", letterSpacing: "-0.02em", marginBottom: "0.2rem" }}>{value}</div>
      {sub && <div style={{ fontSize: "0.68rem", color: "rgba(232,226,217,0.35)", lineHeight: 1.4 }}>{sub}</div>}
    </div>
  );
}

// ─── Preference panel ─────────────────────────────────────────────────────────

function PreferencePanel({ portfolio, onUpdate }: { portfolio: Portfolio; onUpdate: (key: keyof Portfolio, value: any) => Promise<void> }) {
  const [saving, setSaving] = useState<string | null>(null);

  async function save(key: keyof Portfolio, value: any) {
    setSaving(key); await onUpdate(key, value); setSaving(null);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap", alignItems: "flex-end" }}>

        {/* Risk */}
        <div>
          <div style={labelStyle}>Risk</div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {(["aggressive", "moderate", "conservative"] as RiskAppetite[]).map(a => (
              <button key={a} disabled={saving === "risk_appetite"} onClick={() => save("risk_appetite", a)} style={pillStyle(portfolio.risk_appetite === a, saving === "risk_appetite")}>
                {PREF_LABELS.risk_appetite[a]}
              </button>
            ))}
          </div>
        </div>
        {/* Horizon */}
        <div>
          <div style={labelStyle}>Horizon</div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {(["short", "medium", "long"] as InvestmentHorizon[]).map(h => (
              <button key={h} disabled={saving === "investment_horizon"} onClick={() => save("investment_horizon", h)} style={pillStyle(portfolio.investment_horizon === h, saving === "investment_horizon")}>
                {h.charAt(0).toUpperCase() + h.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {/* Benchmark */}
        <div>
          <div style={labelStyle}>Benchmark</div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {["SPY", "QQQ", "AXJO"].map(b => (
              <button key={b} disabled={saving === "benchmark"} onClick={() => save("benchmark", b)} style={pillStyle(portfolio.benchmark === b, saving === "benchmark")}>{b}</button>
            ))}
          </div>
        </div>
        {/* Target holdings */}
        <div>
          <div style={labelStyle}>Target holdings</div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {[10, 15, 20, 30].map(n => (
              <button key={n} disabled={saving === "target_holdings"} onClick={() => save("target_holdings", n)} style={pillStyle(portfolio.target_holdings === n, saving === "target_holdings")}>{n}</button>
            ))}
          </div>
        </div>
        {/* Cash reserve */}
        <div>
          <div style={labelStyle}>Min cash reserve</div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            {[0, 5, 10, 15, 20].map(n => (
              <button key={n} disabled={saving === "cash_pct"} onClick={() => save("cash_pct", n)} style={pillStyle(portfolio.cash_pct === n, saving === "cash_pct")}>{n}%</button>
            ))}
          </div>
        </div>
      </div>
      {/* Asset types */}
      <div>
        <div style={labelStyle}>Preferred asset types</div>
        <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
          {ASSET_TYPE_OPTIONS.map(a => {
            const active = portfolio.preferred_assets.includes(a);
            const next   = active ? portfolio.preferred_assets.filter(x => x !== a) : [...portfolio.preferred_assets, a];
            return (
              <button key={a} disabled={saving === "preferred_assets"} onClick={() => save("preferred_assets", next)} style={pillStyle(active, saving === "preferred_assets")}>
                {a.charAt(0).toUpperCase() + a.slice(1)}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── New portfolio modal ──────────────────────────────────────────────────────

function NewPortfolioModal({ defaults, onClose, onCreate, isFirstRun = false }: {
  defaults: ProfileDefaults; onClose: () => void;
  onCreate: (name: string, prefs: ProfileDefaults) => Promise<void>; isFirstRun?: boolean;
}) {
  const [name,       setName]       = useState("");
  const [prefs,      setPrefs]      = useState<ProfileDefaults>(defaults);
  const [capitalStr, setCapitalStr] = useState("");
  const [saving,     setSaving]     = useState(false);
  const [err,        setErr]        = useState("");

  function setPref<K extends keyof ProfileDefaults>(key: K, value: ProfileDefaults[K]) {
    setPrefs(p => ({ ...p, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true);
    const capital = parseFloat(capitalStr.replace(/[^0-9.]/g, "")) || 0;
    try { await onCreate(name.trim(), { ...prefs, total_capital: capital }); onClose(); }
    catch (e: any) { setErr(e.message ?? "Failed to create"); setSaving(false); }
  }

  const pill = (active: boolean): React.CSSProperties => ({ ...pillStyle(active), fontSize: "0.75rem" });

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 10, padding: "1.6rem", width: 520, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.2rem" }}>
          <div>
            <h3 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.25rem", margin: "0 0 0.3rem" }}>
              {isFirstRun ? "Create your first portfolio" : "New portfolio"}
            </h3>
            <p style={{ fontSize: "0.78rem", color: "rgba(232,226,217,0.40)", margin: 0 }}>
              {isFirstRun
                ? "Pre-filled from your investment personality — adjust per-portfolio below."
                : "Inherits your investment personality defaults — adjust as needed."}
            </p>
          </div>
          {!isFirstRun && (
            <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(232,226,217,0.35)", cursor: "pointer", fontSize: "1.2rem", padding: "0 4px", lineHeight: 1 }}>×</button>
          )}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          <div>
            <label style={labelStyle}>Portfolio name</label>
            <input value={name} onChange={e => { setName(e.target.value); setErr(""); }} placeholder="e.g. Core Growth, Dividend, Speculative" style={inputStyle} />
            {err && <div style={{ fontSize: "0.72rem", color: "var(--signal-bear)", marginTop: "0.3rem" }}>{err}</div>}
          </div>

          <div>
            <label style={labelStyle}>Total capital</label>
            <div style={{ position: "relative", width: 160 }}>
              <span style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", color: "rgba(232,226,217,0.45)", fontSize: "0.85rem" }}>$</span>
              <input value={capitalStr} onChange={e => setCapitalStr(e.target.value)} placeholder="50,000" style={{ ...inputStyle, paddingLeft: "1.4rem" }} />
            </div>
          </div>

          <div>
            <label style={labelStyle}>Risk appetite</label>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {(["aggressive", "moderate", "conservative"] as RiskAppetite[]).map(a => (
                <button key={a} type="button" onClick={() => setPref("risk_appetite", a)} style={pill(prefs.risk_appetite === a)}>
                  {PREF_LABELS.risk_appetite[a]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Investment horizon</label>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {(["short", "medium", "long"] as InvestmentHorizon[]).map(h => (
                <button key={h} type="button" onClick={() => setPref("investment_horizon", h)} style={pill(prefs.investment_horizon === h)}>
                  {PREF_LABELS.investment_horizon[h]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Benchmark</label>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {["SPY", "QQQ", "AXJO"].map(b => (
                <button key={b} type="button" onClick={() => setPref("benchmark", b)} style={pill(prefs.benchmark === b)}>{b}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Target holdings</label>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {[10, 15, 20, 30].map(n => (
                <button key={n} type="button" onClick={() => setPref("target_holdings", n)} style={pill(prefs.target_holdings === n)}>{n}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Min cash reserve</label>
            <div style={{ display: "flex", gap: "0.4rem" }}>
              {[0, 5, 10, 15, 20].map(n => (
                <button key={n} type="button" onClick={() => setPref("cash_pct", n)} style={pill(prefs.cash_pct === n)}>{n}%</button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Preferred asset types</label>
            <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
              {ASSET_TYPE_OPTIONS.map(a => {
                const active = prefs.preferred_assets.includes(a);
                const next   = active ? prefs.preferred_assets.filter(x => x !== a) : [...prefs.preferred_assets, a];
                return <button key={a} type="button" onClick={() => setPref("preferred_assets", next)} style={pill(active)}>{a.charAt(0).toUpperCase() + a.slice(1)}</button>;
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: "0.6rem", justifyContent: "flex-end", marginTop: "0.4rem" }}>
            {!isFirstRun && (
              <button type="button" onClick={onClose} style={{ padding: "0.5rem 1rem", background: "transparent", border: "1px solid var(--dash-border)", color: "rgba(232,226,217,0.45)", borderRadius: 6, cursor: "pointer", fontSize: "0.82rem" }}>Cancel</button>
            )}
            <button type="submit" disabled={saving}
              style={{ padding: "0.5rem 1.1rem", background: "var(--gold)", color: "var(--navy)", fontWeight: 700, borderRadius: 6, border: "none", fontSize: "0.82rem", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Creating…" : "Create portfolio"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Ticker autocomplete ──────────────────────────────────────────────────────

function TickerAutocomplete({ value, onChange, onSelect, error }: {
  value: string; onChange: (v: string) => void;
  onSelect: (asset: AssetMatch) => void; error?: string;
}) {
  const [results,   setResults]   = useState<AssetMatch[]>([]);
  const [open,      setOpen]      = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!value.trim()) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res  = await fetch(`/api/assets/search?q=${encodeURIComponent(value)}&limit=8`);
        const data = await res.json();
        setResults(data.assets ?? []); setOpen((data.assets ?? []).length > 0); setActiveIdx(-1);
      } catch { setResults([]); setOpen(false); }
      finally { setSearching(false); }
    }, 200);
  }, [value]);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
    if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); onSelect(results[activeIdx]); setOpen(false); setResults([]); }
    if (e.key === "Escape") setOpen(false);
  }

  const typeColor: Record<string, string> = { stock: "rgba(78,202,153,0.7)", etf: "rgba(200,169,110,0.7)", crypto: "rgba(122,180,232,0.7)", commodity: "rgba(232,180,122,0.7)" };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <label style={labelStyle}>Ticker</label>
      <input value={value} onChange={e => onChange(e.target.value.toUpperCase())} onKeyDown={handleKey}
        onFocus={() => results.length > 0 && setOpen(true)} placeholder="Search AAPL, XLE…" autoComplete="off"
        style={{ ...inputStyle, background: error ? "rgba(232,112,112,0.06)" : "rgba(255,255,255,0.05)", border: `1px solid ${error ? "rgba(232,112,112,0.4)" : "var(--dash-border)"}` }} />
      {searching && <div style={{ position: "absolute", right: "0.6rem", top: "2.1rem", fontSize: "0.65rem", color: "rgba(232,226,217,0.35)" }}>…</div>}
      {open && results.length > 0 && (
        <div style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50, background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 6, marginTop: 2, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}>
          {results.map((asset, i) => (
            <div key={asset.ticker} onMouseDown={() => { onSelect(asset); setOpen(false); setResults([]); }} onMouseEnter={() => setActiveIdx(i)}
              style={{ padding: "0.55rem 0.8rem", cursor: "pointer", background: i === activeIdx ? "rgba(255,255,255,0.06)" : "transparent", borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", display: "flex", alignItems: "center", gap: "0.6rem" }}>
              <span style={{ fontWeight: 700, color: "var(--gold)", fontFamily: "monospace", fontSize: "0.85rem", minWidth: "3.5rem" }}>{asset.ticker}</span>
              <span style={{ fontSize: "0.75rem", color: "rgba(232,226,217,0.55)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.name}</span>
              <span style={{ fontSize: "0.6rem", color: typeColor[asset.asset_type] ?? "rgba(232,226,217,0.35)", textTransform: "uppercase", flexShrink: 0 }}>{asset.asset_type}</span>
            </div>
          ))}
        </div>
      )}
      {error && <div style={{ fontSize: "0.72rem", color: "var(--signal-bear)", marginTop: "0.3rem" }}>{error}</div>}
    </div>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PortfolioPage() {
  const router   = useRouter();
  const supabase = createClient();

  const [portfolios,  setPortfolios]  = useState<Portfolio[]>([]);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [holdings,    setHoldings]    = useState<Holding[]>([]);
  const [memos,       setMemos]       = useState<Memo[]>([]);
  const [userId,      setUserId]      = useState<string | null>(null);
  const [defaults,    setDefaults]    = useState<ProfileDefaults | null>(null);
  const [initLoading, setInitLoading] = useState(true);
  const [showNew,     setShowNew]     = useState(false);
  const [isFirstRun,  setIsFirstRun]  = useState(false);
  const [activeTab,   setActiveTab]   = useState<"holdings" | "watchlist" | "distribution" | "history">("holdings");

  const [ticker,      setTicker]      = useState("");
  const [quantity,    setQuantity]    = useState("");
  const [avgCost,     setAvgCost]     = useState("");
  const [editMap,     setEditMap]     = useState<Record<string, { quantity: string; avg_cost: string; dirty: boolean }>>({});
  const [committing,  setCommitting]  = useState(false);
  const [adding,      setAdding]      = useState(false);
  const [generating,  setGenerating]  = useState(false);
  const [formError,   setFormError]   = useState("");
  const [tickerError, setTickerError] = useState("");

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setInitLoading(false); return; }
      setUserId(user.id);

      // Load portfolios and user_profiles in parallel
      const [portRes, profileRes] = await Promise.all([
        fetch("/api/portfolio").then(r => r.json()),
        (supabase as any).from("user_profiles")
          .select("risk_score, horizon, min_conviction, sector_exclude, asset_types, universe")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

      // Derive portfolio defaults from QA profile
      const qp = profileRes?.data;
      const riskToAppetite = (score: number | null): RiskAppetite =>
        !score ? "moderate" : score <= 3 ? "conservative" : score >= 7 ? "aggressive" : "moderate";
      const horizonMap: Record<string, InvestmentHorizon> = { short: "short", medium: "medium", long: "long" };

      setDefaults({
        risk_appetite:      riskToAppetite(qp?.risk_score ?? null),
        benchmark:          "SPY",
        target_holdings:    qp?.min_conviction ? (qp.min_conviction >= 70 ? 10 : 20) : 20,
        preferred_assets:   qp?.asset_types ?? ["equities", "etf"],
        cash_pct:           0,
        investment_horizon: horizonMap[qp?.horizon ?? ""] ?? "medium",
        total_capital:      0,
      });

      const all = portRes.portfolios ?? (portRes.portfolio ? [portRes.portfolio] : []);
      setPortfolios(all);
      if (all.length) { setSelectedId(all[0].id); }
      else            { setShowNew(true); setIsFirstRun(true); }
      setInitLoading(false);
    }
    init();
  }, []);

  const loadPortfolioData = useCallback(async (portfolioId: string) => {
    const [pRes, mRes] = await Promise.all([
      fetch(`/api/portfolio?portfolio_id=${portfolioId}`).then(r => r.json()),
      fetch(`/api/advisory?portfolio_id=${portfolioId}`).then(r => r.json()),
    ]);
    const loaded: Holding[] = pRes.holdings ?? [];
    setHoldings(loaded);
    setMemos(mRes.memos ?? []);
    setEditMap(Object.fromEntries(loaded.map(h => [h.id, {
      quantity: h.quantity != null ? String(h.quantity) : "",
      avg_cost: h.avg_cost != null ? String(h.avg_cost) : "",
      dirty:    false,
    }])));
  }, []);

  useEffect(() => { if (selectedId) loadPortfolioData(selectedId); }, [selectedId, loadPortfolioData]);

  async function handleCreatePortfolio(name: string, prefs: ProfileDefaults) {
    const res  = await fetch("/api/portfolio", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body:   JSON.stringify({ action: "create_portfolio", name, ...prefs }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to create");
    const newPort = data.portfolio as Portfolio;
    setPortfolios(prev => [...prev, newPort]);
    setSelectedId(newPort.id);
    setIsFirstRun(false); setShowNew(false);
  }

  async function updatePreference(key: keyof Portfolio, value: any) {
    if (!selectedId) return;
    await fetch("/api/portfolio", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body:   JSON.stringify({ portfolio_id: selectedId, [key]: value }),
    });
    setPortfolios(prev => prev.map(p => p.id === selectedId ? { ...p, [key]: value } : p));
  }

  async function addHolding(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim();
    if (!t) { setTickerError("Please select a ticker"); return; }
    if (!selectedId) return;
    setAdding(true); setFormError(""); setTickerError("");
    const res = await fetch("/api/portfolio", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body:   JSON.stringify({ action: "add_holding", portfolio_id: selectedId, ticker: t.toUpperCase(), quantity: quantity || undefined, avg_cost: avgCost || undefined }),
    });
    if (res.ok) {
      setTicker(""); setQuantity(""); setAvgCost("");
      await loadPortfolioData(selectedId);
    } else {
      const d   = await res.json();
      const msg = d.error ?? "Failed to add";
      if (msg.toLowerCase().includes("ticker")) setTickerError(msg); else setFormError(msg);
    }
    setAdding(false);
  }

  async function removeHolding(id: string) {
    await fetch(`/api/portfolio?holding_id=${id}`, { method: "DELETE" });
    setHoldings(h => h.filter(x => x.id !== id));
  }

  async function generateMemo() {
    if (!selectedId) return;
    setGenerating(true); setFormError("");
    const res = await fetch("/api/advisory", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body:   JSON.stringify({ portfolio_id: selectedId }),
    });
    const d = await res.json();
    if (res.ok) setMemos(m => [d.memo, ...m.slice(0, 4)]);
    else        setFormError(d.error ?? "Failed to generate");
    setGenerating(false);
  }

  function setEdit(id: string, field: "quantity" | "avg_cost", value: string) {
    setEditMap(prev => ({ ...prev, [id]: { ...prev[id], [field]: value, dirty: true } }));
  }

  async function commitEdits() {
    const dirty = Object.entries(editMap).filter(([, v]) => v.dirty);
    if (!dirty.length) return;
    setCommitting(true);
    await Promise.all(dirty.map(([id, vals]) =>
      fetch(`/api/portfolio?holding_id=${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body:   JSON.stringify({ quantity: vals.quantity !== "" ? Number(vals.quantity) : null, avg_cost: vals.avg_cost !== "" ? Number(vals.avg_cost) : null }),
      })
    ));
    if (selectedId) await loadPortfolioData(selectedId);
    setCommitting(false);
  }

  const selectedPortfolio = portfolios.find(p => p.id === selectedId) ?? null;
  const capitalMetrics: PortfolioCapitalMetrics | null = selectedPortfolio
    ? computeCapitalMetrics(selectedPortfolio.total_capital, holdings.map(h => {
        const edit = editMap[h.id];
        const qty  = edit?.quantity !== "" ? Number(edit?.quantity ?? h.quantity ?? 0) : (h.quantity ?? 0);
        const cost = edit?.avg_cost !== "" ? Number(edit?.avg_cost ?? h.avg_cost ?? 0) : (h.avg_cost ?? 0);
        return { ticker: h.ticker, quantity: qty, avg_cost: cost, price_usd: h.signal?.price_usd ?? null };
      }))
    : null;
  const hasDirtyEdits = Object.values(editMap).some(v => v.dirty);

  if (initLoading) return <div style={{ color: "rgba(232,226,217,0.25)", fontSize: "0.85rem", padding: "3rem 0" }}>Loading…</div>;

  return (
    <>
      {showNew && defaults && (
        <NewPortfolioModal defaults={defaults} isFirstRun={isFirstRun}
          onClose={() => { if (!isFirstRun) setShowNew(false); }}
          onCreate={handleCreatePortfolio}
        />
      )}

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.2rem" }}>
        <h1 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.8rem", margin: 0 }}>Portfolio</h1>
        <button onClick={() => setShowNew(true)}
          style={{ padding: "0.45rem 0.9rem", background: "rgba(200,169,110,0.12)", border: "1px solid rgba(200,169,110,0.3)", color: "var(--gold)", borderRadius: 6, fontSize: "0.8rem", cursor: "pointer", fontWeight: 500 }}>
          + New portfolio
        </button>
      </div>

      {/* ── Portfolio selector tabs ── */}
      <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        {portfolios.map(p => (
          <button key={p.id} onClick={() => setSelectedId(p.id)}
            style={{ padding: "0.4rem 1rem", background: p.id === selectedId ? "rgba(200,169,110,0.15)" : "rgba(255,255,255,0.04)", border: `1px solid ${p.id === selectedId ? "rgba(200,169,110,0.4)" : "var(--dash-border)"}`, color: p.id === selectedId ? "var(--gold)" : "rgba(232,226,217,0.45)", borderRadius: 6, fontSize: "0.82rem", fontWeight: p.id === selectedId ? 600 : 400, cursor: "pointer", transition: "all 0.15s" }}>
            {p.name}
          </button>
        ))}
      </div>

      {selectedPortfolio && (
        <>
          {/* ── Panel 1: Capital overview ── */}
          {capitalMetrics && selectedPortfolio.total_capital > 0 && (
            <Panel title="Capital Overview" defaultOpen={true}
              badge={
                <span style={{ fontSize: "0.68rem", color: capitalMetrics.return_pct >= 0 ? "var(--signal-bull)" : "var(--signal-bear)", fontFamily: "var(--font-mono)", marginLeft: 4 }}>
                  {formatPct(capitalMetrics.return_pct)}
                </span>
              }
            >
              <CapitalSummaryBar metrics={capitalMetrics} cashFloorPct={selectedPortfolio.cash_pct} />
            </Panel>
          )}

          {/* ── Panel 2: Portfolio settings ── */}
          <Panel title="Portfolio Settings" defaultOpen={false}>
            <PreferencePanel portfolio={selectedPortfolio} onUpdate={updatePreference} />
          </Panel>

          {/* ── Panel 3: Holdings ── */}
          <Panel
            title="Holdings"
            defaultOpen={true}
            badge={
              holdings.length > 0
                ? <span style={{ fontSize: "0.62rem", background: "rgba(200,169,110,0.15)", color: "var(--gold)", border: "1px solid rgba(200,169,110,0.25)", borderRadius: 10, padding: "1px 7px", marginLeft: 6 }}>{holdings.length}</span>
                : undefined
            }
            action={
              <button
                onClick={() => selectedPortfolio && router.push(`/dashboard/portfolio/builder?portfolio_id=${selectedPortfolio.id}`)}
                disabled={!selectedPortfolio?.total_capital}
                style={{ padding: "0.35rem 0.9rem", background: "rgba(200,169,110,0.12)", border: "1px solid rgba(200,169,110,0.3)", color: "var(--gold)", borderRadius: 5, fontSize: "0.72rem", fontWeight: 600, cursor: !selectedPortfolio?.total_capital ? "not-allowed" : "pointer", opacity: !selectedPortfolio?.total_capital ? 0.4 : 1, display: "flex", alignItems: "center", gap: "0.4rem" }}>
                ✦ Build portfolio
              </button>
            }
          >
            {/* Add holding form */}
            <form onSubmit={addHolding} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--dash-border)", borderRadius: 7, padding: "0.85rem 1rem", marginBottom: "1rem" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 0.9fr auto", gap: "0.6rem", alignItems: "flex-start" }}>
                <TickerAutocomplete value={ticker} onChange={v => { setTicker(v); setTickerError(""); }} onSelect={a => { setTicker(a.ticker); setTickerError(""); }} error={tickerError} />
                <Field label="Quantity" value={quantity} onChange={setQuantity} placeholder="100" />
                <Field label="Avg cost ($)" value={avgCost} onChange={setAvgCost} placeholder="182.50" />
                <div style={{ paddingTop: "1.35rem" }}>
                  <button type="submit" disabled={adding}
                    style={{ padding: "0.55rem 1rem", background: "var(--gold)", color: "var(--navy)", fontWeight: 700, borderRadius: 6, border: "none", fontSize: "0.82rem", cursor: "pointer", opacity: adding ? 0.6 : 1 }}>
                    {adding ? "…" : "Add"}
                  </button>
                </div>
              </div>
              {formError && <div style={{ color: "var(--signal-bear)", fontSize: "0.78rem", marginTop: "0.5rem" }}>{formError}</div>}
            </form>

            {/* Unsaved changes bar */}
            {hasDirtyEdits && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(200,169,110,0.06)", border: "1px solid rgba(200,169,110,0.25)", borderRadius: 7, padding: "0.6rem 1rem", marginBottom: "0.75rem" }}>
                <span style={{ fontSize: "0.78rem", color: "rgba(200,169,110,0.75)" }}>Unsaved changes — capital allocation previewed live</span>
                <button onClick={commitEdits} disabled={committing}
                  style={{ padding: "0.4rem 1rem", background: "var(--gold)", color: "var(--navy)", fontWeight: 700, borderRadius: 6, border: "none", fontSize: "0.8rem", cursor: committing ? "not-allowed" : "pointer", opacity: committing ? 0.6 : 1 }}>
                  {committing ? "Saving…" : "Commit changes"}
                </button>
              </div>
            )}

            {/* Holdings table */}
            {holdings.length > 0 ? (
              <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid var(--dash-border)", borderRadius: 7, overflow: "hidden" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1.2fr 2rem", gap: "0.5rem", padding: "0.5rem 0.85rem", borderBottom: "1px solid var(--dash-border)", fontSize: "0.6rem", color: "rgba(232,226,217,0.40)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                  <span>Ticker</span><span style={{ textAlign: "right" }}>Qty</span><span style={{ textAlign: "right" }}>Avg cost</span>
                  <span style={{ textAlign: "right" }}>Live price</span><span style={{ textAlign: "right" }}>Mkt value</span>
                  <span style={{ textAlign: "right" }}>Gain/Loss</span><span style={{ textAlign: "right" }}>Day chg</span><span />
                </div>
                {holdings.map((h, idx) => {
                  const edit      = editMap[h.id] ?? { quantity: "", avg_cost: "", dirty: false };
                  const sig       = h.signal;
                  const sc        = sig?.signal ?? "hold";
                  const scCol     = SIG_COLOR[sc] ?? "rgba(232,226,217,0.3)";
                  const livePrice = sig?.price_usd ?? null;
                  const chg       = sig?.change_pct ?? null;
                  const qty       = edit.quantity !== "" ? Number(edit.quantity) : (h.quantity ?? null);
                  const cost      = edit.avg_cost !== "" ? Number(edit.avg_cost) : (h.avg_cost ?? null);
                  const mktVal    = livePrice != null && qty != null ? livePrice * qty : null;
                  const costBase  = cost != null && qty != null ? cost * qty : null;
                  const gain      = mktVal != null && costBase != null ? mktVal - costBase : null;
                  const isDraft   = h.quantity == null && h.avg_cost == null;
                  const isDirty   = edit.dirty;

                  return (
                    <div key={h.id} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 1.2fr 2rem", gap: "0.5rem", padding: "0.55rem 0.85rem", alignItems: "center", borderBottom: idx < holdings.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", background: isDirty ? "rgba(200,169,110,0.03)" : isDraft ? "rgba(99,179,237,0.03)" : "transparent" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                          <span style={{ fontWeight: 700, color: "var(--cream)", fontSize: "0.85rem" }}>{h.ticker}</span>
                          <span style={{ fontSize: "0.58rem", color: scCol, background: `${scCol}15`, padding: "0.05rem 0.3rem", borderRadius: 8, textTransform: "uppercase" }}>{sc}</span>
                          {isDraft && <span style={{ fontSize: "0.58rem", color: "#63b3ed", background: "rgba(99,179,237,0.12)", padding: "0.05rem 0.3rem", borderRadius: 8 }}>draft</span>}
                          {isDirty && <span style={{ fontSize: "0.58rem", color: "rgba(200,169,110,0.7)" }}>●</span>}
                        </div>
                        {h.name && <span style={{ fontSize: "0.62rem", color: "rgba(232,226,217,0.35)" }}>{h.name}</span>}
                      </div>

                      {(["quantity", "avg_cost"] as const).map(field => (
                        <div key={field} style={{ textAlign: "right" }}>
                          <input type="number" value={edit[field]} onChange={e => setEdit(h.id, field, e.target.value)} placeholder="—"
                            style={{ width: "100%", textAlign: "right", background: "rgba(255,255,255,0.05)", border: `1px solid ${isDirty ? "rgba(200,169,110,0.35)" : "rgba(255,255,255,0.07)"}`, borderRadius: 4, color: "var(--cream)", fontSize: "0.8rem", outline: "none", padding: "0.25rem 0.4rem" }} />
                        </div>
                      ))}

                      <div style={{ textAlign: "right", fontSize: "0.8rem", color: "rgba(232,226,217,0.60)" }}>{livePrice != null ? `$${livePrice.toFixed(2)}` : "—"}</div>
                      <div style={{ textAlign: "right", fontSize: "0.8rem", color: "var(--cream)" }}>{mktVal != null ? formatCurrency(mktVal) : "—"}</div>
                      <div style={{ textAlign: "right", fontSize: "0.78rem", fontWeight: 600, color: gain == null ? "rgba(232,226,217,0.25)" : gain >= 0 ? "var(--signal-bull)" : "var(--signal-bear)" }}>
                        {gain != null ? `${gain >= 0 ? "+" : ""}${formatCurrency(gain)}` : "—"}
                      </div>
                      <div style={{ textAlign: "right", fontSize: "0.78rem", fontWeight: 600, color: chg == null ? "rgba(232,226,217,0.25)" : chg >= 0 ? "var(--signal-bull)" : "var(--signal-bear)" }}>
                        {chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : "—"}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <button onClick={() => removeHolding(h.id)} style={{ background: "none", border: "none", color: "rgba(232,226,217,0.25)", cursor: "pointer", fontSize: "1rem", padding: 0, lineHeight: 1 }} title="Remove">×</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ color: "rgba(232,226,217,0.35)", fontSize: "0.82rem", padding: "0.5rem 0" }}>
                No holdings yet. Add a ticker above or use <strong style={{ color: "var(--gold)" }}>✦ Build portfolio</strong> to generate a data-driven allocation.
              </div>
            )}
          </Panel>

          {/* ── Panel 4: AI Advisory ── */}
          <Panel title="AI Advisory" defaultOpen={false}
            action={
              <button onClick={generateMemo} disabled={generating || !holdings.length}
                style={{ padding: "0.3rem 0.8rem", background: "rgba(200,169,110,0.1)", border: "1px solid rgba(200,169,110,0.25)", color: "var(--gold)", borderRadius: 4, fontSize: "0.7rem", cursor: generating || !holdings.length ? "not-allowed" : "pointer", opacity: generating || !holdings.length ? 0.5 : 1 }}>
                {generating ? "Generating…" : "Generate memo"}
              </button>
            }
          >
            {!holdings.length ? (
              <div style={{ color: "rgba(232,226,217,0.35)", fontSize: "0.82rem" }}>Add holdings first to generate an advisory memo.</div>
            ) : memos.length === 0 ? (
              <div style={{ color: "rgba(232,226,217,0.35)", fontSize: "0.82rem" }}>Click "Generate memo" for an AI-powered advisory based on your holdings and recent market events.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                {memos.map((m, i) => (
                  <div key={m.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid var(--dash-border)", borderRadius: 7, padding: "1rem 1.2rem" }}>
                    <div style={{ fontSize: "0.62rem", color: "rgba(200,169,110,0.45)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.6rem" }}>
                      {i === 0 ? "Latest" : new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </div>
                    <p style={{ fontSize: "0.83rem", color: "rgba(232,226,217,0.65)", lineHeight: 1.7, margin: 0 }}>{m.content}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          {/* ── Panel 5: Analysis tabs ── */}
          <Panel title="Analysis" defaultOpen={false}>
            <div style={{ display: "flex", marginBottom: "1rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--dash-border)", borderRadius: 6, overflow: "hidden", width: "fit-content" }}>
              {([["watchlist", "Watchlist"], ["distribution", "Signal Distribution"], ["history", "Build History"]] as const).map(([tab, label]) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  style={{ padding: "0.4rem 1rem", background: activeTab === tab ? "rgba(255,255,255,0.08)" : "transparent", border: "none", color: activeTab === tab ? "var(--cream)" : "rgba(232,226,217,0.40)", fontSize: "0.78rem", fontWeight: activeTab === tab ? 600 : 400, cursor: "pointer" }}>
                  {label}
                </button>
              ))}
            </div>

            {activeTab === "watchlist"    && <PortfolioWatchlist portfolioId={selectedPortfolio.id} />}
            {activeTab === "distribution" && userId && <PortfolioSignalDistribution userId={userId} />}
            {activeTab === "history"      && <PortfolioBuildHistory portfolioId={selectedPortfolio.id} />}
          </Panel>
        </>
      )}
    </>
  );
}
