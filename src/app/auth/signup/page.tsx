"use client";
import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function SignupPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [done, setDone]         = useState(false);
  const [loading, setLoading]   = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: 'https://www.betteroption.com.au/auth/callback' },
    });
    if (error) { setError(error.message); setLoading(false); return; }
    setDone(true);
  }

  if (done) return (
    <AuthLayout title="Check your email">
      <p style={{ color: "rgba(232,226,217,0.6)", textAlign: "center", lineHeight: 1.7 }}>
        We sent a confirmation link to{" "}
        <strong style={{ color: "var(--gold)" }}>{email}</strong>.
        Click it to activate your account.
      </p>
    </AuthLayout>
  );

  return (
    <AuthLayout title="Create account">
      <form onSubmit={handleSignup} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <AuthInput label="Email"    type="email"    value={email}    onChange={setEmail} />
        <AuthInput label="Password" type="password" value={password} onChange={setPassword} />
        {error && <p style={{ color: "var(--signal-bear)", fontSize: "0.82rem" }}>{error}</p>}
        <AuthButton loading={loading} label="Create account" />
        <p style={{ textAlign: "center", fontSize: "0.82rem", color: "rgba(232,226,217,0.4)" }}>
          Already have an account?{" "}
          <a href="/auth/login" style={{ color: "var(--gold)" }}>Sign in</a>
        </p>
      </form>
    </AuthLayout>
  );
}

function AuthLayout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--navy)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 400, padding: "2rem", background: "var(--navy2)", borderRadius: 12, border: "1px solid var(--dash-border)" }}>
        <div style={{ fontFamily: "serif", fontWeight: 900, color: "var(--gold)", fontSize: "1.4rem", textAlign: "center", marginBottom: "1.5rem" }}>
          Quant IQ
        </div>
        <h1 style={{ color: "var(--cream)", fontSize: "1.2rem", fontWeight: 500, textAlign: "center", marginBottom: "1.5rem" }}>
          {title}
        </h1>
        {children}
      </div>
    </div>
  );
}

function AuthInput({ label, type, value, onChange }: { label: string; type: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label style={{ display: "block", fontSize: "0.75rem", color: "rgba(232,226,217,0.5)", marginBottom: "0.4rem", letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </label>
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
      {loading ? "Loading…" : label}
    </button>
  );
}
