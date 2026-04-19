'use client'
// src/components/dashboard/TransactionHistory.tsx
// Inline expandable transaction log for a single ticker within a portfolio
// Shows buy/sell/dividend history with P&L per sell

import { useState, useEffect } from 'react'

interface Transaction {
  id:           string
  type:         'buy' | 'sell' | 'dividend' | 'deposit' | 'withdrawal' | 'split'
  quantity:     number | null
  price:        number | null
  total_amount: number
  fees:         number
  executed_at:  string
  notes:        string | null
}

interface Props {
  portfolioId: string
  ticker:      string
  avgCost:     number | null   // current avg cost — used to estimate realised gain on sells
  onDelete?:   () => void      // called after a transaction is deleted (to refresh parent)
}

const TYPE_COLOR: Record<string, string> = {
  buy:        'var(--signal-bull)',
  sell:       'var(--signal-bear)',
  dividend:   '#e0c97a',
  deposit:    'rgba(122,180,232,0.8)',
  withdrawal: 'rgba(232,180,122,0.8)',
  split:      'rgba(200,169,110,0.7)',
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function fmtCurrency(v: number) {
  return `$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function TransactionHistory({ portfolioId, ticker, avgCost, onDelete }: Props) {
  const [open,         setOpen]         = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading,      setLoading]      = useState(false)
  const [deleting,     setDeleting]     = useState<string | null>(null)
  const [fetched,      setFetched]      = useState(false)
  const [editTxn,      setEditTxn]      = useState<Transaction | null>(null)
  const [editQty,      setEditQty]      = useState('')
  const [editPrice,    setEditPrice]    = useState('')
  const [editDate,     setEditDate]     = useState('')
  const [editFees,     setEditFees]     = useState('')
  const [editNotes,    setEditNotes]    = useState('')
  const [editSaving,   setEditSaving]   = useState(false)
  const [editError,    setEditError]    = useState('')

  async function load() {
    if (fetched) return
    setLoading(true)
    try {
      const res  = await fetch(`/api/portfolio/transaction?portfolio_id=${portfolioId}&ticker=${ticker}&limit=50`)
      const data = await res.json()
      setTransactions(data.transactions ?? [])
      setFetched(true)
    } catch {}
    finally { setLoading(false) }
  }

  async function reload() {
    setLoading(true)
    try {
      const res  = await fetch(`/api/portfolio/transaction?portfolio_id=${portfolioId}&ticker=${ticker}&limit=50`)
      const data = await res.json()
      setTransactions(data.transactions ?? [])
    } catch {}
    finally { setLoading(false) }
  }

  function handleToggle() {
    if (!open && !fetched) load()
    setOpen(o => !o)
  }

  async function handleDelete(id: string) {
    setDeleting(id)
    try {
      const res = await fetch(`/api/portfolio/transaction?transaction_id=${id}`, { method: 'DELETE' })
      if (res.ok) {
        await reload()
        onDelete?.()
      }
    } catch {}
    finally { setDeleting(null) }
  }

  function openEdit(txn: Transaction) {
    setEditTxn(txn)
    setEditQty(txn.quantity != null ? String(txn.quantity) : '')
    setEditPrice(txn.price != null ? String(txn.price) : '')
    setEditDate(txn.executed_at.slice(0, 10))
    setEditFees(txn.fees > 0 ? String(txn.fees) : '')
    setEditNotes(txn.notes ?? '')
    setEditError('')
  }

  async function handleEdit() {
    if (!editTxn) return
    const qty   = parseFloat(editQty)
    const price = parseFloat(editPrice)
    if (isNaN(qty)   || qty   <= 0) { setEditError('Enter a valid quantity'); return }
    if (isNaN(price) || price <= 0) { setEditError('Enter a valid price');    return }
    setEditSaving(true); setEditError('')
    try {
      const res = await fetch(`/api/portfolio/transaction`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          transaction_id: editTxn.id,
          quantity:       qty,
          price,
          fees:           parseFloat(editFees) || 0,
          executed_at:    new Date(editDate).toISOString(),
          notes:          editNotes || null,
        }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? 'Failed')
      setEditTxn(null)
      await reload()
      onDelete?.()   // trigger parent refresh (holdings recalc)
    } catch (e: any) {
      setEditError(e.message ?? 'Failed')
    } finally {
      setEditSaving(false)
    }
  }

  // Compute running avg cost for gain calculation on sells
  let runningQty  = 0
  let runningCost = 0

  const enriched = [...transactions].reverse().map(txn => {
    let gainAmt: number | null = null

    if (txn.type === 'buy' && txn.quantity && txn.price) {
      runningCost += txn.quantity * txn.price + (txn.fees ?? 0)
      runningQty  += txn.quantity
    } else if (txn.type === 'sell' && txn.quantity && txn.price) {
      const avgAtTime = runningQty > 0 ? runningCost / runningQty : (avgCost ?? 0)
      gainAmt = (txn.price - avgAtTime) * txn.quantity - (txn.fees ?? 0)
      runningCost -= avgAtTime * txn.quantity
      runningQty  -= txn.quantity
      if (runningQty  < 0) runningQty  = 0
      if (runningCost < 0) runningCost = 0
    }
    return { ...txn, gainAmt }
  }).reverse()  // back to newest-first

  return (
    <>
    <div style={{ gridColumn: '1 / -1' }}>
      {/* Toggle row */}
      <button
        onClick={handleToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 6,
          background: 'none', border: 'none', cursor: 'pointer',
          padding: '0.3rem 0.85rem', borderTop: '1px solid rgba(255,255,255,0.04)',
        }}
      >
        <span style={{ fontSize: '0.55rem', color: 'rgba(232,226,217,0.35)', transition: 'color 0.15s' }}>
          {open ? '▼' : '▶'}
        </span>
        <span style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.38)', fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}>
          Transaction history
        </span>
        {fetched && transactions.length > 0 && (
          <span style={{ fontSize: '0.58rem', background: 'rgba(200,169,110,0.12)', color: 'rgba(200,169,110,0.65)', border: '1px solid rgba(200,169,110,0.2)', borderRadius: 8, padding: '0 5px' }}>
            {transactions.length}
          </span>
        )}
      </button>

      {/* History table */}
      {open && (
        <div style={{ padding: '0 0.85rem 0.6rem', background: 'rgba(0,0,0,0.15)' }}>
          {loading ? (
            <div style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.35)', padding: '0.5rem 0' }}>Loading…</div>
          ) : transactions.length === 0 ? (
            <div style={{ fontSize: '0.72rem', color: 'rgba(232,226,217,0.35)', padding: '0.5rem 0' }}>
              No transactions recorded. Use the B/S buttons on the holding row to add one.
            </div>
          ) : (
            <div style={{ marginTop: '0.4rem' }}>
              {/* Header */}
              <div style={{ display: 'grid', gridTemplateColumns: '60px 80px 70px 70px 70px 70px 1fr 40px', gap: '0.4rem', padding: '0.25rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', fontSize: '0.58rem', color: 'rgba(232,226,217,0.35)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                <span>Type</span>
                <span>Date</span>
                <span style={{ textAlign: 'right' }}>Qty</span>
                <span style={{ textAlign: 'right' }}>Price</span>
                <span style={{ textAlign: 'right' }}>Amount</span>
                <span style={{ textAlign: 'right' }}>Gain/Loss</span>
                <span>Notes</span>
                <span />
              </div>

              {/* Rows */}
              {enriched.map(txn => (
                <div key={txn.id} style={{ display: 'grid', gridTemplateColumns: '60px 80px 70px 70px 70px 70px 1fr 40px', gap: '0.4rem', padding: '0.3rem 0', borderBottom: '1px solid rgba(255,255,255,0.03)', alignItems: 'center' }}>

                  {/* Type badge */}
                  <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: TYPE_COLOR[txn.type] ?? 'rgba(232,226,217,0.5)', background: `${TYPE_COLOR[txn.type] ?? 'rgba(232,226,217,0.5)'}15`, padding: '0.1rem 0.4rem', borderRadius: 3, width: 'fit-content' }}>
                    {txn.type}
                  </span>

                  {/* Date */}
                  <span style={{ fontSize: '0.65rem', color: 'rgba(232,226,217,0.50)', fontFamily: 'var(--font-mono)' }}>
                    {fmtDate(txn.executed_at)}
                  </span>

                  {/* Qty */}
                  <span style={{ textAlign: 'right', fontSize: '0.68rem', color: 'rgba(232,226,217,0.65)', fontFamily: 'var(--font-mono)' }}>
                    {txn.quantity != null ? txn.quantity.toLocaleString() : '—'}
                  </span>

                  {/* Price */}
                  <span style={{ textAlign: 'right', fontSize: '0.68rem', color: 'rgba(232,226,217,0.65)', fontFamily: 'var(--font-mono)' }}>
                    {txn.price != null ? `$${Number(txn.price).toFixed(2)}` : '—'}
                  </span>

                  {/* Total amount */}
                  <span style={{ textAlign: 'right', fontSize: '0.68rem', color: 'rgba(232,226,217,0.65)', fontFamily: 'var(--font-mono)' }}>
                    {txn.type === 'sell' ? '-' : ''}{fmtCurrency(txn.total_amount)}
                  </span>

                  {/* Gain/Loss — only for sells */}
                  <span style={{ textAlign: 'right', fontSize: '0.68rem', fontFamily: 'var(--font-mono)', fontWeight: 600,
                    color: txn.gainAmt == null ? 'rgba(232,226,217,0.25)' : txn.gainAmt >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)' }}>
                    {txn.gainAmt != null
                      ? `${txn.gainAmt >= 0 ? '+' : '-'}${fmtCurrency(txn.gainAmt)}`
                      : txn.type === 'dividend' ? `+${fmtCurrency(txn.total_amount)}` : '—'}
                  </span>

                  {/* Notes */}
                  <span style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.35)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {txn.notes ?? (txn.fees > 0 ? `fee $${txn.fees}` : '')}
                  </span>

                  {/* Edit + Delete */}
                  <div style={{ display: 'flex', gap: 3, alignItems: 'center', justifyContent: 'flex-end' }}>
                    <button onClick={() => openEdit(txn)}
                      style={{ background: 'none', border: 'none', color: 'rgba(200,169,110,0.4)', cursor: 'pointer', fontSize: '0.7rem', padding: '0 2px', lineHeight: 1 }}
                      title="Edit transaction">✎</button>
                    <button onClick={() => handleDelete(txn.id)} disabled={deleting === txn.id}
                      style={{ background: 'none', border: 'none', color: 'rgba(232,226,217,0.20)', cursor: 'pointer', fontSize: '0.85rem', padding: '0 2px', lineHeight: 1, opacity: deleting === txn.id ? 0.4 : 1 }}
                      title="Delete transaction">×</button>
                  </div>
                </div>
              ))}

              {/* Summary row */}
              {transactions.length > 0 && (() => {
                const buys  = transactions.filter(t => t.type === 'buy')
                const sells = transactions.filter(t => t.type === 'sell')
                const divs  = transactions.filter(t => t.type === 'dividend')
                const totalBought = buys.reduce((s, t)  => s + Number(t.total_amount), 0)
                const totalSold   = sells.reduce((s, t) => s + Number(t.total_amount), 0)
                const totalDivs   = divs.reduce((s, t)  => s + Number(t.total_amount), 0)
                const totalGain   = enriched.reduce((s, t) => s + (t.gainAmt ?? 0), 0)
                return (
                  <div style={{ display: 'flex', gap: '1.5rem', padding: '0.5rem 0 0', marginTop: '0.2rem', borderTop: '1px solid rgba(255,255,255,0.06)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.40)' }}>
                      <span style={{ color: 'rgba(232,226,217,0.30)' }}>Total bought: </span>
                      <span style={{ color: 'rgba(232,226,217,0.65)', fontFamily: 'var(--font-mono)' }}>{fmtCurrency(totalBought)}</span>
                    </span>
                    {totalSold > 0 && (
                      <span style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.40)' }}>
                        <span style={{ color: 'rgba(232,226,217,0.30)' }}>Total sold: </span>
                        <span style={{ color: 'rgba(232,226,217,0.65)', fontFamily: 'var(--font-mono)' }}>{fmtCurrency(totalSold)}</span>
                      </span>
                    )}
                    {totalDivs > 0 && (
                      <span style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.40)' }}>
                        <span style={{ color: 'rgba(232,226,217,0.30)' }}>Dividends: </span>
                        <span style={{ color: '#e0c97a', fontFamily: 'var(--font-mono)' }}>+{fmtCurrency(totalDivs)}</span>
                      </span>
                    )}
                    {sells.length > 0 && (
                      <span style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.40)' }}>
                        <span style={{ color: 'rgba(232,226,217,0.30)' }}>Realised: </span>
                        <span style={{ color: totalGain >= 0 ? 'var(--signal-bull)' : 'var(--signal-bear)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {totalGain >= 0 ? '+' : '-'}{fmtCurrency(totalGain)}
                        </span>
                      </span>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </div>
      )}
    </div>

    {/* ── Edit transaction modal ── */}
    {editTxn && (
      <>
        <div onClick={() => setEditTxn(null)} style={{ position: 'fixed', inset: 0, zIndex: 400, background: 'rgba(0,0,0,0.6)' }} />
        <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 401, background: 'var(--navy2)', border: '1px solid var(--dash-border)', borderRadius: 8, padding: '1.3rem', width: 360, boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.6rem', color: 'rgba(232,226,217,0.40)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 3 }}>Edit Transaction</div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-mono)' }}>
                {editTxn.type.toUpperCase()} · {ticker}
              </div>
            </div>
            <button onClick={() => setEditTxn(null)} style={{ background: 'none', border: 'none', color: 'rgba(232,226,217,0.35)', cursor: 'pointer', fontSize: '1.2rem', lineHeight: 1 }}>×</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginBottom: '0.9rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <div>
                <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Quantity</div>
                <input value={editQty} onChange={e => setEditQty(e.target.value)} type="number"
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: 'var(--cream)', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
              <div>
                <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Price ($)</div>
                <input value={editPrice} onChange={e => setEditPrice(e.target.value)} type="number"
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: 'var(--cream)', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <div>
                <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Date</div>
                <input value={editDate} onChange={e => setEditDate(e.target.value)} type="date"
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: 'var(--cream)', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
              <div>
                <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Fees ($)</div>
                <input value={editFees} onChange={e => setEditFees(e.target.value)} type="number" placeholder="0.00"
                  style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: 'var(--cream)', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' as const }} />
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.62rem', color: 'rgba(232,226,217,0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Notes</div>
              <input value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Optional"
                style={{ width: '100%', padding: '0.4rem 0.6rem', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: 'var(--cream)', fontSize: '0.82rem', outline: 'none', boxSizing: 'border-box' as const }} />
            </div>
          </div>

          {editError && <div style={{ fontSize: '0.72rem', color: '#fc5c65', marginBottom: '0.7rem' }}>{editError}</div>}

          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <button onClick={() => setEditTxn(null)} style={{ padding: '0.4rem 0.9rem', background: 'transparent', border: '1px solid rgba(255,255,255,0.08)', color: 'rgba(232,226,217,0.40)', borderRadius: 6, cursor: 'pointer', fontSize: '0.78rem' }}>
              Cancel
            </button>
            <button onClick={handleEdit} disabled={editSaving} style={{ padding: '0.4rem 1rem', background: 'rgba(200,169,110,0.12)', border: '1px solid rgba(200,169,110,0.35)', color: 'var(--gold)', fontWeight: 700, borderRadius: 6, cursor: editSaving ? 'not-allowed' : 'pointer', fontSize: '0.78rem', opacity: editSaving ? 0.6 : 1 }}>
              {editSaving ? '…' : 'Save changes'}
            </button>
          </div>
        </div>
      </>
    )}
    </>
  )
}
