import { createServiceClient } from "@/lib/supabase/server";
import RssSubscribe from "@/components/dashboard/RssSubscribe";

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function DashboardPage() {
  const supabase = createServiceClient();

  const [
    { data: events },
    { data: themes },
    { count: eventCount, error },
  ] = await Promise.all([
    supabase
      .from("events")
      .select("id, headline, sentiment_score, impact_score, event_type, published_at")
      .eq("ai_processed", true)
      .order("impact_score", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(4) as unknown as Promise<{ data: { id: string; headline: string; sentiment_score: number | null; impact_score: number | null; event_type: string | null; published_at: string }[] | null }>,
    supabase
      .from("themes")
      .select("id, name, label, timeframe, conviction, momentum, candidate_tickers")
      .eq("is_active", true)
      .order("timeframe") as unknown as Promise<{ data: { id: string; name: string; label: string | null; timeframe: string; conviction: number | null; momentum: string | null; candidate_tickers: string[] | null }[] | null }>,
    supabase
      .from("events")
      .select("*", { count: "exact", head: true }) as unknown as Promise<{ count: number | null; error: { message: string } | null }>,
  ]);

  console.log("[dashboard] events:", events?.length, "error:", error?.message);

  const avgSentiment = events?.length
    ? (events.reduce((s, e) => s + (e.sentiment_score ?? 0), 0) / events.length).toFixed(2)
    : "0.00";

  const highImpact = events?.filter(e => (e.impact_score ?? 0) >= 7).length ?? 0;

  return (
    <div>
      <h1 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.8rem", marginBottom: "1.5rem" }}>
        Overview
      </h1>

      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "2rem" }}>
        <KpiCard title="Events (24h)" value={String(eventCount ?? 0)} sub="AI classified" />
        <KpiCard title="High impact" value={String(highImpact)} sub="last 24h" />
        <KpiCard title="Market sentiment" value={`${Number(avgSentiment) >= 0 ? "+" : ""}${avgSentiment}`}
          sub="avg score today"
          valueColor={Number(avgSentiment) > 0.1 ? "var(--signal-bull)" : Number(avgSentiment) < -0.1 ? "var(--signal-bear)" : "var(--signal-neut)"}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1.5rem" }}>
        {/* Event feed */}
        <div>
          <SectionHeader title="Latest signals" href="/dashboard/events" />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {(events ?? []).map(e => (
              <EventRow key={e.id} event={e} />
            ))}
            {!events?.length && <Empty text="No classified events yet. Run the ingest cron." />}
          </div>
        </div>

        {/* Active themes */}
        <div>
          <SectionHeader title="Active themes" href="/dashboard/themes" />
          <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
            {(themes ?? []).map(t => (
              <ThemeCard key={t.id} theme={t} />
            ))}
            {!themes?.length && <Empty text="No themes yet. Run the themes cron." />}
          </div>
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

function KpiCard({ title, value, sub, valueColor }: { title: string; value: string; sub: string; valueColor?: string }) {
  return (
    <div style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "1.2rem 1.4rem" }}>
      <div style={{ fontSize: "0.7rem", color: "rgba(200,169,110,0.5)", textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: "0.5rem" }}>{title}</div>
      <div style={{ fontSize: "2rem", fontWeight: 700, color: valueColor ?? "var(--gold)", lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: "0.75rem", color: "rgba(232,226,217,0.35)", marginTop: "0.3rem" }}>{sub}</div>
    </div>
  );
}

function SectionHeader({ title, href }: { title: string; href: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
      <h2 style={{ color: "var(--cream)", fontSize: "0.9rem", fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase" }}>{title}</h2>
      <a href={href} style={{ fontSize: "0.72rem", color: "var(--gold)", opacity: 0.7 }}>View all →</a>
    </div>
  );
}

function EventRow({ event }: { event: { headline: string; sentiment_score: number | null; impact_score: number | null; event_type: string | null } }) {
  const score = event.sentiment_score ?? 0;
  const dotColor = score > 0.1 ? "var(--signal-bull)" : score < -0.1 ? "var(--signal-bear)" : "var(--signal-neut)";
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

function ThemeCard({ theme }: { theme: { name: string; timeframe: string; conviction: number | null; momentum: string | null; candidate_tickers: string[] | null } }) {
  const momentumColor = { strong_up: "var(--signal-bull)", moderate_up: "#8de0bf", neutral: "var(--signal-neut)", moderate_down: "#e8a070", strong_down: "var(--signal-bear)" }[theme.momentum ?? "neutral"] ?? "var(--signal-neut)";
  return (
    <div style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "1rem 1.2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
        <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--cream)" }}>{theme.name}</div>
        <div style={{ fontSize: "0.65rem", background: "rgba(200,169,110,0.12)", color: "var(--gold)", padding: "0.15rem 0.4rem", borderRadius: 3 }}>{theme.timeframe}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.6rem" }}>
        <div style={{ flex: 1, height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 2 }}>
          <div style={{ width: `${theme.conviction ?? 0}%`, height: "100%", background: momentumColor, borderRadius: 2 }} />
        </div>
        <div style={{ fontSize: "0.7rem", color: momentumColor }}>{theme.conviction ?? 0}/100</div>
      </div>
      <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
        {(theme.candidate_tickers ?? []).slice(0, 4).map(t => (
          <span key={t} style={{ fontSize: "0.65rem", background: "rgba(255,255,255,0.06)", color: "rgba(232,226,217,0.5)", padding: "0.1rem 0.35rem", borderRadius: 3 }}>{t}</span>
        ))}
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ color: "rgba(232,226,217,0.25)", fontSize: "0.8rem", padding: "1rem 0" }}>{text}</div>;
}
