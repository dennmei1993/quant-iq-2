'use client'
import { useState, useEffect } from 'react'
import styles from './landing.module.css'

const ACCESS_CODE = '9460'  // ← change this to whatever you want
const STORAGE_KEY = 'qiq_access'

export default function CodeGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Remember unlocked state in sessionStorage
    if (sessionStorage.getItem(STORAGE_KEY) === 'true') {
      setUnlocked(true)
    }
    setChecking(false)
  }, [])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (code.trim().toUpperCase() === ACCESS_CODE) {
      sessionStorage.setItem(STORAGE_KEY, 'true')
      setUnlocked(true)
    } else {
      setError(true)
      setCode('')
    }
  }

  if (checking) return null

  if (unlocked) return <>{children}</>

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0f1c2e',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 380,
        padding: '2.5rem',
        background: '#162438',
        borderRadius: 12,
        border: '1px solid rgba(200,169,110,0.12)',
        textAlign: 'center',
      }}>
        {/* Logo */}
        <div style={{
          fontFamily: 'serif',
          fontWeight: 900,
          color: '#c8a96e',
          fontSize: '1.5rem',
          marginBottom: '0.4rem',
        }}>
          Quant IQ
        </div>
        <div style={{
          fontSize: '0.72rem',
          color: 'rgba(200,169,110,0.4)',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          marginBottom: '2rem',
        }}>
          Early Access
        </div>

        <p style={{
          fontSize: '0.85rem',
          color: 'rgba(232,226,217,0.5)',
          marginBottom: '1.5rem',
          lineHeight: 1.6,
        }}>
          Enter your access code to continue.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <input
            type="text"
            value={code}
            onChange={e => { setCode(e.target.value); setError(false) }}
            placeholder="Access code"
            autoFocus
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${error ? '#b84c2e' : 'rgba(200,169,110,0.15)'}`,
              borderRadius: 6,
              color: '#f5f0e8',
              fontSize: '1rem',
              textAlign: 'center',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              outline: 'none',
            }}
          />
          {error && (
            <p style={{ color: '#e87070', fontSize: '0.78rem', margin: 0 }}>
              Invalid code — please try again.
            </p>
          )}
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '0.75rem',
              background: '#c8a96e',
              color: '#0f1c2e',
              fontWeight: 700,
              fontSize: '0.9rem',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Enter
          </button>
        </form>
      </div>
    </div>
  )
}