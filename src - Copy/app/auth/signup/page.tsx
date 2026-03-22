// src/app/auth/signup/page.tsx
'use client'
import { useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import styles from '../auth.module.css'

function SignupForm() {
  const searchParams = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })

    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setDone(true)
    }
  }

  if (done) {
    return (
      <div className={styles.card}>
        <div className={styles.logo}><span className={styles.logoDot} />Quant IQ</div>
        <h1 className={styles.title}>Check your email</h1>
        <p className={styles.subtitle}>
          We sent a confirmation link to <strong>{email}</strong>.<br />
          Click it to activate your account, then{' '}
          <Link href="/auth/login" className={styles.link}>sign in</Link>.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.card}>
      <div className={styles.logo}><span className={styles.logoDot} />Quant IQ</div>
      <h1 className={styles.title}>Create your account</h1>
      <p className={styles.subtitle}>Free for 60 days · No credit card required</p>

      <form onSubmit={handleSignup} className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label}>Full name</label>
          <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
            placeholder="Jane Smith" required className={styles.input} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com" required className={styles.input} />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
            placeholder="Min 8 characters" minLength={8} required className={styles.input} />
        </div>

        {error && <div className={styles.error}>{error}</div>}

        <button type="submit" disabled={loading} className={styles.btn}>
          {loading ? 'Creating account…' : 'Get Free Access'}
        </button>
      </form>

      <p className={styles.footer}>
        Already have an account?{' '}
        <Link href="/auth/login" className={styles.link}>Sign in</Link>
      </p>
    </div>
  )
}

export default function SignupPage() {
  return (
    <div className={styles.container}>
      <Suspense fallback={<div />}>
        <SignupForm />
      </Suspense>
    </div>
  )
}
