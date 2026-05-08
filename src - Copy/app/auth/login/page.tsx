"use client";
// app/auth/login/page.tsx
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail]     = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]     = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    // Use router.push + refresh so Next.js middleware picks up the new session cookie
    window.location.href = "/dashboard";
  }

  return (
    <AuthLayout title="Sign in">
      <form onSubmit={handleLogin} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <AuthInput label="Email" type="email" value={email} onChange={setEmail} />
        <AuthInput label="Password" type="password" value={password} onChange={setPassword} />
        {error && <div style={{ color: "var(--signal-bear)", fontSize: "0.82rem" }}>{error}</div>}
        <AuthButton loading={loading} label="Sign in" />
        <div style={{ textAlign: "center", fontSize: "0.82rem", color: "rgba(232,226,217,0.4)" }}>
          No account? <a href="/auth/signup" style={{ color: "var(--gold)" }}>Sign up</a>
        </div>
      </form>
    </AuthLayout>
  );
}

// ── Shared auth UI ────────────────────────────────────────────────────────────

function AuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--navy)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: "2rem", background: "var(--navy2)", borderRadius: 12, border: "1px solid var(--dash-border)" }}>
        <div style={{ fontFamily: "serif", fontWeight: 900, color: "var(--gold)", fontSize: "1.4rem", textAlign: "center", marginBottom: "1.5rem" }}>
          Quant IQ
        </div>
        <h1 style={{ color: "var(--cream)", fontSize: "1.2rem", fontWeight: 500, textAlign: "center", marginBottom: "1.5rem" }}>{title}</h1>
        {children}
      </div>
    </div>
  );
}

function AuthInput({ label, type, value, onChange }: { label: string; type: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.75rem", color: "rgba(232,226,217,0.5)", marginBottom: "0.4rem", letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</label>
      <input
        type={type} value={value} onChange={e => onChange(e.target.value)} required
        style={{ width: "100%", padding: "0.65rem 0.9rem", background: "rgba(255,255,255,0.05)", border: "1px solid var(--dash-border)", borderRadius: 6, color: "var(--cream)", fontSize: "0.9rem", outline: "none" }}
      />
    </div>
  );
}

function AuthButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button type="submit" disabled={loading}
      style={{ width: "100%", padding: "0.75rem", background: "var(--gold)", color: "var(--navy)", fontWeight: 700, fontSize: "0.9rem", borderRadius: 6, border: "none", opacity: loading ? 0.6 : 1 }}>
      {loading ? "Loading..." : label}
    </button>
  );
}
