// src/app/dashboard/portfolio/builder/page.tsx
"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RiskAppetite, InvestmentHorizon } from "@/types/portfolio-preferences";
import { RecommendationScreen } from "@/components/dashboard/RecommendationScreen";
import { PromptPreviewModal }   from "@/components/dashboard/PromptPreviewModal";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type StyleFocus = "growth" | "balanced" | "defensive" | "income" | "speculative";

interface Strategy {
  style:            StyleFocus;
  cash_reserve_pct: number;
  sector_tilts:     string[];
  avoid_sectors:    string[];
  max_single_weight: number;
  rationale:        string;
  summary:          string;
  macro_context?:   string | null;
}

interface RecommendedTheme {
  id:                   string;
  name:                 string;
  brief:                string;
  conviction:           number;
  momentum:             string;
  fit_reason:           string;
  suggested_allocation: number;
  selected:             boolean;
  is_llm_generated?:    boolean;
}

interface TickerAllocation {
  ticker:            string;
  name:              string;
  signal:            "BUY" | "WATCH";
  weight:            number;
  price:             number | null;
  rationale:         string;
  theme_id:          string;
  theme_name:        string;
  fundamental_score: number | null;
  technical_score:   number | null;
  db_signal:         string | null;
  db_rationale:      string | null;
  editWeight:  string;
  editSignal:  "BUY" | "WATCH";
  included:    boolean;
}

// PATCH 2: Step type includes 4
type Step = 1 | 2 | 3 | 4;
type BuildMode    = "data" | "llm";
type LlmProvider  = "claude" | "openai";

const LLM_PROVIDER_META: Record<LlmProvider, {
  label: string; icon: string; color: string;
  models: { id: string; label: string; desc: string }[];
}> = {
  claude: {
    label: "Claude",
    icon:  "◆",
    color: "#c8a96e",
    models: [
      { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4",  desc: "Balanced — fast + high quality" },
      { id: "claude-opus-4-5",          label: "Claude Opus 4.5",  desc: "Most capable Claude model" },
      { id: "claude-haiku-4-5-20251001",label: "Claude Haiku 4.5", desc: "Fastest, lowest cost" },
    ],
  },
  openai: {
    label: "OpenAI",
    icon:  "⬡",
    color: "#74aa9c",
    models: [
      { id: "gpt-4o",       label: "GPT-4o",       desc: "Flagship — multimodal, fast" },
      { id: "gpt-4o-mini",  label: "GPT-4o mini",  desc: "Fast and cost-efficient" },
      { id: "o1-mini",      label: "o1-mini",       desc: "Reasoning-optimised" },
    ],
  },
};

interface MacroScore {
  aspect:     string;
  score:      number;
  direction:  string;
  commentary: string;
}

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

function formatCurrency(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function HeatGauge({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const pct   = ((score + 10) / 20) * 100;
  const color = score >= 3 ? "#4eca99" : score >= 0 ? "#f0b429" : score >= -3 ? "#f0b429" : "#fc5c65";
  const h = size === "sm" ? 4 : 6;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flex: 1 }}>
      <div style={{ flex: 1, height: h, background: "rgba(255,255,255,0.06)", borderRadius: h, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(255,255,255,0.12)" }} />
        <div style={{ position: "absolute", height: "100%", left: score >= 0 ? "50%" : `${pct}%`, width: `${Math.abs(score) / 20 * 100}%`, background: color, borderRadius: h, transition: "width 0.4s ease" }} />
      </div>
      <span style={{ fontSize: "0.7rem", fontWeight: 700, color, minWidth: "2rem", textAlign: "right" }}>
        {score > 0 ? "+" : ""}{score}
      </span>
    </div>
  );
}

function MacroPanel({ macro, strategy, mode }: { macro: MacroScore[]; strategy: Strategy | null; mode: BuildMode }) {
  if (!macro.length) return null;
  const overallScore = macro.reduce((s, m) => s + m.score, 0) / macro.length;
  const overallColor = overallScore >= 2 ? "#4eca99" : overallScore >= 0 ? "#f0b429" : overallScore >= -2 ? "#f0b429" : "#fc5c65";
  const overallLabel = overallScore >= 3 ? "Bullish" : overallScore >= 1 ? "Mildly bullish" : overallScore >= -1 ? "Neutral" : overallScore >= -3 ? "Mildly bearish" : "Bearish";
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.9rem" }}>
        <div>
          <SectionLabel>Macro environment</SectionLabel>
          {mode === "data" && <div style={{ fontSize: "0.68rem", color: T.dim, marginTop: "0.1rem" }}>These indicators drove the strategy recommendation</div>}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "0.65rem", color: T.dim, textTransform: "uppercase", letterSpacing: "0.07em" }}>Overall</div>
          <div style={{ fontSize: "1.1rem", fontWeight: 700, color: overallColor }}>{overallLabel}</div>
          <HeatGauge score={parseFloat(overallScore.toFixed(1))} size="sm" />
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {macro.map(m => (
          <div key={m.aspect} style={{ display: "grid", gridTemplateColumns: "7rem 1fr", gap: "0.75rem", alignItems: "center" }}>
            <div>
              <div style={{ fontSize: "0.68rem", fontWeight: 600, color: "rgba(232,226,217,0.7)", textTransform: "capitalize" }}>{m.aspect}</div>
              <div style={{ fontSize: "0.6rem", color: T.dim, textTransform: "capitalize" }}>{m.direction}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
              <HeatGauge score={m.score} />
              <div style={{ fontSize: "0.62rem", color: "rgba(232,226,217,0.3)", lineHeight: 1.4 }}>{m.commentary}</div>
            </div>
          </div>
        ))}
      </div>
      {strategy && mode === "data" && (
        <div style={{ marginTop: "0.9rem", padding: "0.65rem 0.85rem", background: "rgba(200,169,110,0.05)", border: "1px solid rgba(200,169,110,0.15)", borderRadius: 7, fontSize: "0.72rem", color: T.dim, lineHeight: 1.5 }}>
          <span style={{ color: T.gold, fontWeight: 600 }}>↳ Impact on strategy: </span>{strategy.rationale}
        </div>
      )}
    </Card>
  );
}

function SignalStrengthBar({ label, value, color }: { label: string; value: number | null; color: string }) {
  if (value == null) return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <span style={{ fontSize: "0.6rem", color: T.dim, width: "1.2rem" }}>{label}</span>
      <span style={{ fontSize: "0.65rem", color: "rgba(232,226,217,0.2)" }}>—</span>
    </div>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
      <span style={{ fontSize: "0.6rem", color: T.dim, width: "1.2rem", flexShrink: 0 }}>{label}</span>
      <div style={{ width: 48, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden", flexShrink: 0 }}>
        <div style={{ height: "100%", width: `${value}%`, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: "0.65rem", color, minWidth: "1.8rem" }}>{value}</span>
    </div>
  );
}

function LlmProviderToggle({ provider, modelId, onChange }: { provider: LlmProvider; modelId: string; onChange: (provider: LlmProvider, modelId: string) => void }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 9, padding: "0.85rem 1rem", marginBottom: "1rem", display: "flex", flexDirection: "column" as const, gap: "0.75rem" }}>
      <div style={{ fontSize: "0.62rem", color: "rgba(232,226,217,0.3)", textTransform: "uppercase", letterSpacing: "0.08em" }}>LLM Provider</div>
      <div style={{ display: "flex", gap: "0.5rem" }}>
        {(Object.keys(LLM_PROVIDER_META) as LlmProvider[]).map(p => {
          const meta = LLM_PROVIDER_META[p]; const active = provider === p;
          return (
            <button key={p} onClick={() => onChange(p, meta.models[0].id)}
              style={{ padding: "0.4rem 1rem", background: active ? `${meta.color}15` : "rgba(255,255,255,0.04)", border: `1.5px solid ${active ? `${meta.color}50` : "rgba(255,255,255,0.08)"}`, color: active ? meta.color : "rgba(232,226,217,0.4)", borderRadius: 7, fontSize: "0.82rem", fontWeight: active ? 700 : 400, cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <span>{meta.icon}</span><span>{meta.label}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" as const }}>
        {LLM_PROVIDER_META[provider].models.map(m => {
          const active = modelId === m.id; const color = LLM_PROVIDER_META[provider].color;
          return (
            <button key={m.id} onClick={() => onChange(provider, m.id)}
              style={{ padding: "0.3rem 0.8rem", background: active ? `${color}12` : "transparent", border: `1px solid ${active ? `${color}40` : "rgba(255,255,255,0.07)"}`, color: active ? color : "rgba(232,226,217,0.35)", borderRadius: 5, fontSize: "0.75rem", fontWeight: active ? 600 : 400, cursor: "pointer", transition: "all 0.15s", display: "flex", flexDirection: "column" as const, alignItems: "flex-start", gap: "0.1rem" }}>
              <span>{m.label}</span>
              <span style={{ fontSize: "0.6rem", opacity: 0.6 }}>{m.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// PATCH 3: Add "Recommendations" to step labels
function StepIndicator({ current, total }: { current: Step; total: number }) {
  const labels = ["Strategy", "Themes", "Allocation", "Recommendations"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: "2rem" }}>
      {labels.map((label, i) => {
        const step = (i + 1) as Step;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} style={{ display: "flex", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.3rem" }}>
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: done ? T.gold : active ? "rgba(200,169,110,0.15)" : "rgba(255,255,255,0.04)", border: `1.5px solid ${done ? T.gold : active ? "rgba(200,169,110,0.6)" : T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.8rem", fontWeight: 700, color: done ? "var(--navy)" : active ? T.gold : T.dim, transition: "all 0.3s" }}>
                {done ? "✓" : step}
              </div>
              <span style={{ fontSize: "0.62rem", color: active ? T.gold : T.dim, fontWeight: active ? 600 : 400, letterSpacing: "0.05em", textTransform: "uppercase" }}>{label}</span>
            </div>
            {i < labels.length - 1 && (
              <div style={{ width: 60, height: 1, background: done ? "rgba(200,169,110,0.4)" : T.border, margin: "0 0.4rem 1.4rem" }} />
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
      <div style={{ width: 16, height: 16, border: "2px solid rgba(200,169,110,0.2)", borderTopColor: T.gold, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PillToggle({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  const c = color ?? T.gold;
  return (
    <button onClick={onClick} style={{ padding: "0.3rem 0.8rem", background: active ? `${c}20` : "rgba(255,255,255,0.04)", border: `1px solid ${active ? `${c}60` : T.border}`, color: active ? c : T.dim, borderRadius: 5, fontSize: "0.75rem", fontWeight: active ? 600 : 400, cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap" as const }}>
      {children}
    </button>
  );
}

function ModelBadge({ mode, provider, modelId }: { mode: BuildMode; provider?: LlmProvider; modelId?: string }) {
  const isLlm = mode === "llm";
  const meta  = provider ? LLM_PROVIDER_META[provider] : null;
  const model = meta?.models.find(m => m.id === modelId);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", padding: "0.2rem 0.55rem", borderRadius: 5, background: isLlm ? `${meta?.color ?? "var(--gold)"}18` : "rgba(99,179,237,0.1)", border: `1px solid ${isLlm ? `${meta?.color ?? "var(--gold)"}50` : "rgba(99,179,237,0.25)"}`, color: isLlm ? (meta?.color ?? "var(--gold)") : "#63b3ed", flexShrink: 0 }}>
      {isLlm ? (meta?.icon ?? "✦") : "◈"}{" "}
      {isLlm ? `${meta?.label ?? "LLM"}${model ? ` · ${model.label}` : ""}` : "Data"}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: "0.62rem", color: "rgba(200,169,110,0.5)", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.6rem" }}>{children}</div>;
}

function Card({ children, highlight, style }: { children: React.ReactNode; highlight?: boolean; style?: React.CSSProperties }) {
  return (
    <div style={{ background: highlight ? "rgba(200,169,110,0.04)" : T.navy2, border: `1px solid ${highlight ? "rgba(200,169,110,0.25)" : T.border}`, borderRadius: 10, padding: "1.1rem 1.3rem", ...style }}>
      {children}
    </div>
  );
}

function ModeToggle({ mode, onChange, dataReady, llmReady }: { mode: BuildMode; onChange: (m: BuildMode) => void; dataReady: boolean; llmReady: boolean }) {
  const modes: { id: BuildMode; label: string; icon: string; desc: string; detail: string[] }[] = [
    { id: "data", icon: "◈", label: "Data-driven", desc: "Claude selects from your existing mapped data", detail: ["Themes: Claude ranks themes already in your DB", "Tickers: Claude picks from pre-mapped theme_tickers", "Constrained to your curated universe"] },
    { id: "llm",  icon: "✦", label: "LLM-powered", desc: "Claude reasons freely from the full asset universe", detail: ["Themes: Claude defines themes independently", "Tickers: Claude picks from all 200+ active assets", "No pre-mapping constraint — pure model judgment"] },
  ];
  return (
    <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1.5rem" }}>
      {modes.map(m => (
        <button key={m.id} onClick={() => onChange(m.id)} style={{ flex: 1, textAlign: "left", padding: "0.85rem 1.1rem", background: mode === m.id ? "rgba(200,169,110,0.08)" : "rgba(255,255,255,0.03)", border: `1.5px solid ${mode === m.id ? "rgba(200,169,110,0.45)" : T.border}`, borderRadius: 9, cursor: "pointer", transition: "all 0.2s", display: "flex", gap: "0.85rem", alignItems: "flex-start" }}>
          <div style={{ fontSize: "1.2rem", color: mode === m.id ? T.gold : T.dim, marginTop: "0.05rem", flexShrink: 0, transition: "color 0.2s" }}>{m.icon}</div>
          <div>
            <div style={{ fontSize: "0.88rem", fontWeight: 700, color: mode === m.id ? T.gold : "rgba(232,226,217,0.6)", marginBottom: "0.2rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              {m.label}
              {m.id === "data" && dataReady && <span style={{ fontSize: "0.6rem", background: "rgba(78,202,153,0.15)", color: "#4eca99", border: "1px solid rgba(78,202,153,0.3)", borderRadius: 4, padding: "0.05rem 0.4rem" }}>ready</span>}
              {m.id === "llm"  && llmReady  && <span style={{ fontSize: "0.6rem", background: "rgba(78,202,153,0.15)", color: "#4eca99", border: "1px solid rgba(78,202,153,0.3)", borderRadius: 4, padding: "0.05rem 0.4rem" }}>ready</span>}
            </div>
            <div style={{ fontSize: "0.72rem", color: T.dim, lineHeight: 1.5, marginBottom: "0.4rem" }}>{m.desc}</div>
            <div style={{ display: "flex", flexDirection: "column" as const, gap: "0.15rem" }}>
              {m.detail.map(d => <div key={d} style={{ fontSize: "0.65rem", color: mode === m.id ? "rgba(200,169,110,0.6)" : "rgba(232,226,217,0.2)", display: "flex", gap: "0.35rem" }}><span style={{ opacity: 0.5 }}>–</span><span>{d}</span></div>)}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function Step1Strategy({ portfolio, strategy, loading, mode, macro, provider, modelId, onGenerate, onUpdate, onNext }: { portfolio: any; strategy: Strategy | null; loading: boolean; mode: BuildMode; macro: MacroScore[]; provider?: LlmProvider; modelId?: string; onGenerate: () => void; onUpdate: (s: Strategy) => void; onNext: () => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
          <SectionLabel>Portfolio context</SectionLabel>
          <ModelBadge mode={mode} provider={mode === "llm" ? provider : undefined} modelId={mode === "llm" ? modelId : undefined} />
        </div>
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          {[["Risk", portfolio?.risk_appetite], ["Horizon", portfolio?.investment_horizon], ["Benchmark", portfolio?.benchmark], ["Capital", portfolio?.total_capital ? formatCurrency(portfolio.total_capital) : "—"], ["Cash floor", `${portfolio?.cash_pct ?? 0}%`], ["Target", `${portfolio?.target_holdings ?? "—"} holdings`]].map(([k, v]) => (
            <div key={k}><div style={{ fontSize: "0.62rem", color: T.dim, textTransform: "uppercase", letterSpacing: "0.07em" }}>{k}</div><div style={{ fontSize: "0.9rem", fontWeight: 600, color: T.cream, marginTop: "0.15rem", textTransform: "capitalize" }}>{v}</div></div>
          ))}
        </div>
      </Card>

      {!strategy && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "2rem 0" }}>
          {loading ? (<><Spinner /><p style={{ fontSize: "0.82rem", color: T.dim, margin: 0 }}>Analysing your preferences and current market conditions…</p></>) : (
            <><p style={{ fontSize: "0.85rem", color: T.dim, margin: 0, textAlign: "center", maxWidth: 420 }}>Claude will analyse your preferences and the current macro environment to recommend an investment strategy profile for this portfolio.</p>
            <button onClick={onGenerate} style={{ padding: "0.65rem 1.5rem", background: "rgba(200,169,110,0.15)", border: "1px solid rgba(200,169,110,0.4)", color: T.gold, borderRadius: 8, fontSize: "0.88rem", fontWeight: 600, cursor: "pointer" }}>✦ Generate strategy</button></>
          )}
        </div>
      )}

      {strategy && (
        <>
          <Card highlight>
            <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem", marginBottom: "0.8rem" }}>
              <div style={{ fontSize: "1.8rem", width: 48, height: 48, borderRadius: 10, background: `${STYLE_META[strategy.style].color}18`, border: `1px solid ${STYLE_META[strategy.style].color}40`, display: "flex", alignItems: "center", justifyContent: "center", color: STYLE_META[strategy.style].color, flexShrink: 0 }}>{STYLE_META[strategy.style].icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.15rem" }}>
                  <div style={{ fontSize: "1.1rem", fontWeight: 700, color: T.cream }}>{strategy.summary}</div>
                  <ModelBadge mode={mode} provider={mode === "llm" ? provider : undefined} modelId={mode === "llm" ? modelId : undefined} />
                </div>
                <div style={{ fontSize: "0.78rem", color: T.dim, lineHeight: 1.6, marginBottom: strategy.macro_context ? "0.5rem" : 0 }}>{strategy.rationale}</div>
                {strategy.macro_context && <div style={{ fontSize: "0.72rem", color: "rgba(232,226,217,0.4)", lineHeight: 1.6, fontStyle: "italic", paddingTop: "0.4rem", borderTop: "1px solid rgba(255,255,255,0.06)" }}><span style={{ color: "rgba(99,179,237,0.7)", fontStyle: "normal", fontWeight: 600 }}>Macro context: </span>{strategy.macro_context}</div>}
              </div>
            </div>
          </Card>

          {mode === "data" && macro.length > 0 && <MacroPanel macro={macro} strategy={strategy} mode={mode} />}
          {mode === "llm" && strategy?.macro_context && (
            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.6rem" }}>
                <SectionLabel>Macro &amp; geopolitical context</SectionLabel>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <span style={{ fontSize: "0.62rem", color: "rgba(78,202,153,0.7)", background: "rgba(78,202,153,0.08)", border: "1px solid rgba(78,202,153,0.2)", borderRadius: 4, padding: "0.15rem 0.5rem" }}>✦ Live events injected</span>
                  <span style={{ fontSize: "0.62rem", color: "rgba(99,179,237,0.6)", background: "rgba(99,179,237,0.08)", border: "1px solid rgba(99,179,237,0.2)", borderRadius: 4, padding: "0.15rem 0.5rem" }}>Model: {provider ?? "claude"} reasoning</span>
                </div>
              </div>
              <p style={{ fontSize: "0.78rem", color: T.dim, lineHeight: 1.7, margin: 0 }}>{strategy.macro_context}</p>
            </Card>
          )}

          <div>
            <SectionLabel>Strategy style</SectionLabel>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {(Object.keys(STYLE_META) as StyleFocus[]).map(s => (
                <button key={s} onClick={() => onUpdate({ ...strategy, style: s })} style={{ padding: "0.5rem 1rem", background: strategy.style === s ? `${STYLE_META[s].color}18` : "rgba(255,255,255,0.04)", border: `1px solid ${strategy.style === s ? `${STYLE_META[s].color}60` : T.border}`, color: strategy.style === s ? STYLE_META[s].color : T.dim, borderRadius: 7, fontSize: "0.8rem", fontWeight: strategy.style === s ? 600 : 400, cursor: "pointer", transition: "all 0.15s", display: "flex", flexDirection: "column" as const, gap: "0.15rem", alignItems: "flex-start" }}>
                  <span>{STYLE_META[s].icon} {STYLE_META[s].label}</span>
                  <span style={{ fontSize: "0.65rem", opacity: 0.6 }}>{STYLE_META[s].desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.2rem" }}>
            <div><SectionLabel>Cash reserve %</SectionLabel><div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>{[0,5,10,15,20,25].map(n => <PillToggle key={n} active={strategy.cash_reserve_pct === n} onClick={() => onUpdate({ ...strategy, cash_reserve_pct: n })}>{n}%</PillToggle>)}</div></div>
            <div><SectionLabel>Max single position %</SectionLabel><div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>{[5,8,10,15,20].map(n => <PillToggle key={n} active={strategy.max_single_weight === n} onClick={() => onUpdate({ ...strategy, max_single_weight: n })}>{n}%</PillToggle>)}</div></div>
            <div><SectionLabel>Sector tilts (overweight)</SectionLabel><div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>{SECTORS.map(s => <PillToggle key={s} active={strategy.sector_tilts.includes(s)} onClick={() => onUpdate({ ...strategy, sector_tilts: strategy.sector_tilts.includes(s) ? strategy.sector_tilts.filter(x => x !== s) : [...strategy.sector_tilts, s] })} color="#4eca99">{s}</PillToggle>)}</div></div>
            <div><SectionLabel>Avoid sectors</SectionLabel><div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>{SECTORS.map(s => <PillToggle key={s} active={strategy.avoid_sectors.includes(s)} onClick={() => onUpdate({ ...strategy, avoid_sectors: strategy.avoid_sectors.includes(s) ? strategy.avoid_sectors.filter(x => x !== s) : [...strategy.avoid_sectors, s] })} color="#fc5c65">{s}</PillToggle>)}</div></div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", paddingTop: "0.5rem" }}>
            <button onClick={onGenerate} style={{ padding: "0.5rem 1rem", background: "transparent", border: `1px solid ${T.border}`, color: T.dim, borderRadius: 6, fontSize: "0.8rem", cursor: "pointer" }}>↺ Regenerate</button>
            <button onClick={onNext} style={{ padding: "0.55rem 1.4rem", background: T.gold, color: "var(--navy)", fontWeight: 700, borderRadius: 7, border: "none", fontSize: "0.85rem", cursor: "pointer" }}>Select themes →</button>
          </div>
        </>
      )}
    </div>
  );
}

function Step2Themes({ themes, loading, mode, provider, modelId, onToggle, onBack, onNext }: { themes: RecommendedTheme[]; loading: boolean; mode: BuildMode; provider?: LlmProvider; modelId?: string; onToggle: (id: string) => void; onBack: () => void; onNext: () => void }) {
  const selected = themes.filter(t => t.selected);
  const totalAlloc = selected.reduce((s, t) => s + t.suggested_allocation, 0);
  if (loading) return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "3rem 0" }}><Spinner /><p style={{ fontSize: "0.82rem", color: T.dim, margin: 0 }}>{mode === "llm" ? "Claude is defining themes for your strategy…" : "Matching themes from your database to your strategy…"}</p></div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <p style={{ fontSize: "0.82rem", color: T.dim, margin: 0 }}>{mode === "llm" ? "Claude defined these themes independently — select the ones that fit your strategy." : "Claude ranked these themes from your database — select the ones you want to build around."}</p>
          <ModelBadge mode={mode} provider={mode === "llm" ? provider : undefined} modelId={mode === "llm" ? modelId : undefined} />
        </div>
        <span style={{ fontSize: "0.75rem", color: selected.length > 0 ? T.gold : T.dim, whiteSpace: "nowrap", marginLeft: "1rem" }}>{selected.length} selected · {totalAlloc.toFixed(0)}% allocated</span>
      </div>
      {themes.map(theme => (
        <button key={theme.id} onClick={() => onToggle(theme.id)} style={{ textAlign: "left", cursor: "pointer", padding: "1rem 1.2rem", background: theme.selected ? "rgba(200,169,110,0.06)" : T.navy2, border: `1px solid ${theme.selected ? "rgba(200,169,110,0.35)" : T.border}`, borderRadius: 10, transition: "all 0.2s", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
            <div style={{ width: 20, height: 20, borderRadius: 5, flexShrink: 0, marginTop: 2, background: theme.selected ? T.gold : "transparent", border: `1.5px solid ${theme.selected ? T.gold : "rgba(255,255,255,0.2)"}`, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--navy)", fontSize: "0.7rem", fontWeight: 900, transition: "all 0.15s" }}>{theme.selected && "✓"}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.3rem" }}>
                <span style={{ fontWeight: 700, color: T.cream, fontSize: "0.92rem" }}>{theme.name}</span>
                <span style={{ fontSize: "0.62rem", padding: "0.1rem 0.45rem", borderRadius: 8, background: theme.momentum === "rising" ? "rgba(78,202,153,0.12)" : "rgba(255,255,255,0.06)", color: theme.momentum === "rising" ? "#4eca99" : T.dim, border: `1px solid ${theme.momentum === "rising" ? "rgba(78,202,153,0.25)" : "rgba(255,255,255,0.08)"}` }}>{theme.momentum ?? "stable"}</span>
              </div>
              <p style={{ fontSize: "0.78rem", color: T.dim, margin: "0 0 0.4rem", lineHeight: 1.5 }}>{theme.brief}</p>
              {theme.conviction != null && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                  <span style={{ fontSize: "0.6rem", color: T.dim, width: "4.5rem", flexShrink: 0 }}>{mode === "data" ? "DB conviction" : "LLM estimate"}</span>
                  <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}><div style={{ height: "100%", width: `${theme.conviction}%`, background: "rgba(200,169,110,0.7)", borderRadius: 2, transition: "width 0.4s" }} /></div>
                  <span style={{ fontSize: "0.68rem", color: T.gold, fontWeight: 600, minWidth: "2.5rem" }}>{theme.conviction}%</span>
                </div>
              )}
              <div style={{ fontSize: "0.72rem", color: "#4eca99", fontStyle: "italic" }}>✦ {theme.fit_reason}</div>
              {theme.is_llm_generated && mode === "llm" && <div style={{ fontSize: "0.6rem", color: "rgba(200,169,110,0.4)", marginTop: "0.2rem" }}>Claude-defined theme (not in your database)</div>}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: "1.1rem", fontWeight: 700, color: theme.selected ? T.gold : T.dim }}>{theme.suggested_allocation}%</div>
              <div style={{ fontSize: "0.62rem", color: T.dim }}>suggested</div>
            </div>
          </div>
        </button>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: "0.5rem" }}>
        <button onClick={onBack} style={{ padding: "0.5rem 1rem", background: "transparent", border: `1px solid ${T.border}`, color: T.dim, borderRadius: 6, fontSize: "0.8rem", cursor: "pointer" }}>← Back</button>
        <button onClick={onNext} disabled={selected.length === 0} style={{ padding: "0.55rem 1.4rem", background: T.gold, color: "var(--navy)", fontWeight: 700, borderRadius: 7, border: "none", fontSize: "0.85rem", cursor: selected.length === 0 ? "not-allowed" : "pointer", opacity: selected.length === 0 ? 0.4 : 1 }}>Allocate tickers →</button>
      </div>
    </div>
  );
}

function Step3Allocation({ tickers, loading, committing, totalCapital, cashReservePct, mode, provider, modelId, onUpdate, onBack, onConfirm }: { tickers: TickerAllocation[]; loading: boolean; committing: boolean; totalCapital: number; cashReservePct: number; mode: BuildMode; provider?: LlmProvider; modelId?: string; onUpdate: (ticker: string, field: keyof TickerAllocation, value: any) => void; onBack: () => void; onConfirm: () => void }) {
  const investable    = totalCapital * (1 - cashReservePct / 100);
  const investablePct = 100 - cashReservePct;
  const included      = tickers.filter(t => t.included);
  const buys          = included.filter(t => t.editSignal === "BUY");
  const watches       = included.filter(t => t.editSignal === "WATCH");
  const totalWeight   = buys.reduce((s, t) => s + Number(t.editWeight || 0), 0);
  const cashWeight    = 100 - totalWeight;
  const weightOk      = totalWeight <= investablePct + 0.5;

  type MergedTicker = TickerAllocation & { all_themes: string[] };
  const tickerMap = new Map<string, MergedTicker>();
  for (const t of tickers) {
    const existing = tickerMap.get(t.ticker);
    if (!existing) {
      tickerMap.set(t.ticker, { ...t, all_themes: [t.theme_name].filter(Boolean) });
    } else {
      const base: MergedTicker = Number(t.editWeight || 0) > Number(existing.editWeight || 0)
        ? { ...t, all_themes: existing.all_themes }
        : existing;
      base.all_themes = [...new Set([...existing.all_themes, t.theme_name].filter(Boolean))];
      tickerMap.set(t.ticker, base);
    }
  }
  const sortedTickers = [...tickerMap.values()].sort((a, b) => {
    if (a.included !== b.included) return a.included ? -1 : 1;
    if (a.editSignal !== b.editSignal) return a.editSignal === "BUY" ? -1 : 1;
    return a.ticker.localeCompare(b.ticker);
  });

  if (loading) return <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "1rem", padding: "3rem 0" }}><Spinner /><p style={{ fontSize: "0.82rem", color: T.dim, margin: 0 }}>Building ticker allocations across selected themes…</p></div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div style={{ fontSize: "0.72rem", color: T.dim }}>{mode === "llm" ? "Tickers selected by Claude from the full asset universe" : "Tickers selected by Claude from your mapped theme_tickers"}</div>
          <ModelBadge mode={mode} provider={mode === "llm" ? provider : undefined} modelId={mode === "llm" ? modelId : undefined} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "1rem" }}>
          {[["Total capital", formatCurrency(totalCapital)], ["Investable", `${formatCurrency(investable)} (${investablePct}%)`], ["BUY positions", `${buys.length} tickers`], ["WATCH list", `${watches.length} tickers`], ["Deployed", `${totalWeight.toFixed(1)}%`]].map(([label, val]) => (
            <div key={label}><div style={{ fontSize: "0.62rem", color: T.dim, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</div><div style={{ fontSize: "0.95rem", fontWeight: 700, color: T.cream, marginTop: "0.2rem" }}>{val}</div></div>
          ))}
        </div>
        <div style={{ marginTop: "0.75rem" }}>
          <div style={{ height: 5, background: "rgba(255,255,255,0.05)", borderRadius: 3, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 3, transition: "width 0.3s ease", width: `${Math.min(100, (totalWeight / investablePct) * 100)}%`, background: weightOk ? "linear-gradient(90deg, rgba(78,202,153,0.6), rgba(78,202,153,0.9))" : totalWeight > investablePct ? "linear-gradient(90deg, rgba(252,92,101,0.6), rgba(252,92,101,0.9))" : "linear-gradient(90deg, rgba(200,169,110,0.6), rgba(200,169,110,0.9))" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.3rem" }}>
            <span style={{ fontSize: "0.62rem", color: T.dim }}>{totalWeight.toFixed(1)}% deployed · {cashWeight.toFixed(1)}% cash{cashReservePct > 0 && ` (min ${cashReservePct}% reserved)`}</span>
            <span style={{ fontSize: "0.62rem", color: weightOk ? "#4eca99" : "#fc5c65", fontWeight: 600 }}>{!weightOk ? `⚠ ${(totalWeight - investablePct).toFixed(1)}% over limit — reduce BUY weights` : totalWeight < investablePct - 1 ? `${cashWeight.toFixed(1)}% stays as cash` : "✓ Fully allocated"}</span>
          </div>
        </div>
      </Card>

      <div style={{ background: T.navy2, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2rem 2fr 1fr 1fr 1fr 1fr 2.5rem", padding: "0.45rem 0.85rem", borderBottom: `1px solid ${T.border}`, fontSize: "0.6rem", color: T.dim, textTransform: "uppercase", letterSpacing: "0.07em" }}>
          <span /><span>Ticker {mode === "data" ? "· F/T scores" : ""}</span><span style={{ textAlign: "center" }}>Signal</span><span style={{ textAlign: "right" }}>Weight %</span><span style={{ textAlign: "right" }}>Capital</span><span style={{ textAlign: "right" }}>Price</span><span />
        </div>
        {sortedTickers.map((t, idx) => {
          const capital = (Number(t.editWeight || 0) / 100) * totalCapital;
          const price   = t.price;
          const qty     = price && price > 0 ? Math.floor(capital / price) : null;
          const isWatch = t.editSignal === "WATCH";
          return (
            <div key={t.ticker} style={{ display: "grid", gridTemplateColumns: "2rem 2fr 1fr 1fr 1fr 1fr 2.5rem", padding: "0.6rem 0.85rem", alignItems: "center", borderBottom: idx < sortedTickers.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", background: !t.included ? "rgba(0,0,0,0.15)" : "transparent", opacity: t.included ? 1 : 0.4, transition: "all 0.15s" }}>
              <button onClick={() => onUpdate(t.ticker, "included", !t.included)} style={{ width: 18, height: 18, borderRadius: 4, background: t.included ? T.gold : "transparent", border: `1.5px solid ${t.included ? T.gold : "rgba(255,255,255,0.2)"}`, cursor: "pointer", fontSize: "0.65rem", fontWeight: 900, color: "var(--navy)", display: "flex", alignItems: "center", justifyContent: "center" }}>{t.included && "✓"}</button>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, color: T.cream, fontSize: "0.85rem", fontFamily: "monospace" }}>{t.ticker}</span>
                  <span style={{ fontSize: "0.65rem", color: T.dim }}>{t.name}</span>
                  {t.all_themes?.map((th: string) => <span key={th} style={{ fontSize: "0.58rem", color: "rgba(200,169,110,0.6)", background: "rgba(200,169,110,0.08)", border: "1px solid rgba(200,169,110,0.2)", borderRadius: 4, padding: "0.05rem 0.35rem" }}>{th}</span>)}
                  {mode === "data" && t.db_signal && <span style={{ fontSize: "0.58rem", fontWeight: 700, color: t.db_signal === "buy" ? "#4eca99" : t.db_signal === "watch" ? "#f0b429" : t.db_signal === "avoid" ? "#fc5c65" : T.dim, background: t.db_signal === "buy" ? "rgba(78,202,153,0.1)" : t.db_signal === "watch" ? "rgba(240,180,41,0.1)" : "rgba(255,255,255,0.05)", border: `1px solid ${t.db_signal === "buy" ? "rgba(78,202,153,0.25)" : t.db_signal === "watch" ? "rgba(240,180,41,0.25)" : "rgba(255,255,255,0.08)"}`, padding: "0.05rem 0.35rem", borderRadius: 4, textTransform: "uppercase" }}>DB: {t.db_signal}</span>}
                </div>
                <div style={{ fontSize: "0.65rem", color: "rgba(232,226,217,0.3)", marginTop: "0.1rem", lineHeight: 1.4 }}>{t.rationale}</div>
                {mode === "data" && (t.fundamental_score != null || t.technical_score != null) && <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.35rem", flexWrap: "wrap" }}><SignalStrengthBar label="F" value={t.fundamental_score} color="rgba(200,169,110,0.8)" /><SignalStrengthBar label="T" value={t.technical_score} color="rgba(99,179,237,0.8)" /></div>}
                {mode === "data" && t.db_rationale && <div style={{ fontSize: "0.6rem", color: "rgba(232,226,217,0.2)", marginTop: "0.25rem", lineHeight: 1.4, fontStyle: "italic" }}>Signal rationale: {t.db_rationale.slice(0, 100)}{t.db_rationale.length > 100 ? "…" : ""}</div>}
                {qty != null && t.editSignal === "BUY" && <div style={{ fontSize: "0.62rem", color: "#63b3ed", marginTop: "0.15rem" }}>≈ {qty} units @ ${price?.toFixed(2)}</div>}
              </div>
              <div style={{ display: "flex", justifyContent: "center", gap: "0.3rem" }}>
                {(["BUY", "WATCH"] as const).map(sig => <button key={sig} onClick={() => onUpdate(t.ticker, "editSignal", sig)} style={{ padding: "0.18rem 0.5rem", background: t.editSignal === sig ? sig === "BUY" ? "rgba(78,202,153,0.15)" : "rgba(240,180,41,0.15)" : "transparent", border: `1px solid ${t.editSignal === sig ? sig === "BUY" ? "rgba(78,202,153,0.4)" : "rgba(240,180,41,0.4)" : "rgba(255,255,255,0.08)"}`, color: t.editSignal === sig ? sig === "BUY" ? "#4eca99" : "#f0b429" : T.dimmest, borderRadius: 4, fontSize: "0.62rem", fontWeight: 700, cursor: "pointer", letterSpacing: "0.04em" }}>{sig}</button>)}
              </div>
              <div style={{ textAlign: "right" }}>
                {!isWatch ? <div style={{ display: "flex", alignItems: "center", gap: "0.2rem", justifyContent: "flex-end" }}><input type="number" value={t.editWeight} onChange={e => onUpdate(t.ticker, "editWeight", e.target.value)} style={{ width: 52, textAlign: "right", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: T.cream, fontSize: "0.8rem", outline: "none", padding: "0.2rem 0.4rem" }} /><span style={{ fontSize: "0.65rem", color: T.dim }}>%</span></div> : <span style={{ fontSize: "0.72rem", color: T.dim }}>—</span>}
              </div>
              <div style={{ textAlign: "right", fontSize: "0.78rem", color: isWatch ? T.dim : T.cream }}>{isWatch ? "watchlist" : formatCurrency(capital)}</div>
              <div style={{ textAlign: "right", fontSize: "0.75rem", color: T.dim }}>{price != null ? `$${price.toFixed(2)}` : "—"}</div>
              <button onClick={() => onUpdate(t.ticker, "included", false)} style={{ background: "none", border: "none", color: T.dimmest, cursor: "pointer", fontSize: "0.9rem" }}>×</button>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "0.5rem" }}>
        <button onClick={onBack} style={{ padding: "0.5rem 1rem", background: "transparent", border: `1px solid ${T.border}`, color: T.dim, borderRadius: 6, fontSize: "0.8rem", cursor: "pointer" }}>← Back</button>
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          {!weightOk && buys.length > 0 && <span style={{ fontSize: "0.72rem", color: "#fc5c65" }}>Weights must not exceed {investablePct}%</span>}
          {/* PATCH 8: updated button label */}
          <button onClick={onConfirm} disabled={committing || !weightOk} style={{ padding: "0.6rem 1.6rem", background: T.gold, color: "var(--navy)", fontWeight: 700, borderRadius: 7, border: "none", fontSize: "0.88rem", cursor: committing || !weightOk ? "not-allowed" : "pointer", opacity: committing || !weightOk ? 0.5 : 1 }}>
            {committing ? "Preparing…" : `View recommendations → (${buys.length} BUY · ${watches.length} WATCH)`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

function PortfolioBuilderInner() {
  const router       = useRouter();
  const searchParams = useSearchParams();
  const portfolioId  = searchParams.get("portfolio_id");
  const initialMode  = (searchParams.get("mode") ?? "data") as BuildMode;

  const [step,      setStep]      = useState<Step>(1);
  const [mode,      setMode]      = useState<BuildMode>(initialMode);
  const [portfolio, setPortfolio] = useState<any>(null);
  const [strategy,  setStrategy]  = useState<Strategy | null>(null);
  const [error,     setError]     = useState<string | null>(null);

  const [dataThemes,  setDataThemes]  = useState<RecommendedTheme[]>([]);
  const [llmThemes,   setLlmThemes]   = useState<RecommendedTheme[]>([]);
  const [dataTickers, setDataTickers] = useState<TickerAllocation[]>([]);
  const [llmTickers,  setLlmTickers]  = useState<TickerAllocation[]>([]);
  const [dataRunId,   setDataRunId]   = useState<string | null>(null);
  const [llmRunId,    setLlmRunId]    = useState<string | null>(null);
  const [runId,       setRunId]       = useState<string | null>(null);
  const [macroScores, setMacroScores] = useState<MacroScore[]>([]);
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("claude");
  const [llmModelId,  setLlmModelId]  = useState<string>("claude-sonnet-4-20250514");

  const [loadingStrategy,        setLoadingStrategy]        = useState(false);
  const [promptPreview,          setPromptPreview]          = useState<string | null>(null);
  const [pendingStrategyArgs,    setPendingStrategyArgs]    = useState<any | null>(null);
  const [promptPreviewThemes,    setPromptPreviewThemes]    = useState<string | null>(null);
  const [pendingThemesArgs,      setPendingThemesArgs]      = useState<any | null>(null);
  const [promptPreviewAlloc,     setPromptPreviewAlloc]     = useState<string | null>(null);
  const [pendingAllocArgs,       setPendingAllocArgs]       = useState<any | null>(null);
  const [loadingDataThemes,      setLoadingDataThemes]      = useState(false);
  const [loadingLlmThemes,       setLoadingLlmThemes]       = useState(false);
  const [loadingDataAllocation,  setLoadingDataAllocation]  = useState(false);
  const [loadingLlmAllocation,   setLoadingLlmAllocation]   = useState(false);
  const [committing,             setCommitting]             = useState(false);

  const themes       = mode === "data" ? dataThemes    : llmThemes;
  const setThemes    = mode === "data" ? setDataThemes : setLlmThemes;
  const tickers      = mode === "data" ? dataTickers   : llmTickers;
  const activeRunId  = mode === "data" ? dataRunId     : llmRunId;

  const loadingThemes     = mode === "data" ? loadingDataThemes     : loadingLlmThemes;
  const loadingAllocation = mode === "data" ? loadingDataAllocation : loadingLlmAllocation;

  async function createRun(targetMode: BuildMode, strat: Strategy): Promise<string | null> {
    try {
      const res  = await fetch("/api/portfolio/builder/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_run", portfolio_id: portfolioId, mode: targetMode, strategy: strat }) });
      const data = await res.json();
      return data.run?.id ?? null;
    } catch { return null; }
  }

  async function saveThemesToRun(runId: string, themes: RecommendedTheme[]) {
    await fetch("/api/portfolio/builder/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_themes", run_id: runId, themes }) });
  }

  async function saveTickersToRun(runId: string, tickers: TickerAllocation[]) {
    const rows = tickers.map(t => ({ ticker: t.ticker, name: t.name, theme_name: t.theme_name, signal: t.editSignal, weight: Number(t.editWeight || 0), capital: t.price ? (Number(t.editWeight || 0) / 100) * ((portfolio?.total_capital ?? 0) * (1 - (strategy?.cash_reserve_pct ?? 0) / 100)) : null, price: t.price, quantity: t.price && Number(t.editWeight) ? Math.floor(((Number(t.editWeight) / 100) * ((portfolio?.total_capital ?? 0) * (1 - (strategy?.cash_reserve_pct ?? 0) / 100))) / t.price) : null, rationale: t.rationale, included: t.included, edited: t.editSignal !== t.signal || t.editWeight !== String(t.weight) }));
    await fetch("/api/portfolio/builder/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_tickers", run_id: runId, tickers: rows }) });
  }

  // PATCH 4: Clear old recommendations + create new run on mount
  useEffect(() => {
    if (!portfolioId) return;
    fetch(`/api/portfolio?portfolio_id=${portfolioId}`)
      .then(r => r.json())
      .then(async d => {
        setPortfolio(d.portfolio ?? null);
        // Clear any existing draft/recommendations runs so new build replaces old recommendation
        await fetch(`/api/portfolio/builder/recommendation?portfolio_id=${portfolioId}`, { method: "DELETE" });
        // Create fresh run record
        const runRes = await fetch("/api/portfolio/builder/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ portfolio_id: portfolioId, mode: initialMode }) });
        if (runRes.ok) { const d = await runRes.json(); setRunId(d.run_id); }
      });
  }, [portfolioId]);

  // Step 1: load prompt and show preview modal
  const generateStrategy = useCallback(async () => {
    setError(null);
    const args = { portfolio_id: portfolioId, mode: initialMode, run_id: runId, provider: initialMode === "llm" ? llmProvider : "claude", model_id: initialMode === "llm" ? llmModelId : undefined };
    setPendingStrategyArgs(args);
    try {
      // Fetch the assembled prompt for preview
      const res  = await fetch(`/api/portfolio/builder/strategy?portfolio_id=${portfolioId}&mode=${initialMode}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPromptPreview(data.prompt);
    } catch (e: any) {
      // If preview fails, fall back to running without preview
      setError(null);
      await runStrategy(args, undefined);
    }
  }, [portfolioId, runId, initialMode, llmProvider, llmModelId]);

  // Step 2: send prompt to LLM (called after user confirms in modal)
  const runStrategy = useCallback(async (args: any, promptOverride: string | undefined) => {
    setPromptPreview(null);
    setPendingStrategyArgs(null);
    setLoadingStrategy(true); setError(null);
    try {
      const res  = await fetch("/api/portfolio/builder/strategy", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...args, prompt_override: promptOverride }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setStrategy(data.strategy);
      if (data.macro) setMacroScores(data.macro);
      if (args.run_id) fetch("/api/portfolio/builder/run", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: args.run_id, strategy: data.strategy }) });
    } catch (e: any) { setError(e.message ?? "Failed to generate strategy"); }
    finally { setLoadingStrategy(false); }
  }, []);

  useEffect(() => { if (portfolio && !strategy && !loadingStrategy) generateStrategy(); }, [portfolio]);

  const generateThemes = useCallback(async (targetMode: BuildMode) => {
    if (!strategy) return;
    setError(null);
    const args = { portfolio_id: portfolioId, strategy, provider: "claude", model_id: undefined };
    setPendingThemesArgs({ ...args, targetMode });

    // Fetch prompt preview — pass strategy as query param for GET
    try {
      const strategyParam = encodeURIComponent(JSON.stringify(strategy));
      const res  = await fetch(`/api/portfolio/builder/themes?portfolio_id=${portfolioId}&strategy=${strategyParam}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPromptPreviewThemes(data.prompt);
    } catch (e: any) {
      // Preview failed — run directly without preview
      setError(null);
      await runThemes({ ...args, targetMode }, undefined);
    }
  }, [portfolioId, strategy]);

  const runThemes = useCallback(async (args: any, promptOverride: string | undefined) => {
    setPromptPreviewThemes(null);
    setPendingThemesArgs(null);
    const targetMode = args.targetMode ?? "data";
    const setLoading = setLoadingDataThemes;
    const setResult  = setDataThemes;
    const setRun     = setDataRunId;

    setLoading(true); setError(null);
    try {
      const runId = await createRun(targetMode, strategy!);
      if (runId) setRun(runId);
      const res  = await fetch("/api/portfolio/builder/themes", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portfolio_id: args.portfolio_id, strategy: args.strategy, prompt_override: promptOverride }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const themesResult = (data.themes as RecommendedTheme[]).map(t => ({ ...t, selected: true }));
      setResult(themesResult);
      if (runId) await saveThemesToRun(runId, themesResult);
      setMode("data"); setStep(2);
    } catch (e: any) { setError(e.message ?? "Failed to load themes"); }
    finally { setLoading(false); }
  }, [portfolioId, strategy]);

  const generateAllocation = useCallback(async (targetMode: BuildMode) => {
    const sourceThemes   = targetMode === "data" ? dataThemes : [];
    const selectedThemes = sourceThemes.filter(t => t.selected);
    if (!selectedThemes.length || !strategy) return;
    setError(null);

    const args = { portfolio_id: portfolioId, strategy, themes: selectedThemes, targetMode, provider: "claude" };
    setPendingAllocArgs(args);

    // Fetch prompt preview
    try {
      const themesParam   = encodeURIComponent(JSON.stringify(selectedThemes));
      const strategyParam = encodeURIComponent(JSON.stringify(strategy));
      const res  = await fetch(`/api/portfolio/builder/allocate?portfolio_id=${portfolioId}&themes=${themesParam}&strategy=${strategyParam}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPromptPreviewAlloc(data.prompt);
    } catch {
      // Preview failed — run directly
      await runAllocation(args, undefined);
    }
  }, [portfolioId, strategy, dataThemes]);

  const runAllocation = useCallback(async (args: any, promptOverride: string | undefined) => {
    setPromptPreviewAlloc(null);
    setPendingAllocArgs(null);
    const targetMode     = args.targetMode ?? "data";
    const setLoading     = setLoadingDataAllocation;
    const setResult      = setDataTickers;
    const runId          = dataRunId;
    const selectedThemes = args.themes;

    if (runId) await saveThemesToRun(runId, selectedThemes);
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/portfolio/builder/allocate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portfolio_id:    args.portfolio_id,
          strategy:        args.strategy,
          themes:          selectedThemes,
          run_id:          runId,
          provider:        "claude",
          prompt_override: promptOverride,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const themeAllocMap = new Map<string, number>(selectedThemes.map((th: any) => [th.name, Number(th.suggested_allocation ?? 0)]));
      const tickerResult = (data.tickers as TickerAllocation[]).map(t => {
        const themeAlloc      = themeAllocMap.get(t.theme_name) ?? 0;
        const portfolioWeight = t.signal === "BUY" ? parseFloat(((t.weight / 100) * themeAlloc).toFixed(1)) : 0;
        return { ...t, weight: portfolioWeight, editWeight: t.signal === "BUY" ? String(portfolioWeight) : "0", editSignal: t.signal, included: true };
      });
      setResult(tickerResult);
      if (runId) await saveTickersToRun(runId, tickerResult);
      setMode("data"); setStep(3);
    } catch (e: any) { setError(e.message ?? "Failed to allocate tickers"); }
    finally { setLoading(false); }
  }, [portfolioId, strategy, dataRunId]);

  // PATCH 5: confirm transitions to step 4 (no direct holdings insertion)
  const confirm = useCallback(async () => {
    setCommitting(true); setError(null);
    try {
      if (activeRunId) await saveTickersToRun(activeRunId, tickers);
      const otherRunId = mode === "data" ? llmRunId : dataRunId;
      if (otherRunId) await fetch("/api/portfolio/builder/run", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run_id: otherRunId, status: "abandoned" }) });
      setStep(4);
    } catch (e: any) { setError(e.message ?? "Failed to prepare recommendations"); }
    finally { setCommitting(false); }
  }, [portfolioId, tickers, strategy, activeRunId, mode, dataRunId, llmRunId]);

  function updateTicker(ticker: string, field: keyof TickerAllocation, value: any) {
    const setter = mode === "data" ? setDataTickers : setLlmTickers;
    setter(prev => prev.map(t => t.ticker === ticker ? { ...t, [field]: value } : t));
  }

  return (
    <div style={{ maxWidth: 860, margin: "0 auto" }}>
      <div style={{ marginBottom: "1.8rem" }}>
        <button onClick={() => router.back()} style={{ background: "none", border: "none", color: T.dim, cursor: "pointer", fontSize: "0.8rem", marginBottom: "0.8rem", padding: 0 }}>← Back to portfolio</button>
        <h1 style={{ color: T.cream, fontFamily: "serif", fontSize: "1.8rem", margin: "0 0 0.25rem" }}>Portfolio Advisor</h1>
        <p style={{ color: T.dim, fontSize: "0.82rem", margin: 0, lineHeight: 1.6 }}>
          AI-guided portfolio recommendations. Review each step, then decide which tickers to add to your holdings.
          Data-driven constrains Claude to your mapped themes; LLM-powered gives Claude the full asset universe.
        </p>
      </div>

      <StepIndicator current={step} total={4} />

      {error && <div style={{ background: "rgba(252,92,101,0.08)", border: "1px solid rgba(252,92,101,0.25)", borderRadius: 8, padding: "0.65rem 1rem", marginBottom: "1.2rem", fontSize: "0.8rem", color: "#fc5c65" }}>{error}</div>}

      {/* ── Dev tool: strategy prompt preview modal ── */}
      {promptPreview && pendingStrategyArgs && (
        <PromptPreviewModal
          prompt={promptPreview}
          title="Strategy Prompt Preview"
          description={`mode: ${pendingStrategyArgs.mode} · portfolio: ${pendingStrategyArgs.portfolio_id?.slice(0,8)}…`}
          onConfirm={edited => runStrategy(pendingStrategyArgs, edited !== promptPreview ? edited : undefined)}
          onCancel={() => { setPromptPreview(null); setPendingStrategyArgs(null); }}
        />
      )}

      {/* ── Dev tool: themes prompt preview modal ── */}
      {promptPreviewThemes && pendingThemesArgs && (
        <PromptPreviewModal
          prompt={promptPreviewThemes}
          title="Themes Prompt Preview"
          description={`data-driven · portfolio: ${pendingThemesArgs.portfolio_id?.slice(0,8)}…`}
          onConfirm={edited => runThemes(pendingThemesArgs, edited !== promptPreviewThemes ? edited : undefined)}
          onCancel={() => { setPromptPreviewThemes(null); setPendingThemesArgs(null); }}
        />
      )}

      {/* ── Dev tool: allocation prompt preview modal ── */}
      {promptPreviewAlloc && pendingAllocArgs && (
        <PromptPreviewModal
          prompt={promptPreviewAlloc}
          title="Allocation Prompt Preview"
          description={`${pendingAllocArgs.themes?.filter((t: any) => t.selected).length ?? 0} themes · portfolio: ${pendingAllocArgs.portfolio_id?.slice(0,8)}…`}
          onConfirm={edited => runAllocation(pendingAllocArgs, edited !== promptPreviewAlloc ? edited : undefined)}
          onCancel={() => { setPromptPreviewAlloc(null); setPendingAllocArgs(null); }}
        />
      )}

      {step === 1 && (
        <>
          {initialMode === "llm" && <LlmProviderToggle provider={llmProvider} modelId={llmModelId} onChange={(p, m) => { setLlmProvider(p); setLlmModelId(m); setStrategy(null); }} />}
          <Step1Strategy portfolio={portfolio} strategy={strategy} loading={loadingStrategy} mode={initialMode} macro={macroScores} provider={initialMode === "llm" ? llmProvider : undefined} modelId={initialMode === "llm" ? llmModelId : undefined} onGenerate={generateStrategy} onUpdate={setStrategy}
            onNext={() => {
              setStep(2);
              if (initialMode === "data" && dataThemes.length === 0 && !loadingDataThemes) generateThemes("data");
              else if (initialMode === "llm" && llmThemes.length === 0 && !loadingLlmThemes) generateThemes("llm");
            }}
          />
        </>
      )}

      {step === 2 && (
        <Step2Themes
          themes={dataThemes}
          loading={loadingDataThemes}
          mode="data"
          onToggle={id => setDataThemes(prev => prev.map(t => t.id === id ? { ...t, selected: !t.selected } : t))}
          onBack={() => setStep(1)}
          onNext={() => generateAllocation("data")}
        />
      )}

      {step === 3 && (
        <>
          {mode === "llm" && <LlmProviderToggle provider={llmProvider} modelId={llmModelId} onChange={(p, m) => { setLlmProvider(p); setLlmModelId(m); setLlmTickers([]); }} />}
          <ModeToggle mode={mode} onChange={m => { setMode(m); const src = m === "data" ? dataThemes : []; const trg = m === "data" ? dataTickers : llmTickers; const ldr = m === "data" ? loadingDataAllocation : loadingLlmAllocation; if (src.length > 0 && trg.length === 0 && !ldr) generateAllocation(m); }} dataReady={dataTickers.length > 0} llmReady={llmTickers.length > 0} />
          {dataTickers.length > 0 && llmTickers.length > 0 && (
            <div style={{ background: "rgba(99,179,237,0.05)", border: "1px solid rgba(99,179,237,0.2)", borderRadius: 8, padding: "0.6rem 1rem", marginBottom: "1rem", display: "flex", alignItems: "center", gap: "1rem" }}>
              <span style={{ fontSize: "0.72rem", color: "rgba(99,179,237,0.8)" }}>◈ Both modes ready — switch tabs above to compare, then confirm the one you prefer.</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem", fontSize: "0.7rem" }}>
                <span style={{ color: "rgba(232,226,217,0.4)" }}>Data: {dataTickers.filter(t => t.included && t.editSignal === "BUY").length} BUY</span>
                <span style={{ color: "rgba(232,226,217,0.2)" }}>·</span>
                <span style={{ color: "rgba(232,226,217,0.4)" }}>LLM: {llmTickers.filter(t => t.included && t.editSignal === "BUY").length} BUY</span>
              </div>
            </div>
          )}
          <Step3Allocation tickers={tickers} loading={loadingAllocation} committing={committing} totalCapital={portfolio?.total_capital ?? 0} cashReservePct={strategy?.cash_reserve_pct ?? portfolio?.cash_pct ?? 0} mode={mode} provider={mode === "llm" ? llmProvider : undefined} modelId={mode === "llm" ? llmModelId : undefined} onUpdate={updateTicker} onBack={() => setStep(2)} onConfirm={confirm} />
        </>
      )}

      {/* PATCH 6: Step 4 — Recommendation screen */}
      {step === 4 && (
        <RecommendationScreen
          portfolioId={portfolioId ?? ""}
          totalCapital={portfolio?.total_capital ?? 0}
          cashReservePct={strategy?.cash_reserve_pct ?? portfolio?.cash_pct ?? 0}
          runId={activeRunId ?? undefined}
          recommendations={tickers.filter(t => t.included).map(t => ({
            id:                t.ticker,
            ticker:            t.ticker,
            name:              t.name,
            signal:            t.editSignal as "BUY" | "WATCH",
            weight:            Number(t.editWeight || 0),
            price:             t.price,
            rationale:         t.rationale,
            theme_name:        t.theme_name,
            fundamental_score: t.fundamental_score,
            technical_score:   t.technical_score,
            was_confirmed:     false,
            added_at:          null,
          }))}
          onBack={() => setStep(3)}
          onDone={() => router.push(`/dashboard/portfolio?portfolio_id=${portfolioId}`)}
        />
      )}
    </div>
  );
}

export default function PortfolioBuilderPage() {
  return (
    <Suspense fallback={<div style={{ color: "rgba(232,226,217,0.2)", fontSize: "0.85rem", padding: "3rem 0" }}>Loading…</div>}>
      <PortfolioBuilderInner />
    </Suspense>
  );
}
