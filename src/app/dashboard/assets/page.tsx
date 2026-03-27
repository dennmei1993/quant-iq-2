// src/app/dashboard/assets/page.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type AssetSignal = {
  signal: string; score: number;
  price_usd: number | null; change_pct: number | null;
  rationale: string | null; updated_at: string;
};
type Asset = {
  ticker: string; name: string; asset_type: string; sector: string | null;
  signal: AssetSignal | null;
};

const SIGNAL_COLOR: Record<string, string> = {
  buy:   "var(--signal-bull)",
  watch: "var(--signal-neut)",
  hold:  "rgba(232,226,217,0.35)",
  avoid: "var(--signal-bear)",
};

const TYPE_OPTIONS   = ["all","stock","etf","crypto","commodity"];
const SIGNAL_OPTIONS = ["all","buy","watch","hold","avoid"];

export default function AssetsPage() {
  const [assets,  setAssets]  = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter,   setTypeFilter]   = useState("all");
  const [signalFilter, setSignalFilter] = useState("all");

  useEffect(() => {
    const params = new URLSearchParams();
    if (typeFilter   !== "all") params.set("type",   typeFilter);
    if (signalFilter !== "all") params.set("signal", signalFilter);
    setLoading(true);
    fetch(`/api/assets?${params}`)
      .then(r => r.json())
      .then(d => { setAssets(d.assets ?? []); setLoading(false); });
  }, [typeFilter, signalFilter]);

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.8rem", marginBottom: "0.25rem" }}>Asset screener</h1>
        <p style={{ color: "rgba(232,226,217,0.35)", fontSize: "0.82rem" }}>
          {assets.length} assets — signals updated daily by AI
        </p>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        <FilterGroup label="Type"   value={typeFilter}   options={TYPE_OPTIONS}   onChange={setTypeFilter} />
        <FilterGroup label="Signal" value={signalFilter} options={SIGNAL_OPTIONS} onChange={setSignalFilter} />
      </div>

      {loading ? (
        <div style={{ color: "rgba(232,226,217,0.25)", padding: "2rem 0", textAlign: "center" }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "0.9rem" }}>
          {assets.map(a => <AssetCard key={a.ticker} asset={a} />)}
          {!assets.length && (
            <div style={{ color: "rgba(232,226,217,0.25)", fontSize: "0.82rem", padding: "2rem 0", gridColumn: "1/-1", textAlign: "center" }}>
              No assets match these filters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssetCard({ asset: a }: { asset: Asset }) {
  const sig      = a.signal;
  const signal   = sig?.signal ?? "hold";
  const sigColor = SIGNAL_COLOR[signal] ?? "rgba(232,226,217,0.35)";
  const chg      = sig?.change_pct;

  return (
    <div style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "1rem 1.1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>

        {/* Clickable ticker + name */}
        <Link href={`/dashboard/tickers/${a.ticker}`} style={{ textDecoration: "none", flex: 1 }}>
          <div style={{ fontSize: "1rem", fontWeight: 700, color: "var(--gold)" }}>{a.ticker}</div>
          <div style={{ fontSize: "0.72rem", color: "rgba(232,226,217,0.4)" }}>{a.name}</div>
        </Link>

        <span style={{ fontSize: "0.7rem", fontWeight: 600, background: `${sigColor}18`, color: sigColor, padding: "0.2rem 0.55rem", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.04em", flexShrink: 0 }}>
          {signal}
        </span>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--cream)" }}>
          {sig?.price_usd != null ? `$${Number(sig.price_usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
        </div>
        {chg != null && (
          <div style={{ fontSize: "0.78rem", color: chg >= 0 ? "var(--signal-bull)" : "var(--signal-bear)", fontWeight: 600 }}>
            {chg >= 0 ? "+" : ""}{chg.toFixed(2)}%
          </div>
        )}
      </div>

      {/* Score bar */}
      <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, marginBottom: "0.5rem" }}>
        <div style={{ width: `${sig?.score ?? 50}%`, height: "100%", background: sigColor, borderRadius: 2 }} />
      </div>

      {sig?.rationale && (
        <div style={{ fontSize: "0.72rem", color: "rgba(232,226,217,0.35)", lineHeight: 1.5 }}>
          {sig.rationale}
        </div>
      )}

      <div style={{ fontSize: "0.65rem", color: "rgba(232,226,217,0.2)", marginTop: "0.5rem" }}>
        {a.asset_type} · {a.sector ?? "general"}
      </div>
    </div>
  );
}

function FilterGroup({ label, value, options, onChange }: {
  label: string; value: string; options: string[]; onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <span style={{ fontSize: "0.72rem", color: "rgba(232,226,217,0.35)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</span>
      <div style={{ display: "flex", gap: "0.25rem" }}>
        {options.map(opt => (
          <button key={opt} onClick={() => onChange(opt)}
            style={{ fontSize: "0.72rem", padding: "0.25rem 0.65rem", borderRadius: 20, border: "1px solid", cursor: "pointer",
              borderColor: value === opt ? "var(--gold)" : "var(--dash-border)",
              background:  value === opt ? "rgba(200,169,110,0.12)" : "transparent",
              color:       value === opt ? "var(--gold)" : "rgba(232,226,217,0.4)",
            }}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
