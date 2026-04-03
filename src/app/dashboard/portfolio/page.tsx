// src/app/dashboard/portfolio/page.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { PortfolioSignalDistribution } from "@/components/dashboard/PortfolioSignalDistribution";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

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
  id:           string;
  name:         string;
  risk_appetite: string;
};

type Memo = {
  id:         string;
  content:    string;
  created_at: string;
};

type AssetMatch = {
  ticker:     string;
  name:       string;
  asset_type: string;
  sector:     string | null;
};

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const SIG_COLOR: Record<string, string> = {
  buy:   "var(--signal-bull)",
  watch: "var(--signal-neut)",
  hold:  "rgba(232,226,217,0.3)",
  avoid: "var(--signal-bear)",
};

// ----------------------------------------------------------------------------
// TickerAutocomplete
// ----------------------------------------------------------------------------

function TickerAutocomplete({
  value, onChange, onSelect, error,
}: {
  value:    string;
  onChange: (v: string) => void;
  onSelect: (asset: AssetMatch) => void;
  error?:   string;
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
        setResults(data.assets ?? []);
        setOpen((data.assets ?? []).length > 0);
        setActiveIdx(-1);
      } catch { setResults([]); setOpen(false); }
      finally { setSearching(false); }
    }, 200);
  }, [value]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
    if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); handleSelect(results[activeIdx]); }
    if (e.key === "Escape") setOpen(false);
  }

  function handleSelect(asset: AssetMatch) {
    onSelect(asset);
    setOpen(false);
    setResults([]);
  }

  const typeColor: Record<string, string> = {
    stock:     "rgba(78,202,153,0.7)",
    etf:       "rgba(200,169,110,0.7)",
    crypto:    "rgba(122,180,232,0.7)",
    commodity: "rgba(232,180,122,0.7)",
  };

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <label style={labelStyle}>Ticker</label>
      <input
        value={value}
        onChange={e => { onChange(e.target.value.toUpperCase()); }}
        onKeyDown={handleKey}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search AAPL, BTC…"
        autoComplete="off"
        style={{
          ...inputStyle,
          background: error ? "rgba(232,112,112,0.06)" : "rgba(255,255,255,0.05)",
          border: `1px solid ${error ? "rgba(232,112,112,0.4)" : "var(--dash-border)"}`,
        }}
      />
      {searching && (
        <div style={{ position: "absolute", right: "0.6rem", top: "2.1rem", fontSize: "0.65rem", color: "rgba(232,226,217,0.3)" }}>…</div>
      )}
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          background: "var(--navy2)", border: "1px solid var(--dash-border)",
          borderRadius: 6, marginTop: 2, overflow: "hidden",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {results.map((asset, i) => (
            <div
              key={asset.ticker}
              onMouseDown={() => handleSelect(asset)}
              onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: "0.55rem 0.8rem", cursor: "pointer",
                background: i === activeIdx ? "rgba(255,255,255,0.06)" : "transparent",
                borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                display: "flex", alignItems: "center", gap: "0.6rem",
              }}
            >
              <span style={{ fontWeight: 700, color: "var(--gold)", fontFamily: "monospace", fontSize: "0.85rem", minWidth: "3.5rem" }}>
                {asset.ticker}
              </span>
              <span style={{ fontSize: "0.75rem", color: "rgba(232,226,217,0.5)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {asset.name}
              </span>
              <span style={{ fontSize: "0.6rem", color: typeColor[asset.asset_type] ?? "rgba(232,226,217,0.3)", textTransform: "uppercase", flexShrink: 0 }}>
                {asset.asset_type}
              </span>
            </div>
          ))}
        </div>
      )}
      {error && <div style={{ fontSize: "0.72rem", color: "var(--signal-bear)", marginTop: "0.3rem" }}>{error}</div>}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Create Portfolio Modal
// ----------------------------------------------------------------------------

function CreatePortfolioModal({
  onClose,
  onCreate,
}: {
  onClose:  () => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name,    setName]    = useState("");
  const [saving,  setSaving]  = useState(false);
  const [err,     setErr]     = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr("Name is required"); return; }
    setSaving(true);
    try {
      await onCreate(name.trim());
      onClose();
    } catch (e: any) {
      setErr(e.message ?? "Failed to create portfolio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 100,
      background: "rgba(0,0,0,0.6)", display: "flex",
      alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        background: "var(--navy2)", border: "1px solid var(--dash-border)",
        borderRadius: 10, padding: "1.5rem", width: 360,
        boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
      }}>
        <h3 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.2rem", marginBottom: "1.2rem" }}>
          New Portfolio
        </h3>
        <form onSubmit={handleSubmit}>
          <Field label="Portfolio name" value={name} onChange={v => { setName(v); setErr(""); }} placeholder="e.g. Growth, Retirement, Crypto" />
          {err && <div style={{ fontSize: "0.75rem", color: "var(--signal-bear)", marginTop: "0.4rem" }}>{err}</div>}
          <div style={{ display: "flex", gap: "0.6rem", marginTop: "1.2rem", justifyContent: "flex-end" }}>
            <button type="button" onClick={onClose}
              style={{ padding: "0.5rem 1rem", background: "transparent", border: "1px solid var(--dash-border)", color: "rgba(232,226,217,0.5)", borderRadius: 6, cursor: "pointer", fontSize: "0.82rem" }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              style={{ padding: "0.5rem 1rem", background: "var(--gold)", color: "var(--navy)", fontWeight: 700, borderRadius: 6, border: "none", fontSize: "0.82rem", cursor: "pointer", opacity: saving ? 0.6 : 1 }}>
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Page
// ----------------------------------------------------------------------------

export default function PortfolioPage() {
  const [portfolios,    setPortfolios]    = useState<Portfolio[]>([]);
  const [selectedId,    setSelectedId]    = useState<string | null>(null);
  const [holdings,      setHoldings]      = useState<Holding[]>([]);
  const [memos,         setMemos]         = useState<Memo[]>([]);
  const [userId,        setUserId]        = useState<string | null>(null);

  // Form state
  const [ticker,        setTicker]        = useState("");
  const [quantity,      setQuantity]      = useState("");
  const [avgCost,       setAvgCost]       = useState("");
  const [adding,        setAdding]        = useState(false);
  const [generating,    setGenerating]    = useState(false);
  const [error,         setError]         = useState("");
  const [tickerError,   setTickerError]   = useState("");

  // UI state
  const [showCreate,    setShowCreate]    = useState(false);
  const [activeTab,     setActiveTab]     = useState<"holdings" | "distribution">("holdings");

  // Load user + portfolios on mount
  useEffect(() => {
    async function init() {
      const res  = await fetch("/api/profile");
      const data = await res.json();
      setUserId(data.profile?.id ?? null);

      const pRes  = await fetch("/api/portfolio");
      const pData = await pRes.json();
      const all   = pData.portfolios ?? (pData.portfolio ? [pData.portfolio] : []);
      setPortfolios(all);
      if (all.length) setSelectedId(all[0].id);
    }
    init();
  }, []);

  // Load holdings + memos when selected portfolio changes
  const loadPortfolioData = useCallback(async (portfolioId: string) => {
    const [pRes, mRes] = await Promise.all([
      fetch(`/api/portfolio?portfolio_id=${portfolioId}`).then(r => r.json()),
      fetch(`/api/advisory?portfolio_id=${portfolioId}`).then(r => r.json()),
    ]);
    setHoldings(pRes.holdings ?? []);
    setMemos(mRes.memos ?? []);
  }, []);

  useEffect(() => {
    if (selectedId) loadPortfolioData(selectedId);
  }, [selectedId, loadPortfolioData]);

  // Create portfolio
  async function handleCreatePortfolio(name: string) {
    const res  = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create_portfolio", name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Failed to create");
    const newPort = data.portfolio as Portfolio;
    setPortfolios(prev => [...prev, newPort]);
    setSelectedId(newPort.id);
  }

  // Add holding
  async function addHolding(e: React.FormEvent) {
    e.preventDefault();
    const t = ticker.trim();
    if (!t) { setTickerError("Please select a ticker"); return; }
    if (!selectedId) return;

    setAdding(true); setError(""); setTickerError("");
    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action:       "add_holding",
        portfolio_id: selectedId,
        ticker:       t.toUpperCase(),
        quantity:     quantity || undefined,
        avg_cost:     avgCost  || undefined,
      }),
    });

    if (res.ok) {
      setTicker(""); setQuantity(""); setAvgCost("");
      await loadPortfolioData(selectedId);
    } else {
      const d   = await res.json();
      const msg = d.error ?? "Failed to add";
      if (msg.toLowerCase().includes("ticker")) setTickerError(msg);
      else setError(msg);
    }
    setAdding(false);
  }

  // Remove holding
  async function removeHolding(id: string) {
    await fetch(`/api/portfolio?holding_id=${id}`, { method: "DELETE" });
    setHoldings(h => h.filter(x => x.id !== id));
  }

  // Generate memo
  async function generateMemo() {
    if (!selectedId) return;
    setGenerating(true); setError("");
    const res = await fetch("/api/advisory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolio_id: selectedId }),
    });
    const d = await res.json();
    if (res.ok) setMemos(m => [d.memo, ...m.slice(0, 4)]);
    else        setError(d.error ?? "Failed to generate");
    setGenerating(false);
  }

  const selectedPortfolio = portfolios.find(p => p.id === selectedId) ?? null;

  // ----------------------------------------------------------------------------
  // Render
  // ----------------------------------------------------------------------------

  return (
    <>
      {showCreate && (
        <CreatePortfolioModal
          onClose={() => setShowCreate(false)}
          onCreate={handleCreatePortfolio}
        />
      )}

      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.5rem" }}>
        <h1 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.8rem", margin: 0 }}>
          Portfolio
        </h1>
        <button
          onClick={() => setShowCreate(true)}
          style={{ padding: "0.45rem 0.9rem", background: "rgba(200,169,110,0.12)", border: "1px solid rgba(200,169,110,0.3)", color: "var(--gold)", borderRadius: 6, fontSize: "0.8rem", cursor: "pointer", fontWeight: 500 }}
        >
          + New portfolio
        </button>
      </div>

      {/* Portfolio selector */}
      {portfolios.length > 0 && (
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
          {portfolios.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedId(p.id)}
              style={{
                padding: "0.4rem 1rem",
                background: p.id === selectedId ? "rgba(200,169,110,0.15)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${p.id === selectedId ? "rgba(200,169,110,0.4)" : "var(--dash-border)"}`,
                color: p.id === selectedId ? "var(--gold)" : "rgba(232,226,217,0.4)",
                borderRadius: 6, fontSize: "0.82rem", cursor: "pointer", fontWeight: p.id === selectedId ? 600 : 400,
                transition: "all 0.15s",
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* No portfolios yet */}
      {!portfolios.length && (
        <div style={{ color: "rgba(232,226,217,0.25)", fontSize: "0.85rem", padding: "2rem 0" }}>
          No portfolios yet.{" "}
          <button onClick={() => setShowCreate(true)} style={{ background: "none", border: "none", color: "var(--gold)", cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline" }}>
            Create your first portfolio
          </button>
        </div>
      )}

      {selectedPortfolio && (
        <>
          {/* Tab switcher */}
          <div style={{ display: "flex", gap: 0, marginBottom: "1.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--dash-border)", borderRadius: 7, overflow: "hidden", width: "fit-content" }}>
            {(["holdings", "distribution"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: "0.45rem 1.1rem",
                  background: activeTab === tab ? "rgba(255,255,255,0.08)" : "transparent",
                  border: "none",
                  color: activeTab === tab ? "var(--cream)" : "rgba(232,226,217,0.35)",
                  fontSize: "0.8rem", fontWeight: activeTab === tab ? 600 : 400,
                  cursor: "pointer", textTransform: "capitalize", transition: "all 0.15s",
                }}
              >
                {tab === "holdings" ? "Holdings" : "Signal Distribution"}
              </button>
            ))}
          </div>

          {/* Holdings tab */}
          {activeTab === "holdings" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "1.5rem" }}>

              {/* Left — holdings list + add form */}
              <div>
                {/* Add holding form */}
                <form onSubmit={addHolding} style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "1rem 1.2rem", marginBottom: "1.2rem" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 0.9fr auto", gap: "0.6rem", alignItems: "flex-start" }}>
                    <TickerAutocomplete
                      value={ticker}
                      onChange={v => { setTicker(v); setTickerError(""); }}
                      onSelect={a => { setTicker(a.ticker); setTickerError(""); }}
                      error={tickerError}
                    />
                    <Field label="Quantity"     value={quantity} onChange={setQuantity} placeholder="100" />
                    <Field label="Avg cost ($)" value={avgCost}  onChange={setAvgCost}  placeholder="182.50" />
                    <div style={{ paddingTop: "1.35rem" }}>
                      <button type="submit" disabled={adding}
                        style={{ padding: "0.55rem 1rem", background: "var(--gold)", color: "var(--navy)", fontWeight: 700, borderRadius: 6, border: "none", fontSize: "0.82rem", cursor: "pointer", opacity: adding ? 0.6 : 1, whiteSpace: "nowrap" }}>
                        {adding ? "…" : "Add"}
                      </button>
                    </div>
                  </div>
                  {error && <div style={{ color: "var(--signal-bear)", fontSize: "0.78rem", marginTop: "0.5rem" }}>{error}</div>}
                </form>

                {/* Holdings list */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  {holdings.map(h => {
                    const sig   = h.signal;
                    const sc    = sig?.signal ?? "hold";
                    const scCol = SIG_COLOR[sc] ?? "rgba(232,226,217,0.3)";
                    const chg   = sig?.change_pct;
                    const value = sig?.price_usd && h.quantity ? sig.price_usd * h.quantity : null;
                    return (
                      <div key={h.id} style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "0.85rem 1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontWeight: 700, color: "var(--cream)" }}>{h.ticker}</span>
                            <span style={{ fontSize: "0.65rem", color: scCol, background: `${scCol}18`, padding: "0.1rem 0.35rem", borderRadius: 10, textTransform: "uppercase" }}>{sc}</span>
                          </div>
                          <div style={{ fontSize: "0.72rem", color: "rgba(232,226,217,0.35)", marginTop: "0.15rem" }}>
                            {h.name && <span style={{ marginRight: "0.4rem", opacity: 0.7 }}>{h.name}</span>}
                            {h.quantity != null ? `${h.quantity} units` : ""}
                            {h.avg_cost != null ? ` · avg $${h.avg_cost}` : ""}
                            {value != null ? ` · value $${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : ""}
                          </div>
                        </div>
                        <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: "0.75rem" }}>
                          {chg != null && (
                            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: chg >= 0 ? "var(--signal-bull)" : "var(--signal-bear)" }}>
                              {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
                            </span>
                          )}
                          <button onClick={() => removeHolding(h.id)}
                            style={{ background: "none", border: "none", color: "rgba(232,226,217,0.2)", cursor: "pointer", fontSize: "1rem", padding: "0 0.2rem" }}>
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {!holdings.length && (
                    <div style={{ color: "rgba(232,226,217,0.2)", fontSize: "0.82rem", padding: "1rem 0" }}>
                      No holdings yet. Add a ticker above.
                    </div>
                  )}
                </div>
              </div>

              {/* Right — AI advisory memo */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
                  <h2 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.3rem", margin: 0 }}>AI advisory</h2>
                  <button
                    onClick={generateMemo}
                    disabled={generating || !holdings.length}
                    style={{ padding: "0.5rem 1rem", background: generating ? "rgba(200,169,110,0.2)" : "rgba(200,169,110,0.15)", border: "1px solid rgba(200,169,110,0.3)", color: "var(--gold)", borderRadius: 6, fontSize: "0.8rem", cursor: "pointer", fontWeight: 500 }}>
                    {generating ? "Generating…" : "Generate memo"}
                  </button>
                </div>

                {!holdings.length && (
                  <div style={{ color: "rgba(232,226,217,0.2)", fontSize: "0.82rem" }}>
                    Add holdings first to generate an advisory memo.
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                  {memos.map((m, i) => (
                    <div key={m.id} style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "1.1rem 1.3rem" }}>
                      <div style={{ fontSize: "0.65rem", color: "rgba(200,169,110,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.6rem" }}>
                        {i === 0 ? "Latest" : new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </div>
                      <p style={{ fontSize: "0.83rem", color: "rgba(232,226,217,0.65)", lineHeight: 1.7, margin: 0 }}>{m.content}</p>
                    </div>
                  ))}
                </div>

                {!memos.length && holdings.length > 0 && (
                  <div style={{ color: "rgba(232,226,217,0.2)", fontSize: "0.82rem" }}>
                    Click "Generate memo" to get an AI-powered advisory based on your holdings and recent events.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Signal distribution tab */}
          {activeTab === "distribution" && userId && (
            <PortfolioSignalDistribution userId={userId} />
          )}
        </>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// Shared sub-components
// ----------------------------------------------------------------------------

function Field({
  label, value, onChange, placeholder,
}: {
  label:        string;
  value:        string;
  onChange:     (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={inputStyle}
      />
    </div>
  );
}

// ----------------------------------------------------------------------------
// Shared styles
// ----------------------------------------------------------------------------

const labelStyle: React.CSSProperties = {
  display:       "block",
  fontSize:      "0.68rem",
  color:         "rgba(232,226,217,0.4)",
  marginBottom:  "0.25rem",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const inputStyle: React.CSSProperties = {
  width:        "100%",
  padding:      "0.5rem 0.7rem",
  background:   "rgba(255,255,255,0.05)",
  border:       "1px solid var(--dash-border)",
  borderRadius: 6,
  color:        "var(--cream)",
  fontSize:     "0.85rem",
  outline:      "none",
  boxSizing:    "border-box",
};
