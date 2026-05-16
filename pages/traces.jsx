import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'

const PIPELINE_LAYERS = [
  { key: 'classification', label: 'CASCADE', icon: '▸', desc: 'Classification' },
  { key: 'confidence',     label: 'Confidence', icon: '≈', desc: 'Score', fmt: v => typeof v === 'number' ? v.toFixed(3) : v },
  { key: 'matchedRules',  label: 'Rules', icon: '⊞', desc: 'Matched', fmt: v => Array.isArray(v) ? v.join(', ') || '—' : v },
  { key: 'hypotheses',    label: 'KILO', icon: '⊕', desc: 'Hypotheses', fmt: v => Array.isArray(v) ? v.join(' · ') || '—' : v },
  { key: 'policyDecision',label: 'ProtoForge', icon: '⊛', desc: 'Decision' },
]

function DriftBadge({ detected, fields }) {
  if (!detected) return <span style={{ color: '#22c55e', fontSize: 11, fontWeight: 600 }}>✓ DETERMINISTIC</span>
  return <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 600 }}>⚠ DRIFT — {fields.join(' · ')}</span>
}

function PipelineTimeline({ output, label, driftFields = [] }) {
  return (
    <div>
      <div style={{ color: '#6b7280', fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>{label}</div>
      <div style={{ borderLeft: '2px solid #1f2937', paddingLeft: 12 }}>
        {PIPELINE_LAYERS.map(layer => {
          const raw = output?.[layer.key]
          const val = layer.fmt ? layer.fmt(raw) : (Array.isArray(raw) ? raw.join(', ') || '—' : String(raw ?? '—'))
          const drifted = driftFields.some(f => f.startsWith(layer.key))
          return (
            <div key={layer.key} style={{ display: 'flex', gap: 8, padding: '5px 0', borderBottom: '1px solid #111' }}>
              <span style={{ color: '#374151', width: 16, flexShrink: 0, fontFamily: 'monospace' }}>{layer.icon}</span>
              <span style={{ color: '#4b5563', width: 88, flexShrink: 0, fontSize: 11 }}>{layer.label}</span>
              <span style={{
                color: drifted ? '#fbbf24' : '#9ca3af',
                fontSize: 12,
                fontFamily: 'monospace',
                wordBreak: 'break-all',
              }}>{val}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EventCard({ eventId, isSelected, hasDrift, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: isSelected ? '#1e1b4b' : hasDrift ? '#1c0a0a' : '#111827',
        border: `1px solid ${isSelected ? '#6366f1' : hasDrift ? '#7f1d1d' : '#1f2937'}`,
        borderRadius: 4,
        color: hasDrift ? '#fca5a5' : '#9ca3af',
        padding: '6px 10px',
        fontSize: 11,
        cursor: 'pointer',
        fontFamily: 'monospace',
        textAlign: 'left',
        width: '100%',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <span>{eventId.slice(0, 24)}…</span>
      {hasDrift && <span style={{ color: '#ef4444' }}>⚠</span>}
    </button>
  )
}

export default function TracesPage() {
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [replayResult, setReplayResult] = useState(null)
  const [replaying, setReplaying] = useState(false)
  const [sampleSize, setSampleSize] = useState(20)
  const [eventInput, setEventInput] = useState('')

  const fetchReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/traces?sample=${sampleSize}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setReport(await res.json())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [sampleSize])

  useEffect(() => { fetchReport() }, [fetchReport])

  const replayEvent = async (eventId) => {
    if (!eventId) return
    setSelected(eventId)
    setReplaying(true)
    setReplayResult(null)
    try {
      const res = await fetch('/api/traces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventId }),
      })
      setReplayResult(await res.json())
    } catch (e) {
      setReplayResult({ error: e.message })
    } finally {
      setReplaying(false)
    }
  }

  const deterRate = report?.deterministicRate ?? 1
  const rateColor = deterRate >= 0.99 ? '#22c55e' : deterRate >= 0.95 ? '#fbbf24' : '#ef4444'

  return (
    <>
      <Head><title>HEIDI V2 — Trace Debugger</title></Head>
      <div style={{ background: '#050505', minHeight: '100vh', color: '#e2e8f0', fontFamily: 'monospace', padding: 24 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>

          {/* Header */}
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 18, fontWeight: 700, color: '#a78bfa', margin: 0, letterSpacing: 1 }}>⟳ HEIDI V2 — TRACE DEBUGGER</h1>
            <p style={{ color: '#4b5563', margin: '4px 0 0', fontSize: 12 }}>
              RAW LEDGER → CASCADE → KILO → ProtoForge — replay any event and watch the reasoning timeline
            </p>
          </div>

          {/* Determinism bar */}
          {report && (
            <div style={{ background: '#0a0a0a', borderRadius: 6, padding: 16, marginBottom: 20, border: '1px solid #1f2937' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: '#6b7280', fontSize: 11, letterSpacing: 2 }}>DETERMINISM RATE</span>
                <span style={{ color: rateColor, fontWeight: 700, fontSize: 14 }}>{(deterRate * 100).toFixed(2)}%</span>
              </div>
              <div style={{ background: '#1f2937', borderRadius: 3, height: 4 }}>
                <div style={{ background: rateColor, height: '100%', width: `${deterRate * 100}%`, borderRadius: 3, transition: 'width 0.6s ease' }} />
              </div>
              <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 11, color: '#6b7280' }}>
                <span>Sampled <b style={{ color: '#d1d5db' }}>{report.totalEvents}</b></span>
                <span>✓ Deterministic <b style={{ color: '#22c55e' }}>{report.deterministicCount}</b></span>
                <span>⚠ Drift <b style={{ color: report.driftCount > 0 ? '#ef4444' : '#6b7280' }}>{report.driftCount}</b></span>
                <span style={{ marginLeft: 'auto', color: '#374151' }}>{report.generatedAt ? new Date(report.generatedAt).toLocaleTimeString() : ''}</span>
              </div>
            </div>
          )}

          {/* Controls */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
            <select
              value={sampleSize}
              onChange={e => setSampleSize(Number(e.target.value))}
              style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 4, color: '#9ca3af', padding: '5px 8px', fontSize: 12 }}
            >
              {[10, 20, 50, 100].map(n => <option key={n} value={n}>Last {n} events</option>)}
            </select>
            <button onClick={fetchReport} disabled={loading}
              style={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 4, color: '#9ca3af', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
            >
              {loading ? '...' : '↺ Refresh'}
            </button>
            <div style={{ flex: 1, display: 'flex', gap: 6 }}>
              <input
                value={eventInput}
                onChange={e => setEventInput(e.target.value)}
                placeholder="Paste event ID to replay…"
                style={{ flex: 1, background: '#111827', border: '1px solid #1f2937', borderRadius: 4, color: '#d1d5db', padding: '5px 10px', fontSize: 12 }}
                onKeyDown={e => e.key === 'Enter' && replayEvent(eventInput.trim())}
              />
              <button
                onClick={() => replayEvent(eventInput.trim())}
                disabled={!eventInput.trim() || replaying}
                style={{ background: '#1e1b4b', border: '1px solid #4338ca', borderRadius: 4, color: '#a5b4fc', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
              >
                Replay
              </button>
            </div>
          </div>

          {error && <div style={{ color: '#ef4444', marginBottom: 16, fontSize: 12 }}>Error: {error}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 16 }}>

            {/* Event sidebar */}
            <div>
              {report?.driftEvents?.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ color: '#6b7280', fontSize: 10, letterSpacing: 2, marginBottom: 6 }}>DRIFTED EVENTS</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {report.driftEvents.map(id => (
                      <EventCard key={id} eventId={id} isSelected={selected === id} hasDrift onClick={() => replayEvent(id)} />
                    ))}
                  </div>
                </div>
              )}
              {report && report.driftCount === 0 && (
                <div style={{ color: '#22c55e', fontSize: 12, padding: 12, border: '1px solid #14532d', borderRadius: 6, background: '#052e16' }}>
                  ✓ All {report.totalEvents} sampled events are deterministic
                </div>
              )}
            </div>

            {/* Trace detail */}
            <div>
              {replaying && (
                <div style={{ color: '#6b7280', fontSize: 12, padding: 20 }}>Replaying event through pipeline…</div>
              )}
              {replayResult && !replaying && !replayResult.error && (
                <div style={{ background: '#0a0a0a', borderRadius: 6, padding: 20, border: '1px solid #1f2937' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span style={{ color: '#4b5563', fontSize: 10 }}>EVENT ID</span>
                    <DriftBadge detected={replayResult.driftDetected} fields={replayResult.driftFields} />
                  </div>
                  <div style={{ color: '#6366f1', fontSize: 11, marginBottom: 20, wordBreak: 'break-all' }}>{replayResult.eventId}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    <PipelineTimeline output={replayResult.originalOutput} label="ORIGINAL" driftFields={replayResult.driftFields} />
                    <PipelineTimeline output={replayResult.replayOutput} label="REPLAY" driftFields={replayResult.driftFields} />
                  </div>
                  <div style={{ marginTop: 16, fontSize: 10, color: '#374151' }}>Replayed at {new Date(replayResult.replayedAt).toLocaleString()}</div>
                </div>
              )}
              {replayResult?.error && (
                <div style={{ color: '#ef4444', fontSize: 12, padding: 16, border: '1px solid #7f1d1d', borderRadius: 6 }}>
                  {replayResult.error}
                </div>
              )}
              {!replayResult && !replaying && (
                <div style={{ color: '#1f2937', fontSize: 13, padding: 40, textAlign: 'center', border: '1px dashed #1f2937', borderRadius: 6 }}>
                  Select a drifted event or paste an event ID above to replay it through the pipeline
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
