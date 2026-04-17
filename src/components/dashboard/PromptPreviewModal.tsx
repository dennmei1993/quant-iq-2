'use client'
// src/components/dashboard/PromptPreviewModal.tsx
//
// Dev tool: shows the full assembled LLM prompt in an editable modal before it's sent.
// Only renders in development (or when DEV_TOOLS=true env var is set).
// Used in the portfolio builder strategy step.

import { useState, useEffect, useRef } from 'react'

interface Props {
  prompt:       string
  title?:       string
  description?: string
  onConfirm:    (editedPrompt: string) => void
  onCancel:     () => void
}

export function PromptPreviewModal({ prompt, title = 'LLM Prompt Preview', description, onConfirm, onCancel }: Props) {
  const [value,     setValue]     = useState(prompt)
  const [dirty,     setDirty]     = useState(false)
  const [lineCount, setLineCount] = useState(0)
  const [charCount, setCharCount] = useState(0)
  const [copyLabel, setCopyLabel] = useState('Copy')
  const [section,   setSection]   = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Parse sections from the prompt for the nav
  const sections = parseSections(value)

  useEffect(() => {
    setLineCount(value.split('\n').length)
    setCharCount(value.length)
    setDirty(value !== prompt)
  }, [value, prompt])

  function handleCopy() {
    navigator.clipboard.writeText(value)
    setCopyLabel('Copied!')
    setTimeout(() => setCopyLabel('Copy'), 2000)
  }

  function handleReset() {
    setValue(prompt)
    setDirty(false)
  }

  function jumpToSection(heading: string) {
    if (!textareaRef.current) return
    const idx = value.indexOf(heading)
    if (idx === -1) return
    const linesBefore = value.slice(0, idx).split('\n').length - 1
    // Approximate scroll position
    const lineHeight = 18
    textareaRef.current.scrollTop = linesBefore * lineHeight
    textareaRef.current.focus()
    textareaRef.current.setSelectionRange(idx, idx + heading.length)
    setSection(heading)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onCancel}
        style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(2px)' }}
      />

      {/* Modal */}
      <div style={{
        position: 'fixed', zIndex: 501,
        top: '3vh', left: '50%', transform: 'translateX(-50%)',
        width: 'min(1100px, 96vw)', height: '94vh',
        background: '#0a1628',
        border: '1px solid rgba(200,169,110,0.3)',
        borderRadius: 10,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 32px 80px rgba(0,0,0,0.8)',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
          <span style={{ fontSize: '0.58rem', background: 'rgba(252,92,101,0.15)', color: '#fc5c65', border: '1px solid rgba(252,92,101,0.3)', borderRadius: 4, padding: '0.1rem 0.5rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            DEV
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--cream)' }}>{title}</div>
            {description && <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.40)', marginTop: 1 }}>{description}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.62rem', fontFamily: 'monospace', color: 'rgba(232,226,217,0.35)' }}>
              {lineCount.toLocaleString()} lines · {charCount.toLocaleString()} chars
              {dirty && <span style={{ color: '#f0b429', marginLeft: 6 }}>● edited</span>}
            </span>
            <button onClick={handleCopy} style={btnStyle('rgba(99,179,237,0.15)', 'rgba(99,179,237,0.5)', '#63b3ed')}>
              {copyLabel}
            </button>
            {dirty && (
              <button onClick={handleReset} style={btnStyle('rgba(240,180,41,0.1)', 'rgba(240,180,41,0.4)', '#f0b429')}>
                Reset
              </button>
            )}
            <button onClick={onCancel} style={{ background: 'none', border: 'none', color: 'rgba(232,226,217,0.35)', cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1, padding: '0 4px' }}>×</button>
          </div>
        </div>

        {/* ── Body: nav + editor ── */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* Section nav */}
          <div style={{ width: 220, borderRight: '1px solid rgba(255,255,255,0.06)', padding: '0.75rem 0', overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.30)', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '0 0.85rem', marginBottom: '0.5rem' }}>
              Sections
            </div>
            {sections.length === 0 ? (
              <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.25)', padding: '0 0.85rem' }}>No sections detected</div>
            ) : (
              sections.map((s, i) => (
                <button key={i} onClick={() => jumpToSection(s.heading)}
                  style={{
                    width: '100%', textAlign: 'left', background: section === s.heading ? 'rgba(200,169,110,0.08)' : 'none',
                    border: 'none', borderLeft: `2px solid ${section === s.heading ? 'rgba(200,169,110,0.6)' : 'transparent'}`,
                    padding: '0.3rem 0.85rem', cursor: 'pointer', transition: 'all 0.1s',
                  }}>
                  <div style={{ fontSize: '0.65rem', color: section === s.heading ? 'var(--gold)' : 'rgba(232,226,217,0.55)', fontWeight: section === s.heading ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.label}
                  </div>
                  <div style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.25)', marginTop: 1 }}>line {s.line}</div>
                </button>
              ))
            )}

            {/* Diff summary if edited */}
            {dirty && (
              <div style={{ margin: '0.75rem 0.85rem 0', padding: '0.5rem', background: 'rgba(240,180,41,0.06)', border: '1px solid rgba(240,180,41,0.2)', borderRadius: 5 }}>
                <div style={{ fontSize: '0.58rem', color: '#f0b429', fontWeight: 600, marginBottom: 3 }}>Prompt edited</div>
                <div style={{ fontSize: '0.58rem', color: 'rgba(232,226,217,0.40)' }}>
                  {Math.abs(charCount - prompt.length)} chars {charCount > prompt.length ? 'added' : 'removed'}
                </div>
              </div>
            )}
          </div>

          {/* Editor */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => setValue(e.target.value)}
            spellCheck={false}
            style={{
              flex: 1,
              padding: '0.85rem 1rem',
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'rgba(232,226,217,0.85)',
              fontSize: '0.75rem',
              lineHeight: 1.7,
              fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", ui-monospace, monospace',
              resize: 'none',
              overflowY: 'auto',
              tabSize: 2,
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
          />
        </div>

        {/* ── Footer ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 1rem', borderTop: '1px solid rgba(255,255,255,0.07)', flexShrink: 0 }}>
          <div style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.35)' }}>
            {dirty
              ? 'Edited prompt will be sent instead of the original.'
              : 'Edit the prompt above to override what gets sent to the LLM.'}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={onCancel} style={btnStyle('transparent', 'rgba(255,255,255,0.12)', 'rgba(232,226,217,0.45)')}>
              Cancel
            </button>
            <button
              onClick={() => onConfirm(value)}
              style={btnStyle('rgba(200,169,110,0.15)', 'rgba(200,169,110,0.5)', 'var(--gold)', true)}
            >
              {dirty ? '✦ Send edited prompt' : '✦ Send prompt'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function btnStyle(bg: string, border: string, color: string, bold = false): React.CSSProperties {
  return {
    padding: '0.35rem 0.85rem',
    background: bg,
    border: `1px solid ${border}`,
    color,
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: '0.75rem',
    fontWeight: bold ? 700 : 400,
  }
}

// Parse section headings from the prompt text
// Looks for: === ... ===, ── ... ──, === ... ===
function parseSections(text: string): Array<{ heading: string; label: string; line: number }> {
  const lines   = text.split('\n')
  const results: Array<{ heading: string; label: string; line: number }> = []
  const seen    = new Set<string>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match === HEADING ===, ══ HEADING ══, ── HEADING ──
    const m = line.match(/^(?:={2,}|[═─]{2,})\s*(.+?)\s*(?:={2,}|[═─]{2,})$/)
    if (m) {
      const heading = line.trim()
      if (!seen.has(heading)) {
        seen.add(heading)
        // Clean label for display
        const label = m[1].replace(/[═─=]/g, '').trim()
        results.push({ heading, label, line: i + 1 })
      }
    }
  }

  return results
}
