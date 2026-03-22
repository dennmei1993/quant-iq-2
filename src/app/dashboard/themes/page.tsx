import { createServerSupabaseClient } from "@/lib/supabase";

const MOMENTUM_LABEL: Record<string, string> = {
  strong_up:     "Strong ↑",
  moderate_up:   "Moderate ↑",
  neutral:       "Neutral →",
  moderate_down: "Moderate ↓",
  strong_down:   "Strong ↓",
};

const MOMENTUM_COLOR: Record<string, string> = {
  strong_up:     "var(--signal-bull)",
  moderate_up:   "#8de0bf",
  neutral:       "var(--signal-neut)",
  moderate_down: "#e8a070",
  strong_down:   "var(--signal-bear)",
};

type Theme = {
  id: string;
  name: string;
  label: string | null;
  timeframe: string;
  conviction: number | null;
  momentum: string | null;
  brief: string | null;
  candidate_tickers: string[] | null;
  expires_at: string | null;
};

export default async function ThemesPage() {
  const supabase = await createServerSupabaseClient();

  const { data: themes } = await supabase
    .from("themes")
    .select("*")
    .eq("is_active", true)
    .order("timeframe");

  const byTimeframe: Record<string, Theme[]> = {
    "1m": (themes ?? []).filter(t => t.timeframe === "1m") as Theme[],
    "3m": (themes ?? []).filter(t => t.timeframe === "3m") as Theme[],
    "6m": (themes ?? []).filter(t => t.timeframe === "6m") as Theme[],
  };

  return (
    <div>
      <div style={{ marginBottom: "1.5rem" }}>
        <h1 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.8rem", marginBottom: "0.25rem" }}>
          Investment themes
        </h1>
        <p style={{ color: "rgba(232,226,217,0.35)", fontSize: "0.82rem" }}>
          AI-generated investment theses across 1m, 3m, and 6m horizons
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1.5rem" }}>
        {(["1m", "3m", "6m"] as const).map(tf => (
          <div key={tf}>
            <div style={{ fontSize: "0.68rem", fontWeight: 500, color: "rgba(200,169,110,0.5)", letterSpacing: "0.16em", textTransform: "uppercase", marginBottom: "0.75rem" }}>
              {tf === "1m" ? "1 Month" : tf === "3m" ? "3 Months" : "6 Months"}
            </div>
            {byTimeframe[tf].length ? byTimeframe[tf].map(t => (
              <ThemeCard key={t.id} theme={t} />
            )) : (
              <div style={{ color: "rgba(232,226,217,0.2)", fontSize: "0.78rem", padding: "1rem 0" }}>
                No active theme — runs after next cron.
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ThemeCard({ theme }: { theme: Theme }) {
  const momentum   = theme.momentum ?? "neutral";
  const conviction = theme.conviction ?? 0;
  const mColor     = MOMENTUM_COLOR[momentum] ?? "var(--signal-neut)";
  const tickers    = theme.candidate_tickers ?? [];

  return (
    <div style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 10, padding: "1.2rem 1.3rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
        <div style={{ fontSize: "0.92rem", fontWeight: 600, color: "var(--cream)", lineHeight: 1.35 }}>
          {theme.name}
        </div>
        {theme.label && (
          <span style={{ fontSize: "0.65rem", background: "rgba(200,169,110,0.12)", color: "var(--gold)", padding: "0.15rem 0.45rem", borderRadius: 4, flexShrink: 0, marginLeft: "0.5rem" }}>
            {theme.label}
          </span>
        )}
      </div>

      <div style={{ marginBottom: "0.6rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.3rem" }}>
          <span style={{ fontSize: "0.68rem", color: mColor }}>
            {MOMENTUM_LABEL[momentum] ?? "Neutral →"}
          </span>
          <span style={{ fontSize: "0.68rem", color: mColor }}>{conviction}/100</span>
        </div>
        <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2 }}>
          <div style={{ width: `${conviction}%`, height: "100%", background: mColor, borderRadius: 2 }} />
        </div>
      </div>

      {theme.brief && (
        <p style={{ fontSize: "0.78rem", color: "rgba(232,226,217,0.5)", lineHeight: 1.6, marginBottom: "0.75rem" }}>
          {theme.brief}
        </p>
      )}

      {tickers.length > 0 && (
        <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
          {tickers.map((t: string) => (
            <span key={t} style={{ fontSize: "0.68rem", background: "rgba(78,202,153,0.1)", color: "var(--signal-bull)", padding: "0.15rem 0.4rem", borderRadius: 4, fontWeight: 500 }}>
              {t}
            </span>
          ))}
        </div>
      )}

      {theme.expires_at && (
        <div style={{ fontSize: "0.65rem", color: "rgba(232,226,217,0.2)", marginTop: "0.75rem" }}>
          Expires {new Date(theme.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
      )}
    </div>
  );
}