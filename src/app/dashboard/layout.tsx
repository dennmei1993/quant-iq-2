import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: profileData } = await supabase
    .from("profiles")
    .select("email, full_name, plan")
    .eq("id", user.id)
    .single();

  const profile = profileData as { email: string | null; full_name: string | null; plan: string | null } | null;
  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--dash-bg)" }}>
      <DashboardSidebar
        user={{ email: profile?.email ?? user.email ?? "", fullName: profile?.full_name ?? null, plan: (profile?.plan ?? "free") as "free" | "pro" | "advisor" }}
      />
      <main style={{ flex: 1, padding: "2rem", overflowY: "auto" }}>
        {children}
      </main>
    </div>
  );
}

// Inline sidebar — replace with DashboardShell.tsx component when ready
function DashboardSidebar({ user }: { user: { email: string; fullName: string | null; plan: string } }) {
  const planColor = { free: "#888", pro: "#c8a96e", advisor: "#4eca99" }[user.plan] ?? "#888";
  return (
    <aside style={{
      width: 220, background: "var(--dash-sidebar)",
      borderRight: "1px solid var(--dash-border)",
      padding: "1.5rem 0", display: "flex", flexDirection: "column",
      position: "sticky", top: 0, height: "100vh"
    }}>
      <div style={{ padding: "0 1.2rem 1.5rem", borderBottom: "1px solid var(--dash-border)" }}>
        <div style={{ fontFamily: "'Syne', var(--font-sans)", fontWeight: 900, color: "var(--gold)", fontSize: "1.1rem" }}>
          Quant IQ
        </div>
      </div>
      <nav style={{ flex: 1, padding: "1rem 0" }}>
        {[
          { href: "/dashboard",           label: "Overview"       },
          { href: "/dashboard/events",    label: "Events"         },
          { href: "/dashboard/themes",    label: "Themes"         },
          { href: "/dashboard/assets",    label: "Screener"       },
          { href: "/dashboard/watchlist", label: "Watchlist"      },
          { href: "/dashboard/portfolio", label: "Portfolio"      },
          { href: "/dashboard/alerts",    label: "Alerts"         },
          { href: "/dashboard/profile", label: "Profile" },
          { href: "/dashboard/admin", label: "Admin" }
        ].map(({ href, label }, i) => (
          <div key={href}>
            {label === "Watchlist" && (
              <div style={{ height: 1, background: "rgba(200,169,110,0.1)", margin: "0.4rem 1.2rem" }} />
            )}
            <a href={href} style={{
              display: "block", padding: "0.5rem 1.2rem",
              color: "rgba(232,226,217,0.6)", fontSize: "0.85rem",
            }}>
              {label}
            </a>
          </div>
        ))}
      </nav>
      <div style={{ padding: "1rem 1.2rem", borderTop: "1px solid var(--dash-border)" }}>
        <div style={{ fontSize: "0.75rem", color: "rgba(232,226,217,0.4)" }}>
          {user.email}
        </div>
        <div style={{ fontSize: "0.65rem", color: planColor, textTransform: "uppercase", marginTop: "0.2rem" }}>
          {user.plan}
        </div>
        <a href="/api/auth/signout" style={{ fontSize: "0.75rem", color: "rgba(232,226,217,0.3)", marginTop: "0.5rem", display: "block" }}>
          Sign out
        </a>
      </div>
    </aside>
  );
}
