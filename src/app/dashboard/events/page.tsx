import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = 'force-dynamic'
export const revalidate = 0


interface EventRow {
  id:              string
  headline:        string
  event_type:      string | null
  sectors:         string[] | null
  sentiment_score: number | null
  impact_score:    number | null
  tickers:         string[] | null
  ai_summary:      string | null
  published_at:    string
}

export default async function EventsPage() {
  const supabase = createServiceClient();

  const result = await (supabase
    .from("events")
    .select("id, headline, event_type, sectors, sentiment_score, impact_score, tickers, ai_summary, published_at")
    .eq("ai_processed", true)
    .order("impact_score", { ascending: false })
    .order("published_at", { ascending: false })
    .limit(50) as unknown as Promise<{ data: EventRow[] | null }>)

  const events = result.data

  return (
    <div>
      <PageHeader title="Event intelligence" sub={`${events?.length ?? 0} classified events`} />

      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {(events ?? []).map(e => {
          const score = e.sentiment_score ?? 0;
          const scoreColor = score > 0.1 ? "var(--signal-bull)" : score < -0.1 ? "var(--signal-bear)" : "var(--signal-neut)";
          return (
            <div key={e.id} style={{ background: "var(--navy2)", border: "1px solid var(--dash-border)", borderRadius: 8, padding: "1.1rem 1.3rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", marginBottom: "0.5rem" }}>
                <div style={{ fontSize: "0.88rem", color: "var(--cream)", lineHeight: 1.45, flex: 1 }}>
                  {e.headline}
                </div>
                <div style={{ flexShrink: 0, textAlign: "right" }}>
                  <div style={{ fontSize: "1rem", fontWeight: 700, color: scoreColor }}>
                    {score >= 0 ? "+" : ""}{score.toFixed(2)}
                  </div>
                  <div style={{ fontSize: "0.65rem", color: (e.impact_score ?? 0) >= 7 ? "var(--signal-bear)" : (e.impact_score ?? 0) >= 4 ? "var(--signal-neut)" : "rgba(232,226,217,0.3)", textTransform: "uppercase", marginTop: "0.15rem" }}>
                    {e.impact_score ?? 1}/10
                  </div>
                </div>
              </div>
              {e.ai_summary && (
                <div style={{ fontSize: "0.78rem", color: "rgba(232,226,217,0.45)", marginBottom: "0.6rem", lineHeight: 1.5 }}>
                  {e.ai_summary}
                </div>
              )}
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
                {e.event_type && (
                  <Tag text={e.event_type.replace("_", " ")} color="rgba(200,169,110,0.15)" textColor="var(--gold2)" />
                )}
                {(e.sectors ?? []).slice(0, 3).map((s: string) => (
                  <Tag key={s} text={s} color="rgba(255,255,255,0.05)" textColor="rgba(232,226,217,0.4)" />
                ))}
                {(e.tickers ?? []).slice(0, 4).map((t: string) => (
                  <Tag key={t} text={t} color="rgba(78,202,153,0.1)" textColor="var(--signal-bull)" />
                ))}
                <span style={{ marginLeft: "auto", fontSize: "0.68rem", color: "rgba(232,226,217,0.25)" }}>
                  {new Date(e.published_at).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            </div>
          );
        })}
        {!events?.length && <Empty text="No events yet. The ingest cron runs daily at 8am UTC — or trigger it manually." />}
      </div>
    </div>
  );
}

function Tag({ text, color, textColor }: { text: string; color: string; textColor: string }) {
  return (
    <span style={{ fontSize: "0.65rem", background: color, color: textColor, padding: "0.15rem 0.45rem", borderRadius: 4, fontWeight: 500 }}>
      {text}
    </span>
  );
}

function PageHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ marginBottom: "1.5rem" }}>
      <h1 style={{ color: "var(--cream)", fontFamily: "serif", fontSize: "1.8rem", marginBottom: "0.25rem" }}>{title}</h1>
      <p style={{ color: "rgba(232,226,217,0.35)", fontSize: "0.82rem" }}>{sub}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div style={{ color: "rgba(232,226,217,0.25)", fontSize: "0.82rem", padding: "2rem 0", textAlign: "center" }}>{text}</div>;
}
