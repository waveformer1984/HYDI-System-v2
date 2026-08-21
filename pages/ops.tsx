import { useState, useEffect, useRef, useCallback, FormEvent, KeyboardEvent } from 'react'
import Head from 'next/head'

// ─── Types ──────────────────────────────────────────────────────────────

interface StatusData {
  model_status: { consecutiveFailures: number; circuitBreakerActive: boolean }
  memory_connected: boolean
  allowed_actions: string[]
  cognitiveCore: {
    initialized: boolean
    instanceId: string | null
    cycleCount: number
    capabilitySummary: { total: number; available: number; unavailable: number } | null
    currentPhase: string | null
    autonomyLevel: number | null
  }
  cognitiveLoop: {
    state: string
    running: boolean
    cycleCount: number
    killSwitchActive: boolean
    currentIntervalMs: number
  } | null
  revenueDashboard: {
    available: boolean
    error: string | null
    prospects: number
    qualifiedProspects: number
    opportunities: number
    pipelineValueCents: number
    customers: number
    verifiedRevenueCents: number
    payments: number
  }
  commercialState: {
    discovery: { state: string; blocker: string | null }
    email: { state: string; blocker: string | null }
    stripe: { state: string; blocker: string | null }
    sms: { state: string; blocker: string | null }
    autonomyLevel: number
  }
  capabilityHealth: {
    available: boolean
    error: string | null
    summary: {
      total: number; ready: number; blocked: number; unavailable: number; unknown: number
    }
    readyCapabilities: CapReport[]
    blockedCapabilities: CapReport[]
  }
  daemonStatus: {
    running: boolean
    pid: number | null
    startedAt: string | null
    selfSufficiencyCycles: number
    lastSelfSufficiencyCycle: string | null
    lastCapabilityHealth: { total: number; ready: number; blocked: number; unavailable: number } | null
    lastSelfRepairResult: { totalIssues: number; repaired: number; escalated: number; workedAround: number; refused: number } | null
    error: string | null
  }
}

interface CapReport {
  capabilityId: string
  description: string
  state: string
  evidence: string
  failureClassification: string | null
  repairability: string | null
  requiredCredentials: string[]
}

interface AuditEntry {
  id: string | number
  event_type: string
  division: string | null
  payload: unknown
  verdict: string | null
  created_at: string
  source: string
}

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

type Tab = 'status' | 'audit' | 'autonomy' | 'memory' | 'chat'

// ─── Page ───────────────────────────────────────────────────────────────

export default function OpsPage() {
  const [tab, setTab] = useState<Tab>('status')
  const [status, setStatus] = useState<StatusData | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [auditSource, setAuditSource] = useState<'heidi_events' | 'daemon'>('heidi_events')
  const [lastFetch, setLastFetch] = useState<string>('')

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setStatus(data)
      setStatusError(null)
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unknown error')
    }
    setLastFetch(new Date().toISOString())
  }, [])

  const fetchAudit = useCallback(async (source: 'heidi_events' | 'daemon') => {
    try {
      const res = await fetch(`/api/audit?source=${source}&limit=30`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setAuditEntries(data.entries || [])
    } catch {
      setAuditEntries([])
    }
  }, [])

  // Poll status every 5 seconds
  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 5000)
    return () => clearInterval(interval)
  }, [fetchStatus])

  // Fetch audit when tab or source changes
  useEffect(() => {
    if (tab === 'audit') {
      fetchAudit(auditSource)
      const interval = setInterval(() => fetchAudit(auditSource), 5000)
      return () => clearInterval(interval)
    }
  }, [tab, auditSource, fetchAudit])

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0f0f17] text-gray-100">
      <Head>
        <title>HEIDI Operations</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-[#0f0f17]/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-sm font-bold">
            H
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">HEIDI Operations</h1>
            <p className="text-[11px] text-gray-500">
              {status?.daemonStatus?.running ? `daemon PID ${status.daemonStatus.pid} · ${status.daemonStatus.selfSufficiencyCycles} cycles` : 'daemon offline'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className={`w-1.5 h-1.5 rounded-full ${status?.daemonStatus?.running ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {status?.daemonStatus?.running ? 'Online' : 'Offline'}
          </span>
          <span className="text-[10px] text-gray-700">{lastFetch ? new Date(lastFetch).toLocaleTimeString() : ''}</span>
        </div>
      </header>

      {/* Tab bar */}
      <nav className="flex gap-1 px-5 py-2 border-b border-white/[0.06] bg-[#0f0f17]/60">
        {([
          ['status', 'System Status'],
          ['audit', 'Activity / Audit'],
          ['autonomy', 'Autonomy'],
          ['memory', 'Memory'],
          ['chat', 'Chat'],
        ] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              tab === id
                ? 'bg-violet-600/20 text-violet-300 border border-violet-500/20'
                : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04] border border-transparent'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto chat-scroll">
        <div className="max-w-5xl mx-auto px-4 py-6">
          {statusError && (
            <div className="mb-4 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              Status fetch error: {statusError}
            </div>
          )}

          {tab === 'status' && <StatusPanel status={status} />}
          {tab === 'audit' && (
            <AuditPanel
              entries={auditEntries}
              source={auditSource}
              onSourceChange={setAuditSource}
            />
          )}
          {tab === 'autonomy' && <AutonomyPanel status={status} />}
          {tab === 'memory' && <MemoryPanel status={status} />}
          {tab === 'chat' && <ChatPanel />}
        </div>
      </div>
    </div>
  )
}

// ─── Status Panel ────────────────────────────────────────────────────────

function StatusPanel({ status }: { status: StatusData | null }) {
  if (!status) return <div className="text-gray-600 text-sm">Loading...</div>

  const d = status.daemonStatus
  const ch = status.capabilityHealth
  const rd = status.revenueDashboard
  const cs = status.commercialState

  return (
    <div className="space-y-6">
      {/* Daemon */}
      <Section title="Daemon">
        <DataRow label="Running" value={d?.running ? 'YES' : 'NO'} good={d?.running} />
        <DataRow label="PID" value={d?.pid?.toString() || '—'} />
        <DataRow label="Started" value={d?.startedAt ? new Date(d.startedAt).toLocaleString() : '—'} />
        <DataRow
          label="Uptime"
          value={d?.startedAt ? formatUptime(d.startedAt) : '—'}
        />
        <DataRow label="Self-sufficiency cycles" value={d?.selfSufficiencyCycles?.toString() || '0'} />
        <DataRow label="Last cycle" value={d?.lastSelfSufficiencyCycle ? new Date(d.lastSelfSufficiencyCycle).toLocaleString() : '—'} />
        <DataRow label="Error" value={d?.error || 'none'} good={!d?.error} />
      </Section>

      {/* Last self-repair result */}
      {d?.lastSelfRepairResult && (
        <Section title="Last Self-Repair Cycle">
          <DataRow label="Total issues" value={d.lastSelfRepairResult.totalIssues.toString()} />
          <DataRow label="Repaired" value={d.lastSelfRepairResult.repaired.toString()} good={d.lastSelfRepairResult.repaired > 0} />
          <DataRow label="Worked around" value={d.lastSelfRepairResult.workedAround.toString()} />
          <DataRow label="Escalated" value={d.lastSelfRepairResult.escalated.toString()} bad={d.lastSelfRepairResult.escalated > 0} />
          <DataRow label="Refused" value={d.lastSelfRepairResult.refused.toString()} bad={d.lastSelfRepairResult.refused > 0} />
        </Section>
      )}

      {/* Capability Health */}
      <Section title="Capability Health">
        {ch?.available ? (
          <>
            <DataRow label="Total" value={ch.summary.total.toString()} />
            <DataRow label="Ready" value={ch.summary.ready.toString()} good={ch.summary.ready > 0} />
            <DataRow label="Blocked" value={ch.summary.blocked.toString()} bad={ch.summary.blocked > 0} />
            <DataRow label="Unavailable" value={ch.summary.unavailable.toString()} bad={ch.summary.unavailable > 0} />
            <div className="pt-3 space-y-2">
              {ch.readyCapabilities.map(cap => (
                <CapabilityRow key={cap.capabilityId} cap={cap} />
              ))}
              {ch.blockedCapabilities.map(cap => (
                <CapabilityRow key={cap.capabilityId} cap={cap} />
              ))}
            </div>
          </>
        ) : (
          <div className="text-xs text-red-400">{ch?.error || 'Capability health unavailable'}</div>
        )}
      </Section>

      {/* Revenue Dashboard */}
      <Section title="Revenue Dashboard">
        {rd?.available ? (
          <>
            <DataRow label="Prospects" value={rd.prospects.toString()} />
            <DataRow label="Qualified" value={rd.qualifiedProspects.toString()} />
            <DataRow label="Opportunities" value={rd.opportunities.toString()} />
            <DataRow label="Pipeline value" value={formatCents(rd.pipelineValueCents)} />
            <DataRow label="Customers" value={rd.customers.toString()} />
            <DataRow label="Verified revenue" value={formatCents(rd.verifiedRevenueCents)} good={rd.verifiedRevenueCents > 0} />
            <DataRow label="Payments" value={rd.payments.toString()} />
          </>
        ) : (
          <div className="text-xs text-red-400">{rd?.error || 'Revenue dashboard unavailable'}</div>
        )}
      </Section>

      {/* Commercial State */}
      {cs && (
        <Section title="Commercial Capabilities">
          <CommercialRow name="Discovery" state={cs.discovery.state} blocker={cs.discovery.blocker} />
          <CommercialRow name="Email" state={cs.email.state} blocker={cs.email.blocker} />
          <CommercialRow name="Stripe" state={cs.stripe.state} blocker={cs.stripe.blocker} />
          <CommercialRow name="SMS" state={cs.sms.state} blocker={cs.sms.blocker} />
        </Section>
      )}
    </div>
  )
}

// ─── Audit Panel ─────────────────────────────────────────────────────────

function AuditPanel({
  entries,
  source,
  onSourceChange,
}: {
  entries: AuditEntry[]
  source: 'heidi_events' | 'daemon'
  onSourceChange: (s: 'heidi_events' | 'daemon') => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button
          onClick={() => onSourceChange('heidi_events')}
          className={`px-3 py-1 text-xs rounded-lg transition-colors ${
            source === 'heidi_events'
              ? 'bg-violet-600/20 text-violet-300 border border-violet-500/20'
              : 'text-gray-500 hover:text-gray-300 bg-white/[0.04] border border-white/[0.06]'
          }`}
        >
          heidi_events (DB)
        </button>
        <button
          onClick={() => onSourceChange('daemon')}
          className={`px-3 py-1 text-xs rounded-lg transition-colors ${
            source === 'daemon'
              ? 'bg-violet-600/20 text-violet-300 border border-violet-500/20'
              : 'text-gray-500 hover:text-gray-300 bg-white/[0.04] border border-white/[0.06]'
          }`}
        >
          daemon audit log
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="text-gray-600 text-sm">No entries.</div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry, i) => (
            <AuditRow key={`${entry.id}-${i}`} entry={entry} />
          ))}
        </div>
      )}
    </div>
  )
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const [expanded, setExpanded] = useState(false)
  const payloadStr = JSON.stringify(entry.payload, null, 2)
  const isShort = payloadStr.length < 200

  return (
    <div
      className="bg-white/[0.02] border border-white/[0.04] rounded-lg px-3 py-2 cursor-pointer hover:bg-white/[0.04] transition-colors"
      onClick={() => !isShort && setExpanded(!expanded)}
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="font-mono text-violet-400/80">{entry.event_type}</span>
        {entry.verdict && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
            entry.verdict === 'success' || entry.verdict === 'repaired'
              ? 'bg-emerald-400/10 text-emerald-400/80'
              : entry.verdict === 'fail' || entry.verdict === 'error'
              ? 'bg-red-400/10 text-red-400/80'
              : 'bg-white/[0.04] text-gray-500'
          }`}>
            {entry.verdict}
          </span>
        )}
        <span className="text-gray-600 ml-auto text-[10px]">
          {new Date(entry.created_at).toLocaleString()}
        </span>
      </div>
      {isShort ? (
        <pre className="text-[11px] text-gray-500 mt-1 font-mono whitespace-pre-wrap">{payloadStr}</pre>
      ) : expanded ? (
        <pre className="text-[11px] text-gray-500 mt-1 font-mono whitespace-pre-wrap overflow-x-auto">{payloadStr}</pre>
      ) : (
        <pre className="text-[11px] text-gray-600 mt-1 font-mono whitespace-pre-wrap truncate">{payloadStr}</pre>
      )}
    </div>
  )
}

// ─── Autonomy Panel ──────────────────────────────────────────────────────

function AutonomyPanel({ status }: { status: StatusData | null }) {
  const [loopAction, setLoopAction] = useState<string | null>(null)
  const [loopResult, setLoopResult] = useState<string | null>(null)

  const sendLoopAction = async (action: string) => {
    setLoopAction(action)
    setLoopResult(null)
    try {
      const res = await fetch(`/api/cognitive?action=${action}`, { method: 'POST' })
      const data = await res.json()
      setLoopResult(data.message || JSON.stringify(data))
    } catch (err) {
      setLoopResult(`Error: ${err instanceof Error ? err.message : 'unknown'}`)
    }
    setTimeout(() => { setLoopAction(null); setLoopResult(null) }, 5000)
  }

  if (!status) return <div className="text-gray-600 text-sm">Loading...</div>

  const loop = status.cognitiveLoop
  const cc = status.cognitiveCore

  return (
    <div className="space-y-6">
      <Section title="Cognitive Core">
        <DataRow label="Initialized" value={cc?.initialized ? 'YES' : 'NO'} good={cc?.initialized} />
        <DataRow label="Instance ID" value={cc?.instanceId || '—'} />
        <DataRow label="Cycle count" value={cc?.cycleCount?.toString() || '0'} />
        {cc?.capabilitySummary && (
          <>
            <DataRow label="Capabilities" value={`${cc.capabilitySummary.total} total, ${cc.capabilitySummary.available} available, ${cc.capabilitySummary.unavailable} unavailable`} />
          </>
        )}
        <DataRow label="Current phase" value={cc?.currentPhase || 'idle'} />
        <DataRow label="Autonomy level" value={cc?.autonomyLevel?.toString() || '—'} />
      </Section>

      <Section title="Cognitive Loop">
        {loop ? (
          <>
            <DataRow label="State" value={loop.state} good={loop.state === 'running'} bad={loop.state === 'stopped'} />
            <DataRow label="Running" value={loop.running ? 'YES' : 'NO'} good={loop.running} />
            <DataRow label="Cycle count" value={loop.cycleCount.toString()} />
            <DataRow label="Kill switch" value={loop.killSwitchActive ? 'ACTIVE' : 'inactive'} bad={loop.killSwitchActive} />
            <DataRow label="Interval" value={`${loop.currentIntervalMs}ms`} />
          </>
        ) : (
          <div className="text-xs text-gray-600">Loop status unavailable (web process does not hold a persistent CognitiveCore — the daemon does).</div>
        )}
      </Section>

      <Section title="Loop Controls">
        <div className="flex flex-wrap gap-2">
          <ControlButton label="Start Loop" onClick={() => sendLoopAction('loop_start')} disabled={loopAction !== null} />
          <ControlButton label="Stop Loop" onClick={() => sendLoopAction('loop_stop')} disabled={loopAction !== null} />
          <ControlButton label="Pause" onClick={() => sendLoopAction('loop_pause')} disabled={loopAction !== null} />
          <ControlButton label="Resume" onClick={() => sendLoopAction('loop_resume')} disabled={loopAction !== null} />
        </div>
        <div className="flex flex-wrap gap-2 mt-2">
          <ControlButton label="Kill Switch ON" onClick={() => sendLoopAction('kill_switch')} disabled={loopAction !== null} danger />
          <ControlButton label="Kill Switch OFF" onClick={() => sendLoopAction('kill_switch_off')} disabled={loopAction !== null} />
          <ControlButton label="Run Single Cycle" onClick={() => sendLoopAction('')} disabled={loopAction !== null} />
        </div>
        {loopResult && (
          <div className="mt-3 text-xs text-gray-400 bg-white/[0.04] border border-white/[0.06] rounded-lg px-3 py-2">
            {loopResult}
          </div>
        )}
      </Section>

      <Section title="Risk Levels">
        <div className="text-xs text-gray-500 space-y-1">
          <div><span className="text-emerald-400/80">R0</span> — Autonomous: safe, reversible, no external impact</div>
          <div><span className="text-emerald-400/80">R1</span> — Autonomous: local service restart</div>
          <div><span className="text-amber-400/80">R2</span> — Human authorization required: code changes, external credentials</div>
          <div><span className="text-red-400/80">R5</span> — Never authorized: protected assets, guardian blocks</div>
        </div>
      </Section>

      <Section title="Credential Runbooks (HEIDI needs these to unblock capabilities)">
        <CredentialRunbooks />
      </Section>
    </div>
  )
}

// ─── Credential Runbooks Component ────────────────────────────────────────

interface CredentialStatus {
  key: string
  capabilityId: string
  service: string
  provider: string
  gates: string
  priority: number
  estimatedTime: string
  cost: string
  requiresCard: boolean
  usesExistingAccount: boolean
  signupUrl: string
  status: 'missing' | 'partial' | 'ready'
  missingVars: string[]
  setVars: string[]
  firstSeenMissing: string | null
  resolvedAt: string | null
  steps: { step: number; action: string; expected: string; requiresHumanInput: boolean; url?: string }[]
  verification: { description: string; checkType: string }
  alternatives: { description: string; envVars: string[] }[]
}

function CredentialRunbooks() {
  const [credentials, setCredentials] = useState<CredentialStatus[]>([])
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    const fetchCreds = async () => {
      try {
        const res = await fetch('/api/credentials')
        if (res.ok) {
          const data = await res.json()
          if (mounted) setCredentials(data.credentials || [])
        }
      } catch { /* ignore */ }
      if (mounted) setLoading(false)
    }
    fetchCreds()
    const interval = setInterval(fetchCreds, 10000)
    return () => { mounted = false; clearInterval(interval) }
  }, [])

  if (loading) return <div className="text-xs text-gray-600">Loading credential status...</div>
  if (credentials.length === 0) return <div className="text-xs text-gray-600">No credential runbooks available.</div>

  const statusColors: Record<string, string> = {
    ready: 'text-emerald-400',
    partial: 'text-amber-400',
    missing: 'text-red-400',
  }

  const statusBg: Record<string, string> = {
    ready: 'bg-emerald-500/10 border-emerald-500/20',
    partial: 'bg-amber-500/10 border-amber-500/20',
    missing: 'bg-red-500/10 border-red-500/20',
  }

  const priorityLabels: Record<number, string> = {
    1: 'HIGHEST — gates revenue',
    2: 'high — gates outreach',
    3: 'medium — gates auto-discovery',
    4: 'low — email covers same job',
  }

  return (
    <div className="space-y-3">
      {credentials.map((cred) => (
        <div key={cred.key} className={`border rounded-lg p-3 ${statusBg[cred.status]}`}>
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setExpandedKey(expandedKey === cred.key ? null : cred.key)}
          >
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold ${statusColors[cred.status]}`}>
                {cred.status === 'ready' ? '✓' : cred.status === 'partial' ? '◐' : '✗'}
              </span>
              <span className="text-sm text-gray-200 font-medium">{cred.service}</span>
              <span className="text-[10px] text-gray-600">P{cred.priority}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${statusColors[cred.status]}`}>{cred.status.toUpperCase()}</span>
              <span className="text-gray-600 text-xs">{expandedKey === cred.key ? '▼' : '▶'}</span>
            </div>
          </div>

          {cred.status !== 'ready' && (
            <div className="mt-1.5 text-[11px] text-gray-500">
              {cred.gates}
            </div>
          )}

          {cred.status === 'ready' && cred.resolvedAt && (
            <div className="mt-1.5 text-[11px] text-emerald-400/60">
              Resolved at {new Date(cred.resolvedAt).toLocaleString()}
            </div>
          )}

          {expandedKey === cred.key && (
            <div className="mt-3 space-y-3 text-xs">
              {/* Status details */}
              <div className="space-y-1">
                <div className="text-gray-400">
                  <span className="text-gray-600">Priority:</span> {priorityLabels[cred.priority] || `P${cred.priority}`}
                </div>
                <div className="text-gray-400">
                  <span className="text-gray-600">Time:</span> {cred.estimatedTime}
                </div>
                <div className="text-gray-400">
                  <span className="text-gray-600">Cost:</span> {cred.cost}
                </div>
                <div className="text-gray-400">
                  <span className="text-gray-600">Card required:</span> {cred.requiresCard ? 'Yes' : 'No'}
                </div>
                {cred.status !== 'ready' && (
                  <div className="text-gray-400">
                    <span className="text-gray-600">Missing env vars:</span>{' '}
                    <span className="font-mono text-red-400/80">{cred.missingVars.join(', ')}</span>
                  </div>
                )}
                {cred.setVars.length > 0 && (
                  <div className="text-gray-400">
                    <span className="text-gray-600">Set env vars:</span>{' '}
                    <span className="font-mono text-emerald-400/80">{cred.setVars.join(', ')}</span>
                  </div>
                )}
              </div>

              {/* Steps */}
              {cred.status !== 'ready' && (
                <div>
                  <div className="text-gray-500 font-medium mb-1.5">Steps to resolve:</div>
                  <ol className="space-y-2">
                    {cred.steps.map((step) => (
                      <li key={step.step} className="text-gray-400 pl-1">
                        <div>
                          <span className="text-gray-600">{step.step}.</span> {step.action}
                          {step.requiresHumanInput && (
                            <span className="ml-1.5 text-[9px] text-amber-400/60 border border-amber-400/20 rounded px-1">HUMAN</span>
                          )}
                        </div>
                        {step.url && (
                          <a href={step.url} target="_blank" rel="noopener noreferrer" className="text-violet-400/60 hover:text-violet-400 text-[11px] ml-3">
                            {step.url}
                          </a>
                        )}
                        <div className="text-gray-600 text-[11px] ml-3">→ {step.expected}</div>
                      </li>
                    ))}
                  </ol>
                </div>
              )}

              {/* Verification */}
              <div className="text-gray-500 border-t border-white/[0.04] pt-2">
                <span className="text-gray-600">Verification:</span> {cred.verification.description}
              </div>

              {/* Alternatives */}
              {cred.alternatives.length > 0 && (
                <div className="text-gray-500">
                  <div className="text-gray-600 mb-1">Alternatives:</div>
                  {cred.alternatives.map((alt, i) => (
                    <div key={i} className="text-gray-400 text-[11px]">• {alt.description}</div>
                  ))}
                </div>
              )}

              {/* Signup link */}
              {cred.status !== 'ready' && (
                <a
                  href={cred.signupUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs text-violet-400 hover:text-violet-300 border border-violet-500/20 rounded-lg px-3 py-1.5"
                >
                  Open {cred.service} →
                </a>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Memory Panel ────────────────────────────────────────────────────────

function MemoryPanel({ status }: { status: StatusData | null }) {
  const [reflections, setReflections] = useState<string>('')
  const [reflectiveMemory, setReflectiveMemory] = useState<string>('')

  useEffect(() => {
    // Load reflection files from the filesystem via a simple fetch
    // These are local files, not API endpoints — we read them through
    // a minimal API route or show a message if unavailable
    setReflections('Loading...')
    setReflectiveMemory('Loading...')
  }, [])

  if (!status) return <div className="text-gray-600 text-sm">Loading...</div>

  const cc = status.cognitiveCore

  return (
    <div className="space-y-6">
      <Section title="Cognitive State">
        <DataRow label="Initialized" value={cc?.initialized ? 'YES' : 'NO'} good={cc?.initialized} />
        <DataRow label="Instance ID" value={cc?.instanceId || '—'} />
        <DataRow label="Cycle count" value={cc?.cycleCount?.toString() || '0'} />
        <DataRow label="Memory connected" value={status.memory_connected ? 'YES' : 'NO'} good={status.memory_connected} />
        <DataRow label="Model failures" value={status.model_status?.consecutiveFailures?.toString() || '0'} bad={(status.model_status?.consecutiveFailures || 0) > 0} />
        <DataRow label="Circuit breaker" value={status.model_status?.circuitBreakerActive ? 'ACTIVE' : 'inactive'} bad={status.model_status?.circuitBreakerActive} />
      </Section>

      <Section title="Allowed Actions">
        {status.allowed_actions.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {status.allowed_actions.map(action => (
              <span key={action} className="px-2 py-0.5 text-[11px] font-mono bg-white/[0.04] border border-white/[0.06] rounded text-gray-400">
                {action}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-600">No allowed actions reported.</div>
        )}
      </Section>

      <Section title="Reflection Files (local)">
        <div className="text-xs text-gray-500 space-y-2">
          <div>
            <span className="text-gray-400">data/awareness/reflections.json</span> — HEIDI's self-reflection log, updated during cognitive cycles.
          </div>
          <div>
            <span className="text-gray-400">data/memory/reflective_memory.json</span> — Persistent reflective memory across sessions.
          </div>
          <div className="text-gray-600 mt-2">
            These files are written by the cognitive core during operation. They contain stored observations,
            not HEIDI's generated interpretation. The distinction matters: stored information is factual
            state; interpretation is HEIDI's reasoning about that state.
          </div>
        </div>
      </Section>

      <Section title="Recent Cognitive Cycle Records (from heidi_events)">
        <div className="text-xs text-gray-500">
          Cognitive cycle records are stored in the <span className="font-mono text-gray-400">heidi_events</span> table
          with <span className="font-mono text-gray-400">event_type = 'cognitive_cycle'</span>. Each record includes
          the cycle ID, phase, outcome (success/fail), execution and verification results. See the Activity / Audit
          tab for live records.
        </div>
      </Section>
    </div>
  )
}

// ─── Chat Panel ──────────────────────────────────────────────────────────

function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [waitTime, setWaitTime] = useState(0)
  const [sessionId] = useState(() => `ops-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const scrollRef = useRef<HTMLDivElement>(null)
  const waitTimerRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text.trim(),
    }
    const assistantId = `a-${Date.now()}`
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setIsLoading(true)
    setInput('')
    setWaitTime(0)
    waitTimerRef.current = setInterval(() => setWaitTime(w => w + 1), 1000)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          session_id: sessionId,
          user_id: 'ops-user',
        }),
      })

      if (!res.ok) throw new Error(`Server error (${res.status})`)

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.type === 'content') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, content: m.content + data.content } : m
                )
              )
            }
          } catch (e) {
            if (e instanceof SyntaxError) continue
            throw e
          }
        }
      }

      setMessages(prev =>
        prev.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m)
      )
    } catch (err) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `Error: ${err instanceof Error ? err.message : 'unknown'}`, isStreaming: false }
            : m
        )
      )
    } finally {
      setIsLoading(false)
      setWaitTime(0)
      if (waitTimerRef.current) {
        clearInterval(waitTimerRef.current)
        waitTimerRef.current = null
      }
    }
  }, [isLoading, sessionId])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll min-h-[300px]">
        <div className="space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/20 flex items-center justify-center text-xl mx-auto mb-3">
                H
              </div>
              <p className="text-sm text-gray-500">Talk to HEIDI. Responses are governed by the cognitive core.</p>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {['System status', 'What can you do?', 'What are you working on?'].map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="px-3 py-1.5 text-xs text-gray-400 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-full transition-all hover:text-gray-200"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id}>
              {msg.role === 'user' ? (
                <div className="flex justify-end">
                  <div className="max-w-[80%] bg-violet-600/20 border border-violet-500/20 rounded-2xl rounded-br-md px-4 py-2.5">
                    <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3">
                  <div className="shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 flex items-center justify-center text-[11px] font-bold text-violet-300 mt-0.5">
                    H
                  </div>
                  <div className="min-w-0 flex-1">
                    {msg.content ? (
                      <div className={`text-sm text-gray-300 whitespace-pre-wrap leading-relaxed ${msg.isStreaming ? 'streaming-cursor' : ''}`}>
                        {msg.content}
                      </div>
                    ) : msg.isStreaming ? (
                      <div className="py-2">
                        <div className="flex gap-1 mb-1">
                          <span className="w-2 h-2 rounded-full bg-violet-400/60 animate-pulse" />
                          <span className="w-2 h-2 rounded-full bg-violet-400/60 animate-pulse" style={{ animationDelay: '0.2s' }} />
                          <span className="w-2 h-2 rounded-full bg-violet-400/60 animate-pulse" style={{ animationDelay: '0.4s' }} />
                        </div>
                        {waitTime > 3 && (
                          <div className="text-[10px] text-gray-600">
                            HEIDI is thinking... {waitTime}s
                            {waitTime > 15 && ' (local model is slow, falling back to deterministic response)'}
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-white/[0.06] pt-3">
        <form onSubmit={handleSubmit}>
          <div className="relative flex items-end bg-white/[0.04] border border-white/[0.08] rounded-2xl focus-within:border-violet-500/40 transition-colors">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message HEIDI..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 px-4 py-3 resize-none outline-none max-h-36 overflow-y-auto"
              style={{ height: 'auto', minHeight: '44px', maxHeight: '144px' }}
              onInput={e => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = Math.min(t.scrollHeight, 144) + 'px'
              }}
              disabled={isLoading}
              autoFocus
            />
            <div className="px-2 pb-2">
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="p-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-30 text-white transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
          <p className="text-[10px] text-gray-700 text-center mt-2">Shift+Enter for new line</p>
        </form>
      </div>
    </div>
  )
}

// ─── Shared Components ───────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white/[0.02] border border-white/[0.04] rounded-xl p-4">
      <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{title}</h2>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function DataRow({
  label,
  value,
  good,
  bad,
}: {
  label: string
  value: string
  good?: boolean
  bad?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${
        good ? 'text-emerald-400' : bad ? 'text-red-400' : 'text-gray-300'
      }`}>
        {value}
      </span>
    </div>
  )
}

function CapabilityRow({ cap }: { cap: CapReport }) {
  const isReady = cap.state === 'READY'
  const isBlocked = cap.state === 'BLOCKED'
  return (
    <div className="text-xs space-y-0.5">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${
          isReady ? 'bg-emerald-400' : isBlocked ? 'bg-red-400' : 'bg-gray-500'
        }`} />
        <span className="font-mono text-gray-300">{cap.capabilityId}</span>
        <span className={`ml-auto text-[10px] ${
          isReady ? 'text-emerald-400/70' : isBlocked ? 'text-red-400/70' : 'text-gray-600'
        }`}>
          {cap.state}
        </span>
      </div>
      <div className="text-gray-600 pl-3.5">{cap.description}</div>
      {!isReady && cap.evidence && (
        <div className="text-gray-700 pl-3.5 text-[10px]">{cap.evidence}</div>
      )}
    </div>
  )
}

function CommercialRow({ name, state, blocker }: { name: string; state: string; blocker: string | null }) {
  const isBlocked = state === 'BLOCKED'
  return (
    <div className="text-xs space-y-0.5 mb-2">
      <div className="flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${isBlocked ? 'bg-red-400' : 'bg-emerald-400'}`} />
        <span className="text-gray-300">{name}</span>
        <span className={`ml-auto text-[10px] ${isBlocked ? 'text-red-400/70' : 'text-emerald-400/70'}`}>
          {state}
        </span>
      </div>
      {blocker && <div className="text-gray-600 pl-3.5 text-[10px]">{blocker}</div>}
    </div>
  )
}

function ControlButton({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-40 ${
        danger
          ? 'bg-red-500/10 hover:bg-red-500/20 text-red-300 border-red-500/20'
          : 'bg-white/[0.04] hover:bg-white/[0.08] text-gray-300 border-white/[0.06]'
      }`}
    >
      {label}
    </button>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatUptime(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  return `${hours}h ${minutes}m`
}
