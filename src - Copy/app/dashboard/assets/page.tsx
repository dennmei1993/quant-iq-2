// src/app/dashboard/assets/page.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Asset = {
  ticker:           string
  name:             string
  asset_type:       string
  sector:           string | null
  signal:           string | null
  score:            number | null
  price_usd:        number | null
  change_pct:       number | null
  rationale:        string | null
  updated_at:       string | null
  theme_count:      number
  max_theme_weight: number
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
        <h1 style={{ color: "var(--cream)", fontFamily: "'Syne', var(--font-sans)", fontSize: "1.4rem", fontWeight: 500, marginBottom: "0.25rem" }}>Asset Screener</h1>
        <p style={{ color: "var(--text-faint)", fontSize: "0.78rem", fontWeight: 300 }}>
          {assets.length} assets — signals updated daily by AI
        </p>
      </div>

      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.2rem", flexWrap: "wrap" }}>
        <FilterGroup label="Type"   value={typeFilter}   options={TYPE_OPTIONS}   onChange={setTypeFilter} />
        <FilterGroup label="Signal" value={signalFilter} options={SIGNAL_OPTIONS} onChange={setSignalFilter} />
      </div>

      {loading ? (
        <div style={{ color: "var(--text-faint)", padding: "2rem 0", textAlign: "center", fontFamily: "'DM Mono', monospace", fontSize: "0.76rem" }}>Loading…</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "1px", background: "var(--border-default)" }}>
          {assets.map(a => <AssetCard key={a.ticker} asset={a} />)}
          {!assets.length && (
            <div style={{ color: "var(--text-faint)", fontSize: "0.78rem", padding: "2rem 0", gridColumn: "1/-1", textAlign: "center" }}>
              No assets match these filters.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AssetCard({ asset: a }: { asset: Asset }) {
  const signal   = a.signal
  const sigColor = SIGNAL_COLOR[signal ?? ""] ?? "rgba(232,226,217,0.35)"

  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)", padding: "1rem 1.1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.5rem" }}>
        <Link href={`/dashboard/tickers/${a.ticker}`} style={{ textDecoration: "none", flex: 1 }}>
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.9rem", fontWeight: 400, color: "var(--green)", letterSpacing: "0.04em" }}>{a.ticker}</div>
          <div style={{ fontFamily: "var(--font-sans)", fontSize: "0.7rem", color: "var(--text-faint)", fontWeight: 300 }}>{a.name}</div>
        </Link>
        {signal && (
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.66rem", fontWeight: 500, background: `${sigColor}18`, color: sigColor, padding: "0.18rem 0.5rem", letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0 }}>
            {signal}
          </span>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "1rem", fontWeight: 400, color: "var(--text-primary)" }}>
          {a.price_usd != null ? `$${Number(a.price_usd).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
        </div>
        {a.change_pct != null && (
          <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.76rem", color: a.change_pct >= 0 ? "var(--signal-bull)" : "var(--signal-bear)", fontWeight: 400 }}>
            {a.change_pct >= 0 ? "+" : ""}{a.change_pct.toFixed(2)}%
          </div>
        )}
      </div>

      <div style={{ height: 2, background: "var(--border-default)", marginBottom: "0.5rem" }}>
        <div style={{ width: `${a.score ?? 0}%`, height: "100%", background: sigColor }} />
      </div>

      {a.theme_count > 0 && (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.62rem", color: "var(--green)", opacity: 0.6, marginBottom: "0.35rem", letterSpacing: "0.04em" }}>
          {a.theme_count} theme{a.theme_count !== 1 ? 's' : ''} · {(a.max_theme_weight * 100).toFixed(0)}% weight
        </div>
      )}

      <div style={{ fontFamily: "var(--font-sans)", fontSize: "0.62rem", color: "var(--text-faint)", marginTop: "0.4rem", fontWeight: 300 }}>
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
      <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.62rem", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.12em" }}>{label}</span>
      <div style={{ display: "flex", gap: "0", border: "1px solid var(--border-default)" }}>
        {options.map(opt => (
          <button key={opt} onClick={() => onChange(opt)}
            style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.64rem", padding: "0.22rem 0.6rem", border: "none", borderRight: "1px solid var(--border-default)", cursor: "pointer",
              background:  value === opt ? "rgba(78,255,145,0.08)" : "transparent",
              color:       value === opt ? "var(--green)" : "var(--text-faint)",
            }}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}
