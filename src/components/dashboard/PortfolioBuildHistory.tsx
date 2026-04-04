// src/components/dashboard/PortfolioBuildHistory.tsx
"use client";

import { useEffect, useState, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BuildTheme {
  theme_name:           string;
  suggested_allocation: number;
  selected:             boolean;
  fit_reason:           string | null;
  is_llm_generated:     boolean;
}

interface BuildTicker {
  ticker:        string;
  name:          string | null;
  signal:        "BUY" | "WATCH";
  weight:        number;
  price:         number | null;
  rationale:     string | null;
  theme_name:    string | null;
  included:      boolean;
  was_confirmed: boolean;
}

interface BuildRun {
  id:           string;
  mode:         "data" | "llm";
  status:       "draft" | "confirmed" | "abandoned";
  strategy:     any;
  confirmed_at: string | null;
  created_at:   string;
  portfolio_build_themes:  BuildTheme[];
  portfolio_build_tickers: BuildTicker[];
}

// ─── Style helpers ────────────────────────────────────────────────────────────

const dim    = "rgba(232,226,217,0.35)";
const dimmer = "rgba(232,226,217,0.2)";

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  confirmed: { color: "#4eca99", bg: "rgba(78,202,153,0.1)",  label: "Confirmed" },
  draft:     { color: "#f0b429", bg: "rgba(240,180,41,0.1)",  label: "Draft" },
  abandoned: { color: dim,       bg: "rgba(255,255,255,0.04)", label: "Abandoned" },
};

const MODE_STYLE: Record<string, { color: string; icon: string; label: string }> = {
  data: { color: "#63b3ed", icon: "◈", label: "Data-driven" },
  llm:  { color: "var(--gold)", icon: "✦", label: "LLM-powered" },
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Run detail panel ─────────────────────────────────────────────────────────

function RunDetail({ run }: { run: BuildRun }) {
  const [showPrompts, setShowPrompts] = useState(false);
  const [logs,        setLogs]        = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const buys    = run.portfolio_build_tickers.filter(t => t.signal === "BUY");
  const watches = run.portfolio_build_tickers.filter(t => t.signal === "WATCH");
  const confirmed = run.portfolio_build_tickers.filter(t => t.was_confirmed);

  async function loadLogs() {
    if (logs.length > 0) { setShowPrompts(v => !v); return; }
    setLoadingLogs(true);
    try {
      const res  = await fetch(`/api/portfolio/builder/logs?run_id=${run.id}`);
      const data = await res.json();
      setLogs(data.logs ?? []);
      setShowPrompts(true);
    } finally {
      setLoadingLogs(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem", paddingTop: "0.5rem" }}>

      {/* Strategy summary */}
      {run.strategy && (
        <div>
          <div style={{ fontSize: "0.62rem", color: "rgba(200,169,110,0.5)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "0.4rem" }}>Strategy</div>
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
            {[
              ["Style",        run.strategy.style],
              ["Cash reserve", `${run.strategy.cash_reserve_pct ?? 0}%`],
              ["Max position", `${run.strategy.max_single_weight ?? "—"}%`],
              ["Sector tilts", (run.strategy.sector_tilts ?? []).join(", ") || "none"],
              ["Avoid",        (run.strategy.avoid_sectors ?? []).join(", ") || "none"],
            ].map(([k, v]) => (
              <div key={k}>
                <div style={{ fontSize: "0.6rem", color: dimmer, textTransform: "uppercase", letterSpacing: "0.07em" }}>{k}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--cream)", fontWeight: 500, textTransform: "capitalize", marginTop: "0.1rem" }}>{v}</div>
              </div>
            ))}
          </div>
          {run.strategy.rationale && (
            <p style={{ fontSize: "0.75rem", color: dim, margin: "0.5rem 0 0", lineHeight: 1.5, fontStyle: "italic" }}>
              "{run.strategy.rationale}"
            </p>
          )}
        </div>
      )}

      {/* Themes */}
      {run.portfolio_build_themes.length > 0 && (
        <div>
          <div style={{ fontSize: "0.62rem", color: "rgba(200,169,110,0.5)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "0.4rem" }}>
            Themes ({run.portfolio_build_themes.filter(t => t.selected).length} selected)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
            {run.portfolio_build_themes.map(t => (
              <span key={t.theme_name} style={{
                fontSize: "0.72rem",
                padding: "0.2rem 0.6rem",
                borderRadius: 5,
                background: t.selected ? "rgba(200,169,110,0.1)" : "rgba(255,255,255,0.03)",
                border: `1px solid ${t.selected ? "rgba(200,169,110,0.3)" : "rgba(255,255,255,0.07)"}`,
                color: t.selected ? "var(--gold)" : dimmer,
                opacity: t.selected ? 1 : 0.5,
              }}>
                {t.is_llm_generated && <span style={{ marginRight: "0.3rem", opacity: 0.6 }}>✦</span>}
                {t.theme_name}
                <span style={{ marginLeft: "0.4rem", opacity: 0.5 }}>{t.suggested_allocation}%</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Ticker allocation table */}
      {run.portfolio_build_tickers.length > 0 && (
        <div>
          <div style={{ fontSize: "0.62rem", color: "rgba(200,169,110,0.5)", textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: "0.4rem" }}>
            Allocation — {buys.length} BUY · {watches.length} WATCH · {confirmed.length} confirmed
          </div>
          <div style={{
            background: "rgba(0,0,0,0.2)", borderRadius: 7, overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.06)",
          }}>
            {/* Header */}
            <div style={{
              display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 2fr",
              padding: "0.35rem 0.85rem",
              fontSize: "0.58rem", color: dimmer, textTransform: "uppercase", letterSpacing: "0.07em",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}>
              <span>Ticker</span>
              <span style={{ textAlign: "center" }}>Signal</span>
              <span style={{ textAlign: "right" }}>Weight</span>
              <span style={{ textAlign: "right" }}>Price</span>
              <span>Theme</span>
            </div>
            {run.portfolio_build_tickers.map((t, idx) => (
              <div key={t.ticker} style={{
                display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 2fr",
                padding: "0.45rem 0.85rem", alignItems: "center",
                borderBottom: idx < run.portfolio_build_tickers.length - 1
                  ? "1px solid rgba(255,255,255,0.03)" : "none",
                opacity: t.included ? 1 : 0.35,
                background: t.was_confirmed ? "rgba(78,202,153,0.03)" : "transparent",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                  <span style={{ fontWeight: 700, color: "var(--cream)", fontSize: "0.82rem", fontFamily: "monospace" }}>{t.ticker}</span>
                  {t.was_confirmed && <span style={{ fontSize: "0.55rem", color: "#4eca99", background: "rgba(78,202,153,0.12)", padding: "0.05rem 0.3rem", borderRadius: 4 }}>confirmed</span>}
                  {!t.included && <span style={{ fontSize: "0.55rem", color: dimmer }}>excluded</span>}
                </div>
                <div style={{ textAlign: "center" }}>
                  <span style={{
                    fontSize: "0.62rem", fontWeight: 700,
                    color: t.signal === "BUY" ? "#4eca99" : "#f0b429",
                    background: t.signal === "BUY" ? "rgba(78,202,153,0.1)" : "rgba(240,180,41,0.1)",
                    padding: "0.1rem 0.4rem", borderRadius: 4,
                  }}>
                    {t.signal}
                  </span>
                </div>
                <div style={{ textAlign: "right", fontSize: "0.78rem", color: dim }}>
                  {t.signal === "BUY" ? `${t.weight}%` : "—"}
                </div>
                <div style={{ textAlign: "right", fontSize: "0.75rem", color: dim }}>
                  {t.price != null ? `$${t.price.toFixed(2)}` : "—"}
                </div>
                <div style={{ fontSize: "0.68rem", color: dimmer, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.theme_name ?? "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LLM prompt/response logs */}
      {run.mode === "llm" && (
        <div>
          <button
            onClick={loadLogs}
            disabled={loadingLogs}
            style={{
              fontSize: "0.72rem", color: dim,
              background: "none", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 5, padding: "0.3rem 0.75rem",
              cursor: loadingLogs ? "not-allowed" : "pointer",
            }}
          >
            {loadingLogs ? "Loading logs…" : showPrompts ? "▲ Hide LLM logs" : "▼ View LLM prompt/response logs"}
          </button>

          {showPrompts && logs.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginTop: "0.75rem" }}>
              {logs.map(log => (
                <div key={log.id} style={{
                  background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 7, overflow: "hidden",
                }}>
                  {/* Log header */}
                  <div style={{
                    display: "flex", alignItems: "center", gap: "0.75rem",
                    padding: "0.5rem 0.85rem",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    background: "rgba(255,255,255,0.02)",
                  }}>
                    <span style={{ fontSize: "0.65rem", fontWeight: 700, color: "var(--gold)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                      Step: {log.step}
                    </span>
                    <span style={{ fontSize: "0.62rem", color: dimmer }}>{log.model}</span>
                    <span style={{ fontSize: "0.62rem", color: dimmer }}>
                      ↑{log.input_tokens ?? "?"} ↓{log.output_tokens ?? "?"} tokens
                    </span>
                    <span style={{ fontSize: "0.62rem", color: dimmer }}>
                      {log.latency_ms != null ? `${log.latency_ms}ms` : ""}
                    </span>
                    <span style={{ fontSize: "0.62rem", color: dimmer, marginLeft: "auto" }}>
                      {formatDate(log.created_at)}
                    </span>
                  </div>

                  {/* Prompt */}
                  <div style={{ padding: "0.65rem 0.85rem", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ fontSize: "0.58rem", color: dimmer, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.3rem" }}>Prompt</div>
                    <pre style={{
                      fontSize: "0.68rem", color: dim, lineHeight: 1.6,
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                      maxHeight: 200, overflowY: "auto", margin: 0,
                      fontFamily: "monospace",
                    }}>
                      {log.prompt}
                    </pre>
                  </div>

                  {/* Response */}
                  <div style={{ padding: "0.65rem 0.85rem" }}>
                    <div style={{ fontSize: "0.58rem", color: dimmer, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: "0.3rem" }}>Response</div>
                    <pre style={{
                      fontSize: "0.68rem", color: "#4eca99", lineHeight: 1.6,
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                      maxHeight: 200, overflowY: "auto", margin: 0,
                      fontFamily: "monospace",
                    }}>
                      {log.response}
                    </pre>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PortfolioBuildHistory({ portfolioId }: { portfolioId: string }) {
  const [runs,       setRuns]       = useState<BuildRun[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`/api/portfolio/builder/run?portfolio_id=${portfolioId}`);
      const data = await res.json();
      setRuns(data.runs ?? []);
    } finally {
      setLoading(false);
    }
  }, [portfolioId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div style={{ color: dimmer, fontSize: "0.82rem", padding: "1rem 0" }}>Loading build history…</div>
  );

  if (!runs.length) return (
    <div style={{
      background: "var(--navy2)", border: "1px solid var(--dash-border)",
      borderRadius: 8, padding: "2rem", textAlign: "center",
      color: dimmer, fontSize: "0.82rem",
    }}>
      No build history yet. Use "Build with data" or "Build with LLM" to get started.
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      {runs.map(run => {
        const mode   = MODE_STYLE[run.mode];
        const status = STATUS_STYLE[run.status];
        const expanded = expandedId === run.id;
        const buyCount  = run.portfolio_build_tickers.filter(t => t.signal === "BUY").length;
        const watchCount = run.portfolio_build_tickers.filter(t => t.signal === "WATCH").length;

        return (
          <div key={run.id} style={{
            background: "var(--navy2)", border: "1px solid var(--dash-border)",
            borderRadius: 10, overflow: "hidden",
            borderColor: run.status === "confirmed" ? "rgba(78,202,153,0.2)" : "var(--dash-border)",
          }}>
            {/* Row header — always visible */}
            <button
              onClick={() => setExpandedId(expanded ? null : run.id)}
              style={{
                width: "100%", textAlign: "left", background: "none", border: "none",
                padding: "0.85rem 1.1rem", cursor: "pointer",
                display: "flex", alignItems: "center", gap: "0.75rem",
              }}
            >
              {/* Mode badge */}
              <span style={{
                fontSize: "0.65rem", fontWeight: 700,
                color: mode.color,
                background: `${mode.color}15`,
                border: `1px solid ${mode.color}40`,
                borderRadius: 5, padding: "0.15rem 0.5rem",
                flexShrink: 0,
              }}>
                {mode.icon} {mode.label}
              </span>

              {/* Status badge */}
              <span style={{
                fontSize: "0.62rem", fontWeight: 600,
                color: status.color, background: status.bg,
                borderRadius: 4, padding: "0.12rem 0.45rem",
                flexShrink: 0,
              }}>
                {status.label}
              </span>

              {/* Strategy style */}
              {run.strategy?.style && (
                <span style={{ fontSize: "0.75rem", color: "var(--cream)", fontWeight: 500, textTransform: "capitalize" }}>
                  {run.strategy.style}
                </span>
              )}

              {/* Ticker counts */}
              {run.portfolio_build_tickers.length > 0 && (
                <span style={{ fontSize: "0.7rem", color: dimmer }}>
                  {buyCount} BUY · {watchCount} WATCH
                </span>
              )}

              {/* Date */}
              <span style={{ fontSize: "0.68rem", color: dimmer, marginLeft: "auto" }}>
                {formatDate(run.created_at)}
              </span>

              {/* Expand chevron */}
              <span style={{ color: dimmer, fontSize: "0.7rem", flexShrink: 0 }}>
                {expanded ? "▲" : "▼"}
              </span>
            </button>

            {/* Expanded detail */}
            {expanded && (
              <div style={{ padding: "0 1.1rem 1.1rem", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <RunDetail run={run} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
