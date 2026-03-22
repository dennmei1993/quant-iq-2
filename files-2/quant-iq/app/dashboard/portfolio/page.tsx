"use client";
import { useEffect, useState, useCallback } from "react";

type Holding = {
  id: string; ticker: string; name: string | null; asset_type: string | null;
  quantity: number | null; avg_cost: number | null; notes: string | null;
  signal: { signal: string; price_usd: number | null; change_pct: number | null } | null;
};

type Portfolio = { id: string; name: string };
type Memo      = { id: string; content: string; created_at: string };

const SIG_COLOR: Record<string,string> = { buy:"var(--signal-bull)", watch:"var(--signal-neut)", hold:"rgba(232,226,217,0.3)", avoid:"var(--signal-bear)" };

export default function PortfolioPage() {
  const [portfolio,  setPortfolio]  = useState<Portfolio | null>(null);
  const [holdings,   setHoldings]   = useState<Holding[]>([]);
  const [memos,      setMemos]      = useState<Memo[]>([]);
  const [ticker,     setTicker]     = useState("");
  const [quantity,   setQuantity]   = useState("");
  const [avgCost,    setAvgCost]    = useState("");
  const [adding,     setAdding]     = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error,      setError]      = useState("");

  const load = useCallback(async () => {
    const [pRes, mRes] = await Promise.all([
      fetch("/api/portfolio").then(r => r.json()),
      fetch("/api/advisory").then(r => r.json()),
    ]);
    setPortfolio(pRes.portfolio ?? null);
    setHoldings(pRes.holdings ?? []);
    setMemos(mRes.memos ?? []);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addHolding(e: React.FormEvent) {
    e.preventDefault();
    if (!ticker.trim()) return;
    setAdding(true); setError("");
    const res = await fetch("/api/portfolio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: ticker.toUpperCase(), quantity: quantity || undefined, avg_cost: avgCost || undefined }),
    });
    if (res.ok) { setTicker(""); setQuantity(""); setAvgCost(""); await load(); }
    else { const d = await res.json(); setError(d.error ?? "Failed to add"); }
    setAdding(false);
  }

  async function removeHolding(id: string) {
    await fetch(`/api/portfolio?holding_id=${id}`, { method: "DELETE" });
    setHoldings(h => h.filter(x => x.id !== id));
  }

  async function generateMemo() {
    if (!portfolio) return;
    setGenerating(true); setError("");
    const res = await fetch("/api/advisory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ portfolio_id: portfolio.id }),
    });
    const d = await res.json();
    if (res.ok)  { setMemos(m => [d.memo, ...m.slice(0, 4)]); }
    else         { setError(d.error ?? "Failed to generate"); }
    setGenerating(false);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: "1.5rem" }}>

      {/* Holdings column */}
      <div>
        <h1 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.8rem", marginBottom: "1.2rem" }}>Portfolio</h1>

        {/* Add form */}
        <form onSubmit={addHolding} style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "1rem 1.2rem", marginBottom: "1.2rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr auto", gap: "0.6rem", alignItems: "flex-end" }}>
            <Field label="Ticker" value={ticker} onChange={setTicker} placeholder="AAPL" />
            <Field label="Quantity" value={quantity} onChange={setQuantity} placeholder="100" />
            <Field label="Avg cost ($)" value={avgCost} onChange={setAvgCost} placeholder="182.50" />
            <button type="submit" disabled={adding}
              style={{ padding: "0.55rem 1rem", background: "var(--gold)", color: "var(--navy)", fontWeight: 700, borderRadius: 6, border: "none", fontSize: "0.82rem", cursor: "pointer", opacity: adding ? 0.6 : 1 }}>
              {adding ? "…" : "Add"}
            </button>
          </div>
          {error && <div style={{ color: "var(--signal-bear)", fontSize: "0.78rem", marginTop: "0.5rem" }}>{error}</div>}
        </form>

        {/* Holdings list */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {holdings.map(h => {
            const sig    = h.signal;
            const sc     = sig?.signal ?? "hold";
            const scCol  = SIG_COLOR[sc] ?? "rgba(232,226,217,0.3)";
            const chg    = sig?.change_pct;
            const value  = sig?.price_usd && h.quantity ? sig.price_usd * h.quantity : null;
            return (
              <div key={h.id} style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "0.85rem 1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <span style={{ fontWeight: 700, color: "var(--cream)" }}>{h.ticker}</span>
                    <span style={{ fontSize: "0.65rem", color: scCol, background: `${scCol}18`, padding: "0.1rem 0.35rem", borderRadius: 10, textTransform: "uppercase" }}>{sc}</span>
                  </div>
                  <div style={{ fontSize: "0.72rem", color: "rgba(232,226,217,0.35)", marginTop: "0.15rem" }}>
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

      {/* Advisory memo column */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.2rem" }}>
          <h2 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.3rem" }}>AI advisory</h2>
          <button onClick={generateMemo} disabled={generating || !holdings.length}
            style={{ padding: "0.5rem 1rem", background: generating ? "rgba(200,169,110,0.2)" : "rgba(200,169,110,0.15)", border: "1px solid rgba(200,169,110,0.3)", color: "var(--gold)", borderRadius: 6, fontSize: "0.8rem", cursor: "pointer", fontWeight: 500 }}>
            {generating ? "Generating…" : "Generate memo"}
          </button>
        </div>

        {!holdings.length && (
          <div style={{ color: "rgba(232,226,217,0.2)", fontSize: "0.82rem" }}>Add holdings first to generate an advisory memo.</div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {memos.map((m, i) => (
            <div key={m.id} style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "1.1rem 1.3rem" }}>
              <div style={{ fontSize: "0.65rem", color: "rgba(200,169,110,0.4)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.6rem" }}>
                {i === 0 ? "Latest" : new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
              <p style={{ fontSize: "0.83rem", color: "rgba(232,226,217,0.65)", lineHeight: 1.7 }}>{m.content}</p>
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
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.68rem", color: "rgba(232,226,217,0.4)", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ width: "100%", padding: "0.5rem 0.7rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--dash-border)", borderRadius: 6, color: "var(--cream)", fontSize: "0.85rem", outline: "none" }} />
    </div>
  );
}
