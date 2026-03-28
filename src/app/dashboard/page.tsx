import { createServiceClient } from "@/lib/supabase/server";
import RssSubscribe from "@/components/dashboard/RssSubscribe";
import MacroHeatPanel from "@/components/dashboard/MacroHeatPanel";

export const dynamic = 'force-dynamic'
export const revalidate = 0

type Theme = {
  id: string; name: string; label: string | null; timeframe: string
  conviction: number | null; momentum: string | null; candidate_tickers: string[] | null
  brief: string | null; anchor_reason: string | null
}

type Event = {
  id: string; headline: string; sentiment_score: number | null
  impact_score: number | null; event_type: string | null; published_at: string
}

export default async function DashboardPage() {
  const supabase = createServiceClient();

  const [eventsResult, themesResult] = await Promise.all([
    supabase
      .from("events")
      .select("id, headline, sentiment_score, impact_score, event_type, published_at")
      .eq("ai_processed", true)
      .order("impact_score", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(4) as unknown as Promise<{ data: Event[] | null }>,
    supabase
      .from("themes")
      .select("id, name, label, timeframe, conviction, momentum, candidate_tickers, brief, anchor_reason")
      .eq("is_active", true)
      .order("timeframe") as unknown as Promise<{ data: Theme[] | null }>,
  ]);

  const events = eventsResult.data ?? []
  const themes = themesResult.data ?? []

  return (
    <div>
      <h1 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.8rem", marginBottom: "1.5rem" }}>
        Overview
      </h1>

      {/* Macro heat map */}
      <div style={{ marginBottom: "1.5rem" }}>
        <MacroHeatPanel />
      </div>

      {/* Active themes panel */}
      {themes.length > 0 && (
        <div style={{ marginBottom: "2rem" }}>
          <SectionHeader title="Macro-driven themes" href="/dashboard/themes" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem" }}>
            {themes.map(t => <ThemePanel key={t.id} theme={t} />)}
          </div>
        </div>
      )}

      {/* Event feed — full width now that themes moved up */}
      <div>
        <SectionHeader title="Latest signals" href="/dashboard/events" />
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {events.map(e => <EventRow key={e.id} event={e} />)}
          {!events.length && <Empty text="No classified events yet. Run the ingest cron." />}
        </div>
      </div>

      {/* RSS subscriptions */}
      <div style={{ marginTop: "2rem" }}>
        <RssSubscribe />
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
      <h2 style={{ color: "var(--cream)", fontSize: "0.9rem", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>{title}</h2>
      <a href={href} style={{ fontSize: "0.72rem", color: "var(--gold)", opacity: 0.7 }}>View all →</a>
    </div>
  );
}

function ThemePanel({ theme }: { theme: Theme }) {
  const momentumColor = ({
    strong_up:    "var(--signal-bull)",
    moderate_up:  "#8de0bf",
    neutral:      "var(--signal-neut)",
    moderate_down:"#e8a070",
    strong_down:  "var(--signal-bear)",
  } as Record<string, string>)[theme.momentum ?? "neutral"] ?? "var(--signal-neut)";

  const tfLabel = ({ "1m": "1 Month", "3m": "3 Months", "6m": "6 Months" } as Record<string, string>)[theme.timeframe] ?? theme.timeframe

  const momentumLabel = ({
    strong_up:    "↑↑ Strong",
    moderate_up:  "↑ Moderate",
    neutral:      "→ Neutral",
    moderate_down:"↓ Moderate",
    strong_down:  "↓↓ Strong",
  } as Record<string, string>)[theme.momentum ?? "neutral"] ?? "→ Neutral"

  return (
    <div style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "1.1rem 1.2rem" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.6rem" }}>
        <div style={{ fontSize: "0.65rem", background: "rgba(200,169,110,0.12)", color: "var(--gold)", padding: "0.15rem 0.4rem", borderRadius: 3, fontWeight: 500 }}>
          {tfLabel}
        </div>
        <div style={{ fontSize: "0.62rem", color: momentumColor, fontWeight: 500 }}>
          {momentumLabel}
        </div>
      </div>

      {/* Theme name */}
      <div style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--cream)", lineHeight: 1.3, marginBottom: "0.5rem" }}>
        {theme.name}
      </div>

      {/* Conviction bar */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem" }}>
        <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2 }}>
          <div style={{ width: `${theme.conviction ?? 0}%`, height: "100%", background: momentumColor, borderRadius: 2 }} />
        </div>
        <div style={{ fontSize: "0.68rem", color: momentumColor, fontWeight: 600, minWidth: "2.5rem", textAlign: "right" }}>
          {theme.conviction ?? 0}/100
        </div>
      </div>

      {/* Brief */}
      {theme.brief && (
        <div style={{ fontSize: "0.72rem", color: "rgba(232,226,217,0.45)", lineHeight: 1.55, marginBottom: "0.7rem" }}>
          {theme.brief.slice(0, 120)}{theme.brief.length > 120 ? "…" : ""}
        </div>
      )}

      {/* Anchor reason */}
      {theme.anchor_reason && (
        <div style={{ fontSize: "0.62rem", color: "rgba(200,169,110,0.5)", marginBottom: "0.6rem", fontStyle: "italic" }}>
          ⚓ {theme.anchor_reason}
        </div>
      )}

      {/* Tickers */}
      <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
        {(theme.candidate_tickers ?? []).slice(0, 5).map(t => (
          <span key={t} style={{ fontSize: "0.62rem", background: "rgba(78,202,153,0.08)", color: "var(--signal-bull)", padding: "0.1rem 0.35rem", borderRadius: 3, fontWeight: 500 }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

function EventRow({ event }: { event: Event }) {
  const score       = event.sentiment_score ?? 0;
  const dotColor    = score > 0.1 ? "var(--signal-bull)" : score < -0.1 ? "var(--signal-bear)" : "var(--signal-neut)";
  const impactScore = event.impact_score ?? 1;
  const impactColor = impactScore >= 7 ? "var(--signal-bear)" : impactScore >= 4 ? "var(--signal-neut)" : "rgba(232,226,217,0.3)";
  return (
    <div style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 6, padding: "0.75rem 1rem", display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, marginTop: "0.3rem", flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "0.82rem", color: "var(--cream)", lineHeight: 1.4 }}>{event.headline}</div>
        <div style={{ fontSize: "0.7rem", color: "rgba(232,226,217,0.35)", marginTop: "0.25rem" }}>
          <span style={{ color: impactColor }}>impact {impactScore}/10</span>
          {" · "}{event.event_type?.replace("_", " ") ?? "unclassified"}
        </div>
      </div>
      <div style={{ fontSize: "0.75rem", fontWeight: 600, color: dotColor, flexShrink: 0 }}>
        {score >= 0 ? "+" : ""}{score.toFixed(2)}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ color: "rgba(232,226,217,0.25)", fontSize: "0.8rem", padding: "1rem 0" }}>{text}</div>;
}
28/03/2026 5:29:26 PM
