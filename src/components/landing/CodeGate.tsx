'use client'
// src/components/landing/CodeGate.tsx — Terminal / Modern Dark
import { useState, useEffect } from 'react'

const ACCESS_CODE = '9460'
const STORAGE_KEY = 'qiq_access'

export default function CodeGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    if (sessionStorage.getItem(STORAGE_KEY) === 'true') setUnlocked(true)
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
      background: '#040608',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: "'DM Mono', monospace",
      // scanlines
      backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.03) 2px, rgba(0,0,0,0.03) 4px)',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 360,
        padding: '2.5rem 2rem',
        background: '#02030a',
        border: '1px solid #1a2030',
        textAlign: 'center',
      }}>
        {/* Logo */}
        <div style={{
          fontFamily: "'Syne', 'DM Sans', sans-serif",
          fontWeight: 500,
          color: '#4eff91',
          fontSize: '0.9rem',
          marginBottom: '0.3rem',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '0.4rem',
        }}>
          <span style={{
            width: 6, height: 6,
            borderRadius: '50%',
            background: '#4eff91',
            display: 'inline-block',
            animation: 'blink 1.2s step-end infinite',
          }} />
          Quant IQ
        </div>

        <div style={{
          fontFamily: "'DM Mono', monospace",
          fontSize: '0.6rem',
          color: '#2a3a50',
          letterSpacing: '0.2em',
          textTransform: 'uppercase',
          marginBottom: '2rem',
        }}>
          Early Access
        </div>

        <p style={{
          fontSize: '0.76rem',
          color: '#4a5568',
          marginBottom: '1.5rem',
          lineHeight: 1.65,
          fontWeight: 300,
        }}>
          Enter your access code to continue.
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <input
            type="text"
            value={code}
            onChange={e => { setCode(e.target.value); setError(false) }}
            placeholder="access_code"
            autoFocus
            style={{
              width: '100%',
              padding: '0.7rem 1rem',
              background: '#040608',
              border: `1px solid ${error ? '#ff4e6a' : '#1a2030'}`,
              color: '#eef0f4',
              fontFamily: "'DM Mono', monospace",
              fontSize: '0.88rem',
              textAlign: 'center',
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              outline: 'none',
              transition: 'border-color 0.15s',
            }}
          />
          {error && (
            <p style={{
              fontFamily: "'DM Mono', monospace",
              color: '#ff4e6a',
              fontSize: '0.68rem',
              margin: 0,
              letterSpacing: '0.06em',
            }}>
              error: invalid_access_code
            </p>
          )}
          <button
            type="submit"
            style={{
              width: '100%',
              padding: '0.7rem',
              background: '#4eff91',
              color: '#040608',
              fontFamily: "'DM Mono', monospace",
              fontWeight: 500,
              fontSize: '0.78rem',
              border: 'none',
              cursor: 'pointer',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              transition: 'background 0.15s',
            }}
          >
            ./enter
          </button>
        </form>
      </div>

      <style>{`@keyframes blink { 0%,100%{opacity:1}50%{opacity:0} }`}</style>
    </div>
  )
}
