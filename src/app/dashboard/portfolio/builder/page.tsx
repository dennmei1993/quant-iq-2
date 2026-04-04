// src/app/dashboard/portfolio/builder/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RiskAppetite, InvestmentHorizon } from "@/types/portfolio-preferences";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type StyleFocus = "growth" | "balanced" | "defensive" | "income" | "speculative";

interface Strategy {
  style:            StyleFocus;
  cash_reserve_pct: number;
  sector_tilts:     string[];   // e.g. ["tech", "healthcare"]
  avoid_sectors:    string[];
  max_single_weight: number;   // % cap per position
  rationale:        string;    // LLM explanation
  summary:          string;    // one-liner headline
}

interface RecommendedTheme {
  id:         string;
  name:       string;
  brief:      string;
  conviction: number;
  momentum:   string;
  fit_reason: string;   // why it fits this strategy
  suggested_allocation: number;   // % of investable
  selected:   boolean;
}

interface TickerAllocation {
  ticker:    string;
  name:      string;
  signal:    "BUY" | "WATCH";
  weight:    number;           // % of theme's allocation
  price:     number | null;
  rationale: string;
  theme_id:  string;
  theme_name: string;
  // editable
  editWeight:  string;
  editSignal:  "BUY" | "WATCH";
  included:    boolean;
}

type Step = 1 | 2 | 3;
type BuildMode = "data" | "llm";

// ─────────────────────────────────────────────────────────────────────────────
// Shared style tokens — matches existing dashboard aesthetic
// ─────────────────────────────────────────────────────────────────────────────

const T = {
  cream:    "var(--cream)",
  gold:     "var(--gold)",
  navy2:    "var(--navy2)",
  border:   "var(--dash-border)",
  bull:     "var(--signal-bull)",
  bear:     "var(--signal-bear)",
  neut:     "var(--signal-neut)",
  dim:      "rgba(232,226,217,0.35)",
  dimmer:   "rgba(232,226,217,0.2)",
  dimmest:  "rgba(232,226,217,0.1)",
} as const;

const STYLE_META: Record<StyleFocus, { label: string; icon: string; desc: string; color: string }> = {
  growth:      { label: "Growth",      icon: "↗", desc: "High-conviction momentum picks, accepts volatility", color: "#4eca99" },
  balanced:    { label: "Balanced",    icon: "◈", desc: "Mix of growth and stability across sectors",         color: "#63b3ed" },
  defensive:   { label: "Defensive",   icon: "◇", desc: "Low-beta, stable earnings, capital preservation",   color: "#f0b429" },
  income:      { label: "Income",      icon: "◎", desc: "Dividend-focused, yield generation, REITs/ETFs",    color: "#c8a96e" },
  speculative: { label: "Speculative", icon: "◉", desc: "High risk/reward, crypto, small-cap, thematic",    color: "#fc5c65" },
};

const SECTORS = ["Technology","Healthcare","Financials","Energy","Industrials","Consumer","Materials","Utilities","Real Estate","Communications"];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatCurrency(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: Step; total: number }) {
  const labels = ["Strategy", "Themes", "Allocation"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: "2rem" }}>
      {labels.map((label, i) => {
        const step = (i + 1) as Step;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3rem" }}>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                background: done ? T.gold : active ? "rgba(200,169,110,0.15)" : "rgba(255,255,255,0.04)",
                border: `1.5px solid ${done ? T.gold : active ? "rgba(200,169,110,0.6)" : T.border}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: "0.8rem", fontWeight: 700,
                color: done ? "var(--navy)" : active ? T.gold : T.dim,
                transition: "all 0.3s",
              }}>
                {done ? "✓" : step}
              </div>
              <span style={{ fontSize: "0.65rem", color: active ? T.gold : T.dim, fontWeight: active ? 600 : 400, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                {label}
              </span>
            </div>
            {i < labels.length - 1 && (
              <div style={{ width: 80, height: 1, background: done ? "rgba(200,169,110,0.4)" : T.border, margin: "0 0.5rem 1.4rem" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", color: T.dim, fontSize: "0.85rem" }}>
      <div style={{
        width: 16, height: 16, border: `2px solid rgba(200,169,110,0.2)`,
        borderTopColor: T.gold, borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
      }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PillToggle({ active, onClick, children, color }: {
  active: boolean; onClick: () => void; children: React.ReactNode; color?: string;
}) {
  const c = color ?? T.gold;
  return (
    <button onClick={onClick} style={{
      padding: "0.3rem 0.8rem",
      background: active ? `${c}20` : "rgba(255,255,255,0.04)",
      border: `1px solid ${active ? `${c}60` : T.border}`,
      color: active ? c : T.dim, borderRadius: 5,
      fontSize: "0.75rem", fontWeight: active ? 600 : 400,
      cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap" as const,
    }}>
      {children}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: "0.62rem", color: "rgba(200,169,110,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.6rem" }}>
      {children}
    </div>
  );
}

function Card({ children, highlight, style }: { children: React.ReactNode; highlight?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: highlight ? "rgba(200,169,110,0.04)" : T.navy2,
      border: `1px solid ${highlight ? "rgba(200,169,110,0.25)" : T.border}`,
      borderRadius: 10, padding: "1.1rem 1.3rem",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Strategy
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// ModeToggle
// ─────────────────────────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange, dataReady, llmReady }: {
  mode:      BuildMode;
  onChange:  (m: BuildMode) => void;
  dataReady: boolean;
  llmReady:  boolean;
}) {
  const modes: { id: BuildMode; label: string; icon: string; desc: string }[] = [
    {
      id:    "data",
      icon:  "◈",
      label: "Data-driven",
      desc:  "Ranks your mapped theme_tickers using signals + Claude for selection",
    },
    {
      id:    "llm",
      icon:  "✦",
      label: "LLM-powered",
      desc:  "Claude freely selects from the full asset universe with no pre-mapping constraint",
    },
  ];

  return (
    <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.5rem" }}>
      {modes.map(m => (
        <button
          key={m.id}
          onClick={() => onChange(m.id)}
          style={{
            flex: 1, textAlign: "left",
            padding: "0.85rem 1.1rem",
            background: mode === m.id ? "rgba(200,169,110,0.08)" : "rgba(255,255,255,0.03)",
            border: `1.5px solid ${mode === m.id ? "rgba(200,169,110,0.45)" : T.border}`,
            borderRadius: 9, cursor: "pointer", transition: "all 0.2s",
            display: "flex", gap: "0.85rem", alignItems: "flex-start",
          }}
        >
          <div style={{
            fontSize: "1.2rem", color: mode === m.id ? T.gold : T.dim,
            marginTop: "0.05rem", flexShrink: 0, transition: "color 0.2s",
          }}>
            {m.icon}
          </div>
          <div>
            <div style={{
              fontSize: "0.88rem", fontWeight: 700,
              color: mode === m.id ? T.gold : "rgba(232,226,217,0.6)",
              marginBottom: "0.2rem", display: "flex", alignItems: "center", gap: "0.5rem",
            }}>
              {m.label}
              {m.id === "data" && dataReady && (
                <span style={{ fontSize: "0.6rem", background: "rgba(78,202,153,0.15)", color: "#4eca99", border: "1px solid rgba(78,202,153,0.3)", borderRadius: 4, padding: "0.05rem 0.4rem" }}>ready</span>
              )}
              {m.id === "llm" && llmReady && (
                <span style={{ fontSize: "0.6rem", background: "rgba(78,202,153,0.15)", color: "#4eca99", border: "1px solid rgba(78,202,153,0.3)", borderRadius: 4, padding: "0.05rem 0.4rem" }}>ready</span>
              )}
            </div>
            <div style={{ fontSize: "0.72rem", color: T.dim, lineHeight: 1.4 }}>{m.desc}</div>
          </div>
        </button>
      ))}
    </div>
  );
}

function Step1Strategy({
  portfolio,
  strategy,
  loading,
  onGenerate,
  onUpdate,
  onNext,
}: {
  portfolio: any;
  strategy:  Strategy | null;
  loading:   boolean;
  onGenerate: () => void;
  onUpdate:  (s: Strategy) => void;
  onNext:    () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

      {/* Portfolio context summary */}
      <Card>
        <SectionLabel>Portfolio context</SectionLabel>
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          {[
            ["Risk",       portfolio?.risk_appetite],
            ["Horizon",    portfolio?.investment_horizon],
            ["Benchmark",  portfolio?.benchmark],
            ["Capital",    portfolio?.total_capital ? formatCurrency(portfolio.total_capital) : "—"],
            ["Cash floor", `${portfolio?.cash_pct ?? 0}%`],
            ["Target",     `${portfolio?.target_holdings ?? "—"} holdings`],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: "0.62rem", color: T.dim, textTransform: "uppercase", letterSpacing: "0.07em" }}>{k}</div>
              <div style={{ fontSize: "0.9rem", fontWeight: 600, color: T.cream, marginTop: "0.15rem", textTransform: "capitalize" }}>{v}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Generate / loading */}
      {!strategy && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "2rem 0" }}>
          {loading ? (
            <>
              <Spinner />
              <p style={{ fontSize: "0.82rem", color: T.dim, margin: 0 }}>
                Analysing your preferences and current market conditions…
              </p>
            </>
          ) : (
            <>
              <p style={{ fontSize: "0.85rem", color: T.dim, margin: 0, textAlign: "center", maxWidth: 420 }}>
                Claude will analyse your preferences and the current macro environment to recommend an investment strategy profile for this portfolio.
              </p>
              <button onClick={onGenerate} style={{
                padding: "0.65rem 1.5rem", background: "rgba(200,169,110,0.15)",
                border: "1px solid rgba(200,169,110,0.4)", color: T.gold,
                borderRadius: 8, fontSize: "0.88rem", fontWeight: 600, cursor: "pointer",
              }}>
                ✦ Generate strategy
              </button>
            </>
          )}
        </div>
      )}

      {/* Strategy result */}
      {strategy && (
        <>
          <Card highlight>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", marginBottom: "0.8rem" }}>
              <div style={{
                fontSize: "1.8rem", width: 48, height: 48, borderRadius: 10,
                background: `${STYLE_META[strategy.style].color}18`,
                border: `1px solid ${STYLE_META[strategy.style].color}40`,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: STYLE_META[strategy.style].color, flexShrink: 0,
              }}>
                {STYLE_META[strategy.style].icon}
              </div>
              <div>
                <div style={{ fontSize: "1.1rem", fontWeight: 700, color: T.cream }}>{strategy.summary}</div>
                <div style={{ fontSize: "0.78rem", color: T.dim, marginTop: "0.25rem", lineHeight: 1.6 }}>{strategy.rationale}</div>
              </div>
            </div>
          </Card>

          {/* Style override */}
          <div>
            <SectionLabel>Strategy style</SectionLabel>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {(Object.keys(STYLE_META) as StyleFocus[]).map(s => (
                <button key={s} onClick={() => onUpdate({ ...strategy, style: s })}
                  style={{
                    padding: "0.5rem 1rem",
                    background: strategy.style === s ? `${STYLE_META[s].color}18` : "rgba(255,255,255,0.04)",
                    border: `1px solid ${strategy.style === s ? `${STYLE_META[s].color}60` : T.border}`,
                    color: strategy.style === s ? STYLE_META[s].color : T.dim,
                    borderRadius: 7, fontSize: "0.8rem", fontWeight: strategy.style === s ? 600 : 400,
                    cursor: "pointer", transition: "all 0.15s",
                    display: "flex", flexDirection: "column" as const, gap: "0.15rem", alignItems: "flex-start",
                  }}
                >
                  <span>{STYLE_META[s].icon} {STYLE_META[s].label}</span>
                  <span style={{ fontSize: "0.65rem", opacity: 0.6 }}>{STYLE_META[s].desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Parameters */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.2rem" }}>
            {/* Cash reserve */}
            <div>
              <SectionLabel>Cash reserve %</SectionLabel>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {[0, 5, 10, 15, 20, 25].map(n => (
                  <PillToggle key={n} active={strategy.cash_reserve_pct === n}
                    onClick={() => onUpdate({ ...strategy, cash_reserve_pct: n })}>
                    {n}%
                  </PillToggle>
                ))}
              </div>
            </div>

            {/* Max single position */}
            <div>
              <SectionLabel>Max single position %</SectionLabel>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {[5, 8, 10, 15, 20].map(n => (
                  <PillToggle key={n} active={strategy.max_single_weight === n}
                    onClick={() => onUpdate({ ...strategy, max_single_weight: n })}>
                    {n}%
                  </PillToggle>
                ))}
              </div>
            </div>

            {/* Sector tilts */}
            <div>
              <SectionLabel>Sector tilts (overweight)</SectionLabel>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {SECTORS.map(s => (
                  <PillToggle key={s} active={strategy.sector_tilts.includes(s)}
                    onClick={() => onUpdate({
                      ...strategy,
                      sector_tilts: strategy.sector_tilts.includes(s)
                        ? strategy.sector_tilts.filter(x => x !== s)
                        : [...strategy.sector_tilts, s],
                    })}
                    color="#4eca99">
                    {s}
                  </PillToggle>
                ))}
              </div>
            </div>

            {/* Avoid sectors */}
            <div>
              <SectionLabel>Avoid sectors</SectionLabel>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
                {SECTORS.map(s => (
                  <PillToggle key={s} active={strategy.avoid_sectors.includes(s)}
                    onClick={() => onUpdate({
                      ...strategy,
                      avoid_sectors: strategy.avoid_sectors.includes(s)
                        ? strategy.avoid_sectors.filter(x => x !== s)
                        : [...strategy.avoid_sectors, s],
                    })}
                    color="#fc5c65">
                    {s}
                  </PillToggle>
                ))}
              </div>
            </div>
          </div>

          {/* Next */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", paddingTop: "0.5rem" }}>
            <button onClick={onGenerate} style={{
              padding: "0.5rem 1rem", background: "transparent",
              border: `1px solid ${T.border}`, color: T.dim,
              borderRadius: 6, fontSize: "0.8rem", cursor: "pointer",
            }}>
              ↺ Regenerate
            </button>
            <button onClick={onNext} style={{
              padding: "0.55rem 1.4rem", background: T.gold, color: "var(--navy)",
              fontWeight: 700, borderRadius: 7, border: "none", fontSize: "0.85rem", cursor: "pointer",
            }}>
              Select themes →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Themes
// ─────────────────────────────────────────────────────────────────────────────

function Step2Themes({
  themes,
  loading,
  onToggle,
  onBack,
  onNext,
}: {
  themes:   RecommendedTheme[];
  loading:  boolean;
  onToggle: (id: string) => void;
  onBack:   () => void;
  onNext:   () => void;
}) {
  const selected = themes.filter(t => t.selected);
  const totalAlloc = selected.reduce((s, t) => s + t.suggested_allocation, 0);

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "3rem 0" }}>
      <Spinner />
      <p style={{ fontSize: "0.82rem", color: T.dim, margin: 0 }}>Matching investment themes to your strategy…</p>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <p style={{ fontSize: "0.82rem", color: T.dim, margin: 0 }}>
          Select the investment themes you want to build positions around.
          Claude has ranked these by fit with your strategy.
        </p>
        <span style={{ fontSize: "0.75rem", color: selected.length > 0 ? T.gold : T.dim, whiteSpace: "nowrap", marginLeft: "1rem" }}>
          {selected.length} selected · {totalAlloc.toFixed(0)}% allocated
        </span>
      </div>

      {themes.map(theme => (
        <button
          key={theme.id}
          onClick={() => onToggle(theme.id)}
          style={{
            textAlign: "left", cursor: "pointer", padding: "1rem 1.2rem",
            background: theme.selected ? "rgba(200,169,110,0.06)" : T.navy2,
            border: `1px solid ${theme.selected ? "rgba(200,169,110,0.35)" : T.border}`,
            borderRadius: 10, transition: "all 0.2s", width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
            {/* Checkbox */}
            <div style={{
              width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 2,
              background: theme.selected ? T.gold : "transparent",
              border: `1.5px solid ${theme.selected ? T.gold : "rgba(255,255,255,0.2)"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--navy)", fontSize: "0.7rem", fontWeight: 900, transition: "all 0.15s",
            }}>
              {theme.selected && "✓"}
            </div>

            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
                <span style={{ fontWeight: 700, color: T.cream, fontSize: "0.92rem" }}>{theme.name}</span>
                <span style={{
                  fontSize: "0.62rem", padding: "0.1rem 0.45rem", borderRadius: 8,
                  background: theme.momentum === "rising" ? "rgba(78,202,153,0.12)" : "rgba(255,255,255,0.06)",
                  color: theme.momentum === "rising" ? "#4eca99" : T.dim,
                  border: `1px solid ${theme.momentum === "rising" ? "rgba(78,202,153,0.25)" : "rgba(255,255,255,0.08)"}`,
                }}>
                  {theme.momentum ?? "stable"}
                </span>
                <span style={{ fontSize: "0.72rem", color: T.gold, marginLeft: "auto" }}>
                  {theme.conviction}% conviction
                </span>
              </div>
              <p style={{ fontSize: "0.78rem", color: T.dim, margin: "0 0 0.4rem", lineHeight: 1.5 }}>{theme.brief}</p>
              <div style={{ fontSize: "0.72rem", color: "#4eca99", fontStyle: "italic" }}>
                ✦ {theme.fit_reason}
              </div>
            </div>

            {/* Suggested allocation */}
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: theme.selected ? T.gold : T.dim }}>
                {theme.suggested_allocation}%
              </div>
              <div style={{ fontSize: "0.62rem", color: T.dim }}>suggested</div>
            </div>
          </div>
        </button>
      ))}

      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "0.5rem" }}>
        <button onClick={onBack} style={{
          padding: "0.5rem 1rem", background: "transparent",
          border: `1px solid ${T.border}`, color: T.dim,
          borderRadius: 6, fontSize: "0.8rem", cursor: "pointer",
        }}>
          ← Back
        </button>
        <button
          onClick={onNext}
          disabled={selected.length === 0}
          style={{
            padding: "0.55rem 1.4rem", background: T.gold, color: "var(--navy)",
            fontWeight: 700, borderRadius: 7, border: "none", fontSize: "0.85rem",
            cursor: selected.length === 0 ? "not-allowed" : "pointer",
            opacity: selected.length === 0 ? 0.4 : 1,
          }}
        >
          Allocate tickers →
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Allocation
// ─────────────────────────────────────────────────────────────────────────────

function Step3Allocation({
  tickers,
  loading,
  committing,
  totalCapital,
  cashReservePct,
  onUpdate,
  onBack,
  onConfirm,
}: {
  tickers:       TickerAllocation[];
  loading:       boolean;
  committing:    boolean;
  totalCapital:  number;
  cashReservePct: number;
  onUpdate:      (ticker: string, field: keyof TickerAllocation, value: any) => void;
  onBack:        () => void;
  onConfirm:     () => void;
}) {
  const investable    = totalCapital * (1 - cashReservePct / 100);
  const investablePct = 100 - cashReservePct;           // target BUY weight sum
  const included      = tickers.filter(t => t.included);
  const buys          = included.filter(t => t.editSignal === "BUY");
  const watches       = included.filter(t => t.editSignal === "WATCH");
  // weights are portfolio-level % of total capital
  const totalWeight   = buys.reduce((s, t) => s + Number(t.editWeight || 0), 0);
  const cashWeight    = 100 - totalWeight;              // implied cash %
  const weightOk      = Math.abs(totalWeight - investablePct) < 1.0;

  // Group by theme
  const byTheme = tickers.reduce<Record<string, TickerAllocation[]>>((acc, t) => {
    if (!acc[t.theme_name]) acc[t.theme_name] = [];
    acc[t.theme_name].push(t);
    return acc;
  }, {});

  if (loading) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "3rem 0" }}>
      <Spinner />
      <p style={{ fontSize: "0.82rem", color: T.dim, margin: 0 }}>Building ticker allocations across selected themes…</p>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>

      {/* Summary bar */}
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1rem" }}>
          {[
            ["Total capital",    formatCurrency(totalCapital)],
            ["Investable",       `${formatCurrency(investable)} (${investablePct}%)`],
            ["BUY positions",    `${buys.length} tickers`],
            ["WATCH list",       `${watches.length} tickers`],
            ["Deployed",         `${totalWeight.toFixed(1)}%`],
          ].map(([label, val]) => (
            <div key={label}>
              <div style={{ fontSize: "0.62rem", color: T.dim, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div>
              <div style={{ fontSize: "0.95rem", fontWeight: 700, color: T.cream, marginTop: "0.2rem" }}>{val}</div>
            </div>
          ))}
        </div>

        {/* Weight progress bar */}
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 3, transition: "width 0.3s ease",
              width: `${Math.min(100, (totalWeight / investablePct) * 100)}%`,
              background: weightOk
                ? "linear-gradient(90deg, rgba(78,202,153,0.6), rgba(78,202,153,0.9))"
                : totalWeight > investablePct
                  ? "linear-gradient(90deg, rgba(252,92,101,0.6), rgba(252,92,101,0.9))"
                  : "linear-gradient(90deg, rgba(200,169,110,0.6), rgba(200,169,110,0.9))",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.3rem" }}>
            <span style={{ fontSize: "0.62rem", color: T.dim }}>
              {totalWeight.toFixed(1)}% deployed · {cashWeight.toFixed(1)}% cash
              {cashReservePct > 0 && ` (min ${cashReservePct}% reserved)`}
            </span>
            <span style={{ fontSize: "0.62rem", color: weightOk ? "#4eca99" : "#fc5c65", fontWeight: 600 }}>
              {weightOk
                ? "✓ Allocation valid"
                : totalWeight > investablePct
                  ? `⚠ ${(totalWeight - investablePct).toFixed(1)}% over — reduce BUY weights`
                  : `${(investablePct - totalWeight).toFixed(1)}% unallocated`}
            </span>
          </div>
        </div>
      </Card>

      {/* Ticker table by theme */}
      {Object.entries(byTheme).map(([themeName, rows]) => (
        <div key={themeName}>
          <div style={{ fontSize: "0.72rem", color: T.gold, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.5rem" }}>
            {themeName}
          </div>
          <div style={{ background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
            {/* Header */}
            <div style={{
              display: "grid", gridTemplateColumns: "2rem 2fr 1fr 1fr 1fr 1fr 2.5rem",
              padding: "0.45rem 0.85rem", borderBottom: `1px solid ${T.border}`,
              fontSize: "0.6rem", color: T.dim, textTransform: "uppercase", letterSpacing: "0.07em",
            }}>
              <span />
              <span>Ticker</span>
              <span style={{ textAlign: "center" }}>Signal</span>
              <span style={{ textAlign: "right" }}>Weight %</span>
              <span style={{ textAlign: "right" }}>Capital</span>
              <span style={{ textAlign: "right" }}>Price</span>
              <span />
            </div>

            {rows.map((t, idx) => {
              // weight is portfolio-level % of total capital
              const capital = (Number(t.editWeight || 0) / 100) * totalCapital;
              const price   = t.price;
              const qty     = price && price > 0 ? Math.floor(capital / price) : null;
              const isWatch = t.editSignal === "WATCH";

              return (
                <div key={t.ticker} style={{
                  display: "grid", gridTemplateColumns: "2rem 2fr 1fr 1fr 1fr 1fr 2.5rem",
                  padding: "0.6rem 0.85rem", alignItems: "center",
                  borderBottom: idx < rows.length - 1 ? `1px solid rgba(255,255,255,0.04)` : "none",
                  background: !t.included ? "rgba(0,0,0,0.15)" : "transparent",
                  opacity: t.included ? 1 : 0.4,
                  transition: "all 0.15s",
                }}>
                  {/* Include checkbox */}
                  <button onClick={() => onUpdate(t.ticker, "included", !t.included)}
                    style={{
                      width: 18, height: 18, borderRadius: 4,
                      background: t.included ? T.gold : "transparent",
                      border: `1.5px solid ${t.included ? T.gold : "rgba(255,255,255,0.2)"}`,
                      cursor: "pointer", fontSize: "0.65rem", fontWeight: 900,
                      color: "var(--navy)", display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                    {t.included && "✓"}
                  </button>

                  {/* Ticker + name + rationale */}
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                      <span style={{ fontWeight: 700, color: T.cream, fontSize: "0.85rem", fontFamily: "monospace" }}>{t.ticker}</span>
                      <span style={{ fontSize: "0.65rem", color: T.dim }}>{t.name}</span>
                    </div>
                    <div style={{ fontSize: "0.65rem", color: "rgba(232,226,217,0.3)", marginTop: "0.1rem", lineHeight: 1.4 }}>
                      {t.rationale}
                    </div>
                    {qty != null && t.editSignal === "BUY" && (
                      <div style={{ fontSize: "0.62rem", color: "#63b3ed", marginTop: "0.1rem" }}>
                        ≈ {qty} units @ ${price?.toFixed(2)}
                      </div>
                    )}
                  </div>

                  {/* Signal toggle */}
                  <div style={{ display: "flex", justifyContent: "center", gap: "0.3rem" }}>
                    {(["BUY", "WATCH"] as const).map(sig => (
                      <button key={sig} onClick={() => onUpdate(t.ticker, "editSignal", sig)}
                        style={{
                          padding: "0.18rem 0.5rem",
                          background: t.editSignal === sig
                            ? sig === "BUY" ? "rgba(78,202,153,0.15)" : "rgba(240,180,41,0.15)"
                            : "transparent",
                          border: `1px solid ${t.editSignal === sig
                            ? sig === "BUY" ? "rgba(78,202,153,0.4)" : "rgba(240,180,41,0.4)"
                            : "rgba(255,255,255,0.08)"}`,
                          color: t.editSignal === sig
                            ? sig === "BUY" ? "#4eca99" : "#f0b429"
                            : T.dimmest,
                          borderRadius: 4, fontSize: "0.62rem", fontWeight: 700,
                          cursor: "pointer", letterSpacing: "0.04em",
                        }}>
                        {sig}
                      </button>
                    ))}
                  </div>

                  {/* Weight input — portfolio % of total capital, BUY only */}
                  <div style={{ textAlign: "right" }}>
                    {!isWatch ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", justifyContent: "flex-end" }}>
                        <input
                          type="number"
                          value={t.editWeight}
                          onChange={e => onUpdate(t.ticker, "editWeight", e.target.value)}
                          style={{
                            width: 52, textAlign: "right",
                            background: "rgba(255,255,255,0.05)",
                            border: `1px solid rgba(255,255,255,0.1)`,
                            borderRadius: 4, color: T.cream,
                            fontSize: "0.8rem", outline: "none",
                            padding: "0.2rem 0.4rem",
                          }}
                        />
                        <span style={{ fontSize: "0.65rem", color: T.dim }}>%</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: "0.72rem", color: T.dim }}>—</span>
                    )}
                  </div>

                  {/* Capital estimate — weight% × total capital */}
                  <div style={{ textAlign: "right", fontSize: "0.78rem", color: isWatch ? T.dim : T.cream }}>
                    {isWatch ? "watchlist" : formatCurrency(capital)}
                  </div>

                  {/* Price */}
                  <div style={{ textAlign: "right", fontSize: "0.75rem", color: T.dim }}>
                    {price != null ? `$${price.toFixed(2)}` : "—"}
                  </div>

                  {/* Remove */}
                  <button onClick={() => onUpdate(t.ticker, "included", false)}
                    style={{ background: "none", border: "none", color: T.dimmest, cursor: "pointer", fontSize: "0.9rem" }}>
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {/* Actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "0.5rem" }}>
        <button onClick={onBack} style={{
          padding: "0.5rem 1rem", background: "transparent",
          border: `1px solid ${T.border}`, color: T.dim,
          borderRadius: 6, fontSize: "0.8rem", cursor: "pointer",
        }}>
          ← Back
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {!weightOk && buys.length > 0 && (
            <span style={{ fontSize: "0.72rem", color: "#fc5c65" }}>
              Weights must sum to 100%
            </span>
          )}
          <button
            onClick={onConfirm}
            disabled={committing || !weightOk}
            style={{
              padding: "0.6rem 1.6rem", background: T.gold, color: "var(--navy)",
              fontWeight: 700, borderRadius: 7, border: "none", fontSize: "0.88rem",
              cursor: committing || !weightOk ? "not-allowed" : "pointer",
              opacity: committing || !weightOk ? 0.5 : 1,
            }}
          >
            {committing ? "Saving…" : `✓ Confirm — add ${buys.length} holdings + ${watches.length} to watchlist`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function PortfolioBuilderPage() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const portfolioId  = searchParams.get("portfolio_id");

  const initialMode = (searchParams.get("mode") ?? "data") as BuildMode;
  const [step,      setStep]     = useState<Step>(1);
  const [mode,      setMode]     = useState<BuildMode>(initialMode);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [strategy,  setStrategy] = useState<Strategy | null>(null);
  const [error,     setError]    = useState<string | null>(null);
  const [done,      setDone]     = useState(false);

  // ── Per-mode state ────────────────────────────────────────────────────────
  // Each mode tracks its own themes + tickers independently so both can be
  // generated and compared before the user confirms one.

  const [dataThemes,  setDataThemes]  = useState<RecommendedTheme[]>([]);
  const [llmThemes,   setLlmThemes]   = useState<RecommendedTheme[]>([]);
  const [dataTickers, setDataTickers] = useState<TickerAllocation[]>([]);
  const [llmTickers,  setLlmTickers]  = useState<TickerAllocation[]>([]);
  // run IDs for persistence — one per mode
  const [dataRunId,   setDataRunId]   = useState<string | null>(null);
  const [llmRunId,    setLlmRunId]    = useState<string | null>(null);

  const [runId,                  setRunId]                  = useState<string | null>(null);
  const [loadingStrategy,        setLoadingStrategy]        = useState(false);
  const [loadingDataThemes,      setLoadingDataThemes]      = useState(false);
  const [loadingLlmThemes,       setLoadingLlmThemes]       = useState(false);
  const [loadingDataAllocation,  setLoadingDataAllocation]  = useState(false);
  const [loadingLlmAllocation,   setLoadingLlmAllocation]   = useState(false);
  const [committing,             setCommitting]             = useState(false);

  // Active mode's data (aliases for current step render)
  const themes    = mode === "data" ? dataThemes    : llmThemes;
  const setThemes = mode === "data" ? setDataThemes : setLlmThemes;
  const tickers   = mode === "data" ? dataTickers   : llmTickers;
  const setTickers = mode === "data" ? setDataTickers : setLlmTickers;
  const activeRunId  = mode === "data" ? dataRunId  : llmRunId;
  const setActiveRunId = mode === "data" ? setDataRunId : setLlmRunId;

  const loadingThemes     = mode === "data" ? loadingDataThemes     : loadingLlmThemes;
  const loadingAllocation = mode === "data" ? loadingDataAllocation : loadingLlmAllocation;

  // ── Persist helpers ───────────────────────────────────────────────────────
  async function createRun(targetMode: BuildMode, strat: Strategy): Promise<string | null> {
    try {
      const res  = await fetch("/api/portfolio/builder/runs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create_run", portfolio_id: portfolioId, mode: targetMode, strategy: strat }),
      });
      const data = await res.json();
      return data.run?.id ?? null;
    } catch { return null; }
  }

  async function saveThemesToRun(runId: string, themes: RecommendedTheme[]) {
    await fetch("/api/portfolio/builder/runs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_themes", run_id: runId, themes }),
    });
  }

  async function saveTickersToRun(runId: string, tickers: TickerAllocation[]) {
    const rows = tickers.map(t => ({
      ticker:     t.ticker,     name:       t.name,
      theme_name: t.theme_name, signal:     t.editSignal,
      weight:     Number(t.editWeight || 0),
      capital:    t.price ? (Number(t.editWeight || 0) / 100) * ((portfolio?.total_capital ?? 0) * (1 - (strategy?.cash_reserve_pct ?? 0) / 100)) : null,
      price:      t.price,      quantity:   t.price && Number(t.editWeight) ? Math.floor(((Number(t.editWeight) / 100) * ((portfolio?.total_capital ?? 0) * (1 - (strategy?.cash_reserve_pct ?? 0) / 100))) / t.price) : null,
      rationale:  t.rationale,  included:   t.included,
      edited:     t.editSignal !== t.signal || t.editWeight !== String(t.weight),
    }));
    await fetch("/api/portfolio/builder/runs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_tickers", run_id: runId, tickers: rows }),
    });
  }

  // Load portfolio + create a build run on mount
  useEffect(() => {
    if (!portfolioId) return;
    fetch(`/api/portfolio?portfolio_id=${portfolioId}`)
      .then(r => r.json())
      .then(async d => {
        setPortfolio(d.portfolio ?? null);
        // Create the run record immediately so we can attach logs as steps complete
        const runRes = await fetch("/api/portfolio/builder/run", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ portfolio_id: portfolioId, mode: initialMode }),
        });
        if (runRes.ok) {
          const runData = await runRes.json();
          setRunId(runData.run_id);
        }
      });
  }, [portfolioId]);

  // ── Step 1: generate strategy (shared across modes) ───────────────────────
  const generateStrategy = useCallback(async () => {
    setLoadingStrategy(true);
    setError(null);
    try {
      const res  = await fetch("/api/portfolio/builder/strategy", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ portfolio_id: portfolioId, run_id: runId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStrategy(data.strategy);
      // Persist strategy to run
      if (runId) {
        fetch("/api/portfolio/builder/run", {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ run_id: runId, strategy: data.strategy }),
        });
      }
    } catch (e: any) {
      setError(e.message ?? "Failed to generate strategy");
    } finally {
      setLoadingStrategy(false);
    }
  }, [portfolioId, runId]);

  useEffect(() => {
    if (portfolio && !strategy && !loadingStrategy) generateStrategy();
  }, [portfolio]);

  // When strategy is ready, auto-advance to step 2 and generate themes
  // for whichever mode was passed in the URL
  useEffect(() => {
    if (strategy && step === 1) {
      generateThemes(initialMode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strategy]);

  // ── Step 2: generate themes for active mode ───────────────────────────────
  const generateThemes = useCallback(async (targetMode: BuildMode) => {
    if (!strategy) return;
    const setLoading    = targetMode === "data" ? setLoadingDataThemes : setLoadingLlmThemes;
    const setResult     = targetMode === "data" ? setDataThemes        : setLlmThemes;
    const setRunId      = targetMode === "data" ? setDataRunId         : setLlmRunId;
    const endpoint      = targetMode === "data"
      ? "/api/portfolio/builder/themes"
      : "/api/portfolio/builder/themes-llm";

    setLoading(true);
    setError(null);
    try {
      // Create a new draft run to track this session
      const runId = await createRun(targetMode, strategy);
      if (runId) setRunId(runId);

      const res  = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ portfolio_id: portfolioId, strategy }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const themesResult = (data.themes as RecommendedTheme[]).map(t => ({ ...t, selected: true }));
      setResult(themesResult);

      // Persist themes to run
      if (runId) await saveThemesToRun(runId, themesResult);

      setMode(targetMode);
      setStep(2);
    } catch (e: any) {
      setError(e.message ?? "Failed to load themes");
    } finally {
      setLoading(false);
    }
  }, [portfolioId, strategy]);

  // ── Step 3: generate allocation for active mode ───────────────────────────
  const generateAllocation = useCallback(async (targetMode: BuildMode) => {
    const sourceThemes   = targetMode === "data" ? dataThemes : llmThemes;
    const selectedThemes = sourceThemes.filter(t => t.selected);
    if (!selectedThemes.length || !strategy) return;

    const setLoading = targetMode === "data" ? setLoadingDataAllocation : setLoadingLlmAllocation;
    const setResult  = targetMode === "data" ? setDataTickers           : setLlmTickers;
    const runId      = targetMode === "data" ? dataRunId                : llmRunId;
    const endpoint   = targetMode === "data"
      ? "/api/portfolio/builder/allocate"
      : "/api/portfolio/builder/allocate-llm";

    // Save final theme selections before generating tickers
    if (runId) await saveThemesToRun(runId, sourceThemes);

    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(endpoint, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ portfolio_id: portfolioId, strategy, themes: selectedThemes, run_id: runId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      // Convert theme-relative weight → portfolio-level weight
      // ticker.weight = % within theme; theme.suggested_allocation = % of investable
      // portfolio_weight = (ticker.weight / 100) × theme.suggested_allocation
      const themeAllocMap = new Map(
        selectedThemes.map((th: any) => [th.name, th.suggested_allocation ?? 0])
      );

      const tickerResult = (data.tickers as TickerAllocation[]).map(t => {
        const themeAlloc    = themeAllocMap.get(t.theme_name) ?? 0;
        const portfolioWeight = t.signal === "BUY"
          ? parseFloat(((t.weight / 100) * themeAlloc).toFixed(1))
          : 0;
        return {
          ...t,
          weight:     portfolioWeight,   // store as portfolio-level %
          editWeight: t.signal === "BUY" ? String(portfolioWeight) : "0",
          editSignal: t.signal,
          included:   true,
        };
      });
      setResult(tickerResult);

      // Persist tickers to run
      if (runId) await saveTickersToRun(runId, tickerResult);

      setMode(targetMode);
      setStep(3);
    } catch (e: any) {
      setError(e.message ?? "Failed to allocate tickers");
    } finally {
      setLoading(false);
    }
  }, [portfolioId, strategy, dataThemes, llmThemes, dataRunId, llmRunId]);

  // ── Confirm: save active mode's tickers + mark run confirmed ────────────
  const confirm = useCallback(async () => {
    setCommitting(true);
    setError(null);
    try {
      // Persist final edited state before confirming
      if (activeRunId) await saveTickersToRun(activeRunId, tickers);

      const res  = await fetch("/api/portfolio/builder/confirm", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          portfolio_id: portfolioId,
          run_id:       activeRunId,   // passed so confirm route can mark it
          tickers:      tickers.filter(t => t.included).map(t => ({
            ticker:     t.ticker,
            name:       t.name,
            signal:     t.editSignal,
            weight:     Number(t.editWeight || 0),
            price:      t.price,
            theme_name: t.theme_name,
            rationale:  t.rationale,
          })),
          strategy,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Mark the other mode's run as abandoned if it exists and wasn't confirmed
      const otherRunId = mode === "data" ? llmRunId : dataRunId;
      if (otherRunId) {
        await fetch("/api/portfolio/builder/runs", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ run_id: otherRunId, status: "abandoned" }),
        });
      }

      setDone(true);
    } catch (e: any) {
      setError(e.message ?? "Failed to save");
    } finally {
      setCommitting(false);
    }
  }, [portfolioId, tickers, strategy, activeRunId, mode, dataRunId, llmRunId]);

  function updateTicker(ticker: string, field: keyof TickerAllocation, value: any) {
    const setter = mode === "data" ? setDataTickers : setLlmTickers;
    setter(prev => prev.map(t => t.ticker === ticker ? { ...t, [field]: value } : t));
  }

  // ── Done screen ───────────────────────────────────────────────────────────
  if (done) {
    const activeTickers = mode === "data" ? dataTickers : llmTickers;
    const buys    = activeTickers.filter(t => t.included && t.editSignal === "BUY");
    const watches = activeTickers.filter(t => t.included && t.editSignal === "WATCH");
    return (
      <div style={{ maxWidth: 540, margin: "4rem auto", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "1.2rem" }}>
        <div style={{ fontSize: "3rem" }}>✓</div>
        <h2 style={{ color: T.cream, fontFamily: "serif", fontSize: "1.6rem", margin: 0 }}>Portfolio built</h2>
        <p style={{ color: T.dim, fontSize: "0.88rem", margin: 0 }}>
          {buys.length} holdings added · {watches.length} tickers added to watchlist
        </p>
        <button
          onClick={() => router.push(`/dashboard/portfolio?portfolio_id=${portfolioId}`)}
          style={{ marginTop: "0.5rem", padding: "0.6rem 1.5rem", background: T.gold, color: "var(--navy)", fontWeight: 700, borderRadius: 7, border: "none", fontSize: "0.88rem", cursor: "pointer" }}
        >
          View portfolio →
        </button>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>

      {/* Header */}
      <div style={{ marginBottom: "1.8rem" }}>
        <button onClick={() => router.back()}
          style={{ background: "none", border: "none", color: T.dim, cursor: "pointer", fontSize: "0.8rem", marginBottom: "0.8rem", padding: 0 }}>
          ← Back to portfolio
        </button>
        <h1 style={{ color: T.cream, fontFamily: "serif", fontSize: "1.8rem", margin: "0 0 0.25rem" }}>
          Portfolio Builder
        </h1>
        <p style={{ color: T.dim, fontSize: "0.82rem", margin: 0 }}>
          AI-guided, step-by-step portfolio construction based on your preferences and current market conditions.
        </p>
      </div>

      <StepIndicator current={step} total={3} />

      {error && (
        <div style={{ background: "rgba(252,92,101,0.08)", border: "1px solid rgba(252,92,101,0.25)", borderRadius: 8, padding: "0.65rem 1rem", marginBottom: "1.2rem", fontSize: "0.8rem", color: "#fc5c65" }}>
          {error}
        </div>
      )}

      {step === 1 && (
        <Step1Strategy
          portfolio={portfolio}
          strategy={strategy}
          loading={loadingStrategy}
          onGenerate={generateStrategy}
          onUpdate={setStrategy}
          onNext={() => {
            // Step 1 "Next" shows mode toggle then proceeds with selected mode
            setStep(2);
            // Auto-generate for data mode first (default)
            if (dataThemes.length === 0 && !loadingDataThemes) generateThemes("data");
          }}
        />
      )}

      {step === 2 && (
        <>
          <ModeToggle
            mode={mode}
            onChange={m => {
              setMode(m);
              // Auto-generate for newly selected mode if not yet loaded
              if (m === "data"  && dataThemes.length === 0 && !loadingDataThemes)  generateThemes("data");
              if (m === "llm"   && llmThemes.length  === 0 && !loadingLlmThemes)   generateThemes("llm");
            }}
            dataReady={dataThemes.length > 0}
            llmReady={llmThemes.length > 0}
          />
          <Step2Themes
            themes={themes}
            loading={loadingThemes}
            onToggle={id => setThemes(prev => prev.map(t => t.id === id ? { ...t, selected: !t.selected } : t))}
            onBack={() => setStep(1)}
            onNext={() => generateAllocation(mode)}
          />
          {/* Run both button */}
          {(dataThemes.length > 0 || llmThemes.length > 0) && (
            <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "center" }}>
              <button
                onClick={() => {
                  if (dataThemes.length === 0 && !loadingDataThemes) generateThemes("data");
                  if (llmThemes.length  === 0 && !loadingLlmThemes)  generateThemes("llm");
                }}
                disabled={loadingDataThemes || loadingLlmThemes}
                style={{
                  fontSize: "0.75rem", color: "rgba(232,226,217,0.35)",
                  background: "none", border: "1px solid rgba(255,255,255,0.07)",
                  borderRadius: 6, padding: "0.35rem 0.85rem", cursor: "pointer",
                }}
              >
                {loadingDataThemes || loadingLlmThemes ? "Loading other mode…" : "Load both modes for comparison"}
              </button>
            </div>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <ModeToggle
            mode={mode}
            onChange={m => {
              setMode(m);
              // Auto-generate allocation for newly selected mode if not yet loaded
              const sourceThemes = m === "data" ? dataThemes : llmThemes;
              const targetTickers = m === "data" ? dataTickers : llmTickers;
              const loading = m === "data" ? loadingDataAllocation : loadingLlmAllocation;
              if (sourceThemes.length > 0 && targetTickers.length === 0 && !loading) {
                generateAllocation(m);
              }
            }}
            dataReady={dataTickers.length > 0}
            llmReady={llmTickers.length > 0}
          />

          {/* Side-by-side comparison banner when both are ready */}
          {dataTickers.length > 0 && llmTickers.length > 0 && (
            <div style={{
              background: "rgba(99,179,237,0.05)", border: "1px solid rgba(99,179,237,0.2)",
              borderRadius: 8, padding: "0.6rem 1rem", marginBottom: "1rem",
              display: "flex", alignItems: "center", gap: "1rem",
            }}>
              <span style={{ fontSize: "0.72rem", color: "rgba(99,179,237,0.8)" }}>
                ◈ Both modes ready — switch tabs above to compare, then confirm the one you prefer.
              </span>
              <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", fontSize: "0.7rem" }}>
                <span style={{ color: "rgba(232,226,217,0.4)" }}>
                  Data: {dataTickers.filter(t => t.included && t.editSignal === "BUY").length} BUY
                </span>
                <span style={{ color: "rgba(232,226,217,0.2)" }}>·</span>
                <span style={{ color: "rgba(232,226,217,0.4)" }}>
                  LLM: {llmTickers.filter(t => t.included && t.editSignal === "BUY").length} BUY
                </span>
              </div>
            </div>
          )}

          <Step3Allocation
            tickers={tickers}
            loading={loadingAllocation}
            committing={committing}
            totalCapital={portfolio?.total_capital ?? 0}
            cashReservePct={strategy?.cash_reserve_pct ?? portfolio?.cash_pct ?? 0}
            onUpdate={updateTicker}
            onBack={() => setStep(2)}
            onConfirm={confirm}
          />
        </>
      )}
    </div>
  );
}
