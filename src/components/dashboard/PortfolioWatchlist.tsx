// src/components/dashboard/PortfolioWatchlist.tsx
"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

interface WatchItem {
  id:                string;
  ticker:            string;
  notes:             string | null;
  added_at:          string;
  // from assets
  name:              string | null;
  sector:            string | null;
  asset_type:        string | null;
  analyst_rating:    string | null;
  // from asset_signals
  signal: {
    signal:            string;
    fundamental_score: number | null;
    technical_score:   number | null;
    price_usd:         number | null;
    change_pct:        number | null;
    rationale:         string | null;
  } | null;
}

interface AssetMatch {
  ticker: string; name: string; asset_type: string; sector: string | null;
}

interface Props {
  portfolioId: string;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const SIG_COLOR: Record<string, string> = {
  buy:   "var(--signal-bull)",
  watch: "var(--signal-neut)",
  hold:  "rgba(232,226,217,0.3)",
  avoid: "var(--signal-bear)",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "0.68rem", color: "rgba(232,226,217,0.4)",
  marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.08em",
};

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "0.5rem 0.7rem",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid var(--dash-border)", borderRadius: 6,
  color: "var(--cream)", fontSize: "0.85rem", outline: "none", boxSizing: "border-box",
};

// ----------------------------------------------------------------------------
// TickerAutocomplete (self-contained, no prop drilling)
// ----------------------------------------------------------------------------

function TickerAutocomplete({ onSelect }: { onSelect: (a: AssetMatch) => void }) {
  const [value,     setValue]     = useState("");
  const [results,   setResults]   = useState<AssetMatch[]>([]);
  const [open,      setOpen]      = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [searching, setSearching] = useState(false);
  const debRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debRef.current) clearTimeout(debRef.current);
    if (!value.trim()) { setResults([]); setOpen(false); return; }
    debRef.current = setTimeout(async () => {
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
    function h(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, -1)); }
    if (e.key === "Enter" && activeIdx >= 0) { e.preventDefault(); select(results[activeIdx]); }
    if (e.key === "Escape") setOpen(false);
  }

  function select(a: AssetMatch) {
    onSelect(a);
    setValue("");
    setOpen(false);
    setResults([]);
  }

  const typeColor: Record<string, string> = {
    stock: "rgba(78,202,153,0.7)", etf: "rgba(200,169,110,0.7)",
    crypto: "rgba(122,180,232,0.7)", commodity: "rgba(232,180,122,0.7)",
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", flex: 1 }}>
      <label style={labelStyle}>Add ticker to watchlist</label>
      <input
        value={value}
        onChange={e => setValue(e.target.value.toUpperCase())}
        onKeyDown={handleKey}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search AAPL, BTC…"
        autoComplete="off"
        style={inputStyle}
      />
      {searching && (
        <div style={{ position: "absolute", right: "0.6rem", top: "2.1rem", fontSize: "0.65rem", color: "rgba(232,226,217,0.3)" }}>…</div>
      )}
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
          background: "var(--navy2)", border: "1px solid var(--dash-border)",
          borderRadius: 6, marginTop: 2, overflow: "hidden", boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        }}>
          {results.map((a, i) => (
            <div key={a.ticker} onMouseDown={() => select(a)} onMouseEnter={() => setActiveIdx(i)}
              style={{
                padding: "0.55rem 0.8rem", cursor: "pointer",
                background: i === activeIdx ? "rgba(255,255,255,0.06)" : "transparent",
                borderBottom: i < results.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                display: "flex", alignItems: "center", gap: "0.6rem",
              }}>
              <span style={{ fontWeight: 700, color: "var(--gold)", fontFamily: "monospace", fontSize: "0.85rem", minWidth: "3.5rem" }}>{a.ticker}</span>
              <span style={{ fontSize: "0.75rem", color: "rgba(232,226,217,0.5)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
              <span style={{ fontSize: "0.6rem", color: typeColor[a.asset_type] ?? "rgba(232,226,217,0.3)", textTransform: "uppercase", flexShrink: 0 }}>{a.asset_type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Component
// ----------------------------------------------------------------------------

export function PortfolioWatchlist({ portfolioId }: Props) {
  const [watchlist, setWatchlist]   = useState<WatchItem[]>([]);
  const [loading,   setLoading]     = useState(true);
  const [adding,    setAdding]      = useState(false);
  const [error,     setError]       = useState<string | null>(null);

  // ── Load ─────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/portfolio/watchlist?portfolio_id=${portfolioId}`);
      const data = await res.json();
      setWatchlist(data.watchlist ?? []);
    } catch {
      setError("Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  }, [portfolioId]);

  useEffect(() => { load(); }, [load]);

  // ── Add ──────────────────────────────────────────────────────────────────

  async function addTicker(asset: AssetMatch) {
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/portfolio/watchlist", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ portfolio_id: portfolioId, ticker: asset.ticker }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to add");
        return;
      }
      await load();
    } finally {
      setAdding(false);
    }
  }

  // ── Remove ────────────────────────────────────────────────────────────────

  async function remove(id: string) {
    setWatchlist(prev => prev.filter(w => w.id !== id));
    await fetch(`/api/portfolio/watchlist?id=${id}`, { method: "DELETE" });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

      {/* Add bar */}
      <div style={{
        background: "var(--navy2)", border: "1px solid var(--dash-border)",
        borderRadius: 8, padding: "0.85rem 1.1rem",
        display: "flex", gap: "0.75rem", alignItems: "flex-end",
      }}>
        <TickerAutocomplete onSelect={addTicker} />
        {adding && (
          <div style={{ fontSize: "0.75rem", color: "rgba(232,226,217,0.3)", paddingBottom: "0.55rem" }}>Adding…</div>
        )}
      </div>

      {error && (
        <div style={{ fontSize: "0.75rem", color: "var(--signal-bear)", padding: "0 0.25rem" }}>{error}</div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ color: "rgba(232,226,217,0.2)", fontSize: "0.82rem", padding: "1rem 0" }}>Loading…</div>
      ) : watchlist.length === 0 ? (
        <div style={{
          background: "var(--navy2)", border: "1px solid var(--dash-border)",
          borderRadius: 8, padding: "2rem", textAlign: "center",
          color: "rgba(232,226,217,0.2)", fontSize: "0.82rem",
        }}>
          No tickers on this watchlist yet. Search above to add one, or use the portfolio builder.
        </div>
      ) : (
        <div style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, overflow: "hidden" }}>

          {/* Header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.4fr 2rem",
            padding: "0.45rem 1rem",
            borderBottom: "1px solid var(--dash-border)",
            fontSize: "0.6rem", color: "rgba(232,226,217,0.3)",
            textTransform: "uppercase", letterSpacing: "0.07em",
          }}>
            <span>Ticker</span>
            <span style={{ textAlign: "right" }}>Signal</span>
            <span style={{ textAlign: "right" }}>F score</span>
            <span style={{ textAlign: "right" }}>T score</span>
            <span style={{ textAlign: "right" }}>Price</span>
            <span style={{ textAlign: "right" }}>Day chg</span>
            <span />
          </div>

          {/* Rows */}
          {watchlist.map((w, idx) => {
            const sig    = w.signal;
            const sc     = sig?.signal ?? null;
            const scCol  = sc ? (SIG_COLOR[sc] ?? "rgba(232,226,217,0.3)") : "rgba(232,226,217,0.15)";
            const chg    = sig?.change_pct ?? null;
            const fScore = sig?.fundamental_score ?? null;
            const tScore = sig?.technical_score   ?? null;
            const price  = sig?.price_usd         ?? null;

            // Score bar helper
            function ScoreBar({ value, color }: { value: number | null; color: string }) {
              if (value == null) return <span style={{ fontSize: "0.75rem", color: "rgba(232,226,217,0.2)" }}>—</span>;
              return (
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", justifyContent: "flex-end" }}>
                  <div style={{ width: 40, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: "0.72rem", color: "rgba(232,226,217,0.5)", minWidth: "1.5rem", textAlign: "right" }}>{value}</span>
                </div>
              );
            }

            return (
              <div key={w.id} style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1.4fr 2rem",
                padding: "0.65rem 1rem", alignItems: "center",
                borderBottom: idx < watchlist.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
                transition: "background 0.1s",
              }}>

                {/* Ticker + meta */}
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
                    <span style={{ fontWeight: 700, color: "var(--cream)", fontSize: "0.88rem" }}>{w.ticker}</span>
                    {sc && (
                      <span style={{
                        fontSize: "0.58rem", color: scCol,
                        background: `${scCol}18`, padding: "0.05rem 0.35rem",
                        borderRadius: 8, textTransform: "uppercase", fontWeight: 700,
                      }}>
                        {sc}
                      </span>
                    )}
                    {w.asset_type && (
                      <span style={{ fontSize: "0.58rem", color: "rgba(232,226,217,0.25)", textTransform: "uppercase" }}>
                        {w.asset_type}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "rgba(232,226,217,0.3)", marginTop: "0.1rem" }}>
                    {w.name && <span style={{ marginRight: "0.5rem" }}>{w.name}</span>}
                    {w.sector && <span>{w.sector}</span>}
                  </div>
                  {sig?.rationale && (
                    <div style={{ fontSize: "0.65rem", color: "rgba(232,226,217,0.2)", marginTop: "0.15rem", lineHeight: 1.4 }}>
                      {sig.rationale.slice(0, 100)}{sig.rationale.length > 100 ? "…" : ""}
                    </div>
                  )}
                  {w.notes && (
                    <div style={{ fontSize: "0.65rem", color: "rgba(200,169,110,0.4)", marginTop: "0.1rem", fontStyle: "italic" }}>
                      {w.notes}
                    </div>
                  )}
                </div>

                {/* Signal badge */}
                <div style={{ textAlign: "right" }}>
                  {sc ? (
                    <span style={{
                      fontSize: "0.7rem", color: scCol,
                      background: `${scCol}15`, padding: "0.2rem 0.5rem",
                      borderRadius: 5, fontWeight: 700, textTransform: "uppercase",
                    }}>
                      {sc}
                    </span>
                  ) : (
                    <span style={{ fontSize: "0.72rem", color: "rgba(232,226,217,0.2)" }}>—</span>
                  )}
                </div>

                {/* F score */}
                <div style={{ textAlign: "right" }}>
                  <ScoreBar value={fScore} color="rgba(200,169,110,0.7)" />
                </div>

                {/* T score */}
                <div style={{ textAlign: "right" }}>
                  <ScoreBar value={tScore} color="rgba(99,179,237,0.7)" />
                </div>

                {/* Price */}
                <div style={{ textAlign: "right", fontSize: "0.82rem", color: "var(--cream)", fontWeight: 600 }}>
                  {price != null ? `$${price.toFixed(2)}` : "—"}
                </div>

                {/* Day change */}
                <div style={{ textAlign: "right", fontSize: "0.8rem", fontWeight: 600, color: chg == null ? "rgba(232,226,217,0.2)" : chg >= 0 ? "var(--signal-bull)" : "var(--signal-bear)" }}>
                  {chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : "—"}
                </div>

                {/* Remove */}
                <div style={{ textAlign: "right" }}>
                  <button onClick={() => remove(w.id)}
                    style={{ background: "none", border: "none", color: "rgba(232,226,217,0.18)", cursor: "pointer", fontSize: "1rem", padding: 0, lineHeight: 1 }}
                    title="Remove from watchlist">
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Signal upgrade hints */}
      {watchlist.some(w => w.signal?.signal === "watch") && (
        <div style={{ fontSize: "0.72rem", color: "rgba(232,226,217,0.25)", padding: "0 0.25rem", lineHeight: 1.5 }}>
          WATCH tickers are monitoring for technical confirmation. They will be flagged when signal upgrades to BUY.
        </div>
      )}
    </div>
  );
}
