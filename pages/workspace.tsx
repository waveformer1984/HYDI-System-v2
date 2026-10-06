/**
 * ProtoForge Workspace — the unified Heidi operational surface.
 * All module data comes from /api/workspace/state (live durable state).
 * Chat embeds the existing governed /api/chat SSE stream.
 */
import { useEffect, useRef, useState } from 'react';

type W = Record<string, any>;

// Same localStorage key + HMAC scheme as pages/index.tsx and
// /api/actions/:id — mutating chat intents are token-gated.
const SERVICE_SECRET_KEY = 'hydi.serviceSecret';
async function mintServiceToken(secret: string): Promise<string> {
  const ts = Date.now().toString();
  const requestId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const service = 'heidi-dashboard';
  const payload = `${ts}:${requestId}:${service}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sig = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${ts}.${requestId}.${service}.${sig}`;
}

const NAV = ['chat', 'actions', 'overview', 'agents', 'missions', 'decisions', 'recommend', 'opportunities', 'validation', 'engineering', 'revenue'];

const AGENT_STATUS_COLOR: Record<string, string> = {
  RUNNING: '#22c55e', STARTING: '#22c55e', IDLE: '#94a3b8', REGISTERED: '#94a3b8',
  STALE: '#f59e0b', BLOCKED: '#f59e0b', NEEDS_HUMAN: '#f59e0b',
  FAILED: '#ef4444', STOPPED: '#475569', COMPLETED: '#7dd3fc',
};

const C = { ok: '#22c55e', warn: '#f59e0b', bad: '#ef4444', dim: '#94a3b8', accent: '#7dd3fc' };
const st = (c: string) => ({ color: c });

function Card({ title, children, tone }: { title: React.ReactNode; children: React.ReactNode; tone?: string }) {
  return (
    <section style={{ border: '1px solid #1e293b', borderRadius: 8, padding: '12px 14px', background: '#0b1220', marginBottom: 10 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 11, letterSpacing: 1.5, color: tone ?? C.dim, textTransform: 'uppercase' }}>{title}</h3>
      <div style={{ fontSize: 13, color: '#cbd5e1' }}>{children}</div>
    </section>
  );
}

import { buildTelemetryAlerts } from '../lib/workspace-telemetry';
import { proposalUiState, classifyApiError, ProposalLike, UiError } from '../lib/console-state';

// Shared by every console surface that calls a token-gated API.
async function serviceHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const secret = localStorage.getItem(SERVICE_SECRET_KEY) || '';
  const headers: Record<string, string> = { ...extra };
  if (secret) headers['x-hydi-service-token'] = await mintServiceToken(secret);
  return headers;
}

// Durable proposal/mission evidence → honest display state. Only states
// backed by heidi_action_proposals + joined heidi_missions exist here —
// 'AUTHORIZED', 'PROVEN' and 'REVENUE' are not producible on this surface.
const UI_STATE_COLOR: Record<string, string> = {
  AWAITING_APPROVAL: '#f59e0b', APPROVED_QUEUED: '#7dd3fc', AUTHORIZED: '#a78bfa', EXECUTING: '#7dd3fc',
  WAITING_HUMAN: '#f59e0b', COMPLETED: '#22c55e', FAILED: '#ef4444',
  CANCELLED: '#94a3b8', REJECTED: '#94a3b8', EXPIRED: '#94a3b8',
  RETRACTED: '#94a3b8', UNPROVEN: '#f59e0b',
};

const AGENTS = ['heidi', 'team-coo', 'team-scout', 'team-builder', 'team-qa', 'team-revenue'];

// Telemetry status → visual treatment. STALE is informational (dim),
// TIMEOUT/UNAVAILABLE are hard failures (red), DEGRADED is amber.
// Never render STALE as a failure and never render UNAVAILABLE as ok.
const TELEM_COLOR: Record<string, string> = { HEALTHY: C.ok, DEGRADED: C.warn, TIMEOUT: C.bad, UNAVAILABLE: C.bad, STALE: C.dim };

function TelemetryBanner({ eng }: { eng: W }) {
  const alerts = buildTelemetryAlerts(eng);
  if (!alerts.length) return null;
  return (
    <div style={{ borderBottom: '1px solid #7f1d1d', background: '#1c0a0a', padding: '6px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
      {alerts.map(p => (
        <div key={p.service} style={{ display: 'flex', gap: 10, fontSize: 11, alignItems: 'baseline' }}>
          <span style={{ color: C.dim, minWidth: 90 }}>{p.service}</span>
          <span style={{ color: TELEM_COLOR[p.status] ?? C.bad, fontWeight: 700 }}>{p.status}</span>
          <span style={{ color: '#cbd5e1' }}>{p.detail}</span>
          <span style={{ color: '#64748b' }}>{p.blockingNote}</span>
        </div>
      ))}
    </div>
  );
}

function Chat({ agent }: { agent: string }) {
  const [msgs, setMsgs] = useState<Array<{ role: string; text: string }>>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const label = agent === 'heidi' ? 'HEIDI' : agent.replace('team-', '').toUpperCase();
  // Reconstruct the conversation from durable chat events (was write-only).
  useEffect(() => {
    (async () => {
      const secret = localStorage.getItem(SERVICE_SECRET_KEY) || '';
      const headers: Record<string, string> = {};
      if (secret) headers['x-hydi-service-token'] = await mintServiceToken(secret);
      return fetch(`/api/workspace/chat?agent=${encodeURIComponent(agent)}&user=j&limit=40`, { headers });
    })()
      .then(r => r && r.ok ? r.json() : null)
      .then(j => { if (j?.messages?.length) setMsgs(j.messages.map((m: { role: string; content: string }) => ({ role: m.role === 'user' ? 'you' : m.role === 'system' ? 'system' : 'agent', text: m.content }))); })
      .catch(() => { /* history is best-effort; live chat still works */ });
  }, [agent]);
  const send = async () => {
    if (!input.trim() || busy) return;
    const m = input; setInput(''); setBusy(true);
    setMsgs(v => [...v, { role: 'you', text: m }, { role: 'agent', text: '…' }]);
    try {
      const secret = localStorage.getItem(SERVICE_SECRET_KEY) || '';
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (secret) headers['x-hydi-service-token'] = await mintServiceToken(secret);
      const r = await fetch('/api/chat', { method: 'POST', headers, body: JSON.stringify({ message: m, session_id: 'workspace', user_id: 'j', agent: agent === 'heidi' ? undefined : agent }) });
      const text = await r.text();
      const content = [...text.matchAll(/"content":"((?:[^"\\]|\\.)*)"/g)].map(x => JSON.parse(`"${x[1]}"`)).join('');
      let reply;
      if (content) reply = content;
      else if (!r.ok) { try { const j = JSON.parse(text); reply = `HTTP ${r.status} — ${j.error ?? text}`; } catch { reply = `HTTP ${r.status} — ${text || '(empty response)'}`; } }
      else reply = '(no content)';
      setMsgs(v => [...v.slice(0, -1), { role: 'agent', text: reply }]);
    } catch (e) { setMsgs(v => [...v.slice(0, -1), { role: 'agent', text: `error: ${e}` }]); }
    setBusy(false);
  };
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [msgs]);
  return (
    <div style={{ borderTop: '1px solid #1e293b', padding: '10px 14px', background: '#0b1220' }}>
      <div ref={ref} style={{ maxHeight: 180, overflowY: 'auto', fontSize: 13 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <span style={{ color: m.role === 'you' ? C.accent : m.role === 'system' ? C.warn : C.ok, fontWeight: 600 }}>{m.role === 'you' ? 'YOU' : m.role === 'system' ? 'SYSTEM' : label}</span>
            <span style={{ color: '#cbd5e1', whiteSpace: 'pre-wrap' }}> {m.text}</span>
          </div>
        ))}
        {!msgs.length && <div style={{ color: '#475569' }}>{agent === 'heidi' ? 'Ask Heidi: "how\'s it going" · "find something useful" · "what are you working on" · "inspect <agentId|missionId>"' : `Talking to ${label} — answers come from its durable state. Commands (stop/retry/inspect) still route through governance.`}</div>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()}
          placeholder={`message ${label.toLowerCase()}…`} disabled={busy}
          style={{ flex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, color: '#e2e8f0', padding: '8px 10px', fontSize: 13 }} />
        <button onClick={send} disabled={busy} style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '8px 16px', cursor: 'pointer' }}>send</button>
      </div>
    </div>
  );
}

function ActionButton({ label, kind, body, onDone, disabled }: { label: string; kind: string; body: Record<string, unknown>; onDone: () => void; disabled?: boolean }) {
  const [st2, setSt2] = useState<'idle' | 'working' | 'done' | 'failed' | 'refused'>('idle');
  const [msg, setMsg] = useState('');
  const go = async () => {
    setSt2('working');
    try {
      const secret = localStorage.getItem(SERVICE_SECRET_KEY) || '';
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (secret) headers['x-hydi-service-token'] = await mintServiceToken(secret);
      const r = await fetch('/api/workspace/action', { method: 'POST', headers, body: JSON.stringify({ kind, ...body }) });
      const j = await r.json();
      if (r.ok && j.ok) { setSt2('done'); setMsg(`goal ${String(j.goalId).slice(0, 8)} → ${j.capabilityId}`); onDone(); }
      else { setSt2(r.status === 409 ? 'refused' : 'failed'); setMsg(j.error ?? 'failed'); }
    } catch (e) { setSt2('failed'); setMsg(String(e)); }
  };
  return (
    <span style={{ marginRight: 8 }}>
      <button onClick={go} disabled={disabled || st2 === 'working' || st2 === 'done'} style={{
        background: st2 === 'done' ? '#14532d' : st2 === 'failed' || st2 === 'refused' ? '#450a0a' : '#1e293b',
        color: '#e2e8f0', border: '1px solid #334155', borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
      }}>{st2 === 'working' ? '…' : label}</button>
      {msg && <span style={{ fontSize: 10, color: st2 === 'done' ? C.ok : C.bad }}> {msg}</span>}
    </span>
  );
}

/** Durable Human Action controls — POSTs an op to the authenticated
 *  /api/human-actions route. 'verify' re-runs the machine check; there is
 *  deliberately no "mark complete" button for verifier-backed actions. */
function HumanActionButton({ label, actionId, op, onDone }: { label: string; actionId: string; op: 'claim' | 'verify' | 'resolve' | 'reject'; onDone: () => void }) {
  const [st2, setSt2] = useState<'idle' | 'working' | 'done' | 'failed' | 'refused'>('idle');
  const [msg, setMsg] = useState('');
  const go = async () => {
    setSt2('working');
    try {
      const headers = await serviceHeaders({ 'content-type': 'application/json' });
      const body: Record<string, unknown> = { op };
      if (op === 'resolve') body.note = 'attested via workspace';
      if (op === 'reject') body.reason = 'rejected via workspace';
      const r = await fetch(`/api/human-actions/${encodeURIComponent(actionId)}`, { method: 'POST', headers, body: JSON.stringify(body) });
      const j = await r.json();
      if (r.ok && j.ok) {
        setSt2('done');
        const st = j.action?.status ?? '';
        setMsg(st === 'RESOLVED' ? 'VERIFIED — resolved' : st === 'BLOCKED' ? `still failing: ${j.action?.verification?.safeSummary ?? j.action?.lastError ?? 'check failed'}` : st.toLowerCase());
        onDone();
      } else { setSt2(r.status === 409 ? 'refused' : 'failed'); setMsg(j.error ?? 'failed'); }
    } catch (e) { setSt2('failed'); setMsg(String(e)); }
  };
  return (
    <span style={{ marginRight: 8 }}>
      <button onClick={go} disabled={st2 === 'working'} style={{
        background: st2 === 'done' ? '#14532d' : st2 === 'failed' || st2 === 'refused' ? '#450a0a' : '#1e293b',
        color: '#e2e8f0', border: '1px solid #334155', borderRadius: 4, padding: '3px 10px', fontSize: 11, cursor: 'pointer',
      }}>{st2 === 'working' ? '…' : label}</button>
      {msg && <span style={{ fontSize: 10, color: st2 === 'done' ? C.ok : C.bad }}> {msg}</span>}
    </span>
  );
}

/* ─── Governed actions surface ─────────────────────────────────────────
 * Reads and resolves REAL durable proposals via /api/proposals — the
 * server re-validates the allowlist, params-hash binding, expiry and
 * consume-once inside the transaction. The UI supplies only {decision};
 * it can never supply humanApproved/approvedHash — decidedBy is derived
 * server-side from the authenticated role. */

interface DecideOutcome { ok: boolean; status?: string; goalId?: string | null; err?: UiError; working?: boolean }

function ParamsBlock({ params }: { params: W }) {
  const entries = Object.entries(params ?? {});
  if (!entries.length) return <span style={{ color: '#475569' }}>no parameters</span>;
  return <>{entries.map(([k, v]) => <div key={k}><span style={{ color: '#64748b' }}>{k}</span> <span style={{ color: '#cbd5e1' }}>{JSON.stringify(v)}</span></div>)}</>;
}

function ProposalCard({ p, expanded, onToggle, onDecide, outcome }: {
  p: W; expanded: boolean; onToggle: () => void;
  onDecide: (d: 'approve' | 'reject') => void; outcome?: DecideOutcome;
}) {
  const ui = proposalUiState(p as ProposalLike);
  const col = UI_STATE_COLOR[ui.state] ?? C.dim;
  const awaiting = ui.state === 'AWAITING_APPROVAL';
  return (
    <div style={{ border: `1px solid ${awaiting ? '#78350f' : '#1e293b'}`, borderRadius: 8, padding: '10px 14px', background: '#0b1220', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: col, fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>{ui.label}</span>
        <b style={{ fontSize: 13 }}>{p.title}</b>
        <span style={{ color: '#475569', fontSize: 11 }}>{p.capabilityId} · {p.id.slice(0, 8)}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button onClick={onToggle} style={btnS()}>{expanded ? 'HIDE' : 'REVIEW'}</button>
          {awaiting && <>
            <button onClick={() => onDecide('approve')} disabled={outcome?.working} style={btnS('#14532d', '#22c55e')}>APPROVE</button>
            <button onClick={() => onDecide('reject')} disabled={outcome?.working} style={btnS('#450a0a', '#ef4444')}>REJECT</button>
          </>}
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
        {ui.note}
        {p.decidedBy ? ` · decided by ${p.decidedBy} ${p.decidedAt ? `at ${String(p.decidedAt).slice(0, 19)}Z` : ''}` : ''}
        {p.missionId ? ` · mission ${String(p.missionId).slice(0, 8)}${p.missionStatus ? ` (${p.missionStatus}${p.missionStage ? `/${p.missionStage}` : ''})` : ''}` : ''}
      </div>
      {outcome && !outcome.working && (
        <div style={{ marginTop: 6, fontSize: 11, color: outcome.ok ? C.ok : C.bad }}>
          {outcome.ok
            ? `${String(outcome.status).toUpperCase()} — durable decision recorded${outcome.goalId ? ` · governed goal ${String(outcome.goalId).slice(0, 8)} queued (execution remains gated)` : ''}`
            : `${outcome.err?.code}: ${outcome.err?.message}`}
        </div>
      )}
      {expanded && (
        <div style={{ marginTop: 8, borderTop: '1px solid #1e293b', paddingTop: 8, fontSize: 12 }}>
          <div style={{ marginBottom: 6 }}><span style={{ color: '#64748b' }}>reason:</span> {p.reason}</div>
          {p.expectedEffects && <div style={{ marginBottom: 6 }}><span style={{ color: '#64748b' }}>expected:</span> {p.expectedEffects}</div>}
          {p.risks && <div style={{ marginBottom: 6 }}><span style={{ color: '#64748b' }}>risks:</span> <span style={{ color: C.warn }}>{p.risks}</span></div>}
          {p.prerequisites && <div style={{ marginBottom: 6 }}><span style={{ color: '#64748b' }}>prerequisites:</span> {p.prerequisites}</div>}
          <div style={{ marginBottom: 6 }}><span style={{ color: '#64748b' }}>parameters:</span><ParamsBlock params={p.params} /></div>
          <div style={{ color: '#475569', fontSize: 11 }}>
            proposal {p.id} · created {String(p.createdAt).slice(0, 19)}Z · expires {String(p.expiresAt).slice(0, 19)}Z
            {p.producerKey ? ` · requested by ${p.producerKey}` : ''}
            {p.reversible ? ` · reversible${p.rollback ? ` (${p.rollback.slice(0, 80)})` : ''}` : ' · NOT reversible'}
            {p.goalId ? ` · goal ${String(p.goalId).slice(0, 8)}` : ''}
          </div>
          {ui.state === 'APPROVED_QUEUED' && (
            <div style={{ marginTop: 6, fontSize: 11, color: C.accent }}>
              APPROVED ≠ AUTHORIZED — the R2/autonomy gate in the daemon still decides whether this executes.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const btnS = (bg = '#1e293b', border = '#334155'): React.CSSProperties => ({
  background: bg, color: '#e2e8f0', border: `1px solid ${border}`, borderRadius: 4,
  padding: '3px 10px', fontSize: 11, cursor: 'pointer', letterSpacing: 0.5,
});

function SellOfferCard({ offer, reload }: { offer: W; reload: () => void }) {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/workspace/action', {
        method: 'POST',
        headers: await serviceHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ kind: 'sell_offer', offerId: offer.offerId, customerEmail: email.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      setMsg(r.ok ? (j.message ?? 'proposal created') : `refused: ${j.error ?? `HTTP ${r.status}`}`);
      if (r.ok) { setEmail(''); reload(); }
    } catch (e) { setMsg(`error: ${e}`); }
    setBusy(false);
  };
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ color: C.accent, fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>CHECKOUT_READY · CUSTOMER REQUIRED</span>
        <b style={{ fontSize: 13 }}>{offer.offerId}</b>
        <span style={{ fontSize: 12, color: '#cbd5e1' }}>{offer.product} — ${(offer.priceCents / 100).toFixed(2)} {offer.currency}</span>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && !busy && email.trim() && go()}
          placeholder="customer email — real customer only"
          style={{ flex: 1, maxWidth: 320, background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', fontSize: 12 }} />
        <button onClick={go} disabled={busy || !email.trim()} style={btnS('#1e293b', '#e2e8f0')}>{busy ? '…' : 'propose sale'}</button>
      </div>
      {msg && <div style={{ fontSize: 11, color: C.warn, marginTop: 4 }}>{msg}</div>}
      <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>creates a governed revenue.advance_offer proposal bound to this exact offer — human approval still required before anything executes</div>
    </div>
  );
}

function ActionsTab({ proposals, error, reload, focusId, offers }: {
  proposals: { recommended: W[]; history: W[] } | null;
  error: string | null; reload: () => void; focusId: string | null;
  offers: { ready?: W[]; boundary?: W[]; total?: number; byStage?: Record<string, number> } | null;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(focusId ? [focusId] : []));
  const [outcomes, setOutcomes] = useState<Record<string, DecideOutcome>>({});
  useEffect(() => { if (focusId) setExpanded(e => new Set(e).add(focusId)); }, [focusId]);

  const decide = async (p: W, decision: 'approve' | 'reject') => {
    setOutcomes(o => ({ ...o, [p.id]: { ok: false, working: true } }));
    try {
      const r = await fetch(`/api/proposals/${p.id}`, {
        method: 'POST', headers: await serviceHeaders({ 'content-type': 'application/json' }),
        body: JSON.stringify({ decision }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) setOutcomes(o => ({ ...o, [p.id]: { ok: true, status: j.status, goalId: j.goalId } }));
      else setOutcomes(o => ({ ...o, [p.id]: { ok: false, err: classifyApiError(r.status, j.error) } }));
    } catch {
      setOutcomes(o => ({ ...o, [p.id]: { ok: false, err: classifyApiError(null) } }));
    }
    reload(); // durable backend state is authoritative — re-read, never assume
  };

  if (error) return <Card title="actions — backend error" tone={C.bad}>{error}</Card>;
  if (!proposals) return <Card title="actions">loading durable proposals…</Card>;
  return (
    <>
      {offers && (offers.ready?.length || offers.boundary?.length) ? (
        <Card title={`commercial offers — ${offers.total ?? 0}`} tone={(offers.ready?.length ?? 0) > 0 ? C.accent : C.dim}>
          {offers.byStage && <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>{Object.entries(offers.byStage).map(([st, n]) => `${n} ${st}`).join(' · ')}</div>}
          {(offers.ready ?? []).map((o: W) => <SellOfferCard key={o.offerId} offer={o} reload={reload} />)}
          {(offers.boundary ?? []).map((o: W) => (
            <div key={o.offerId} style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 4 }}>
              <b>{o.offerId}</b> <span style={{ color: C.warn }}>{o.stage}</span> — {o.reason ?? 'no reason recorded'}
            </div>
          ))}
        </Card>
      ) : null}
      <Card title={`awaiting approval — ${proposals.recommended.length}`} tone={proposals.recommended.length ? C.warn : C.dim}>
        {proposals.recommended.length
          ? proposals.recommended.map(p => (
            <ProposalCard key={p.id} p={p} expanded={expanded.has(p.id)}
              onToggle={() => setExpanded(e => { const n = new Set(e); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
              onDecide={d => decide(p, d)} outcome={outcomes[p.id]} />
          ))
          : 'no proposals pending — Heidi surfaces governed work here when it needs your authority'}
      </Card>
      <Card title={`history — ${proposals.history.length}`} tone={C.dim}>
        {proposals.history.length
          ? proposals.history.map(p => (
            <ProposalCard key={p.id} p={p} expanded={expanded.has(p.id)}
              onToggle={() => setExpanded(e => { const n = new Set(e); n.has(p.id) ? n.delete(p.id) : n.add(p.id); return n; })}
              onDecide={d => decide(p, d)} outcome={outcomes[p.id]} />
          ))
          : 'no resolved proposals yet'}
      </Card>
    </>
  );
}

function ChatTab({ pending, chatAgent, setChatAgent, onReview }: {
  pending: W[]; chatAgent: string; setChatAgent: (a: string) => void;
  onReview: (id: string) => void;
}) {
  return (
    <>
      {pending.length > 0 && (
        <Card title={`${pending.length} governed action${pending.length === 1 ? '' : 's'} awaiting your approval`} tone={C.warn}>
          {pending.map(p => (
            <div key={p.id} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ color: C.warn, fontWeight: 700, fontSize: 11, letterSpacing: 1 }}>AWAITING HUMAN APPROVAL</span>
                <b style={{ fontSize: 13, textTransform: 'uppercase' }}>{p.capabilityId}</b>
                <button onClick={() => onReview(p.id)} style={btnS('#1e293b', '#f59e0b')}>REVIEW ACTION</button>
              </div>
              <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>{p.title}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                proposal {p.id.slice(0, 8)}{p.params?.offerId ? ` · offer ${p.params.offerId}` : ''}
                {p.params?.customerEmail ? ` · customer ${p.params.customerEmail}` : ''}
                {p.risks ? ` · ${String(p.risks).slice(0, 100)}` : ''}
              </div>
            </div>
          ))}
        </Card>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: '#475569', letterSpacing: 1 }}>TALK TO</span>
        {AGENTS.map(a => (
          <button key={a} onClick={() => setChatAgent(a)} style={{
            background: chatAgent === a ? '#1e293b' : 'transparent', border: '1px solid #334155',
            borderRadius: 4, padding: '2px 10px', fontSize: 11, cursor: 'pointer',
            color: chatAgent === a ? C.accent : '#94a3b8',
          }}>{a === 'heidi' ? 'Heidi/COO' : a.replace('team-', '')}</button>
        ))}
      </div>
      <Chat key={chatAgent} agent={chatAgent} />
    </>
  );
}

export default function Workspace() {
  const [s, setS] = useState<W | null>(null);
  const [tab, setTab] = useState('chat');
  const [chatAgent, setChatAgent] = useState('heidi');
  const [proposals, setProposals] = useState<{ recommended: W[]; history: W[] } | null>(null);
  const [proposalsError, setProposalsError] = useState<string | null>(null);
  const [focusProposal, setFocusProposal] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [secretDraft, setSecretDraft] = useState('');
  const load = async () => {
    const headers = await serviceHeaders();
    const [stateR, propR] = await Promise.all([
      fetch('/api/workspace/state', { headers }),
      fetch('/api/proposals', { headers }).catch(() => null),
    ]);
    if (stateR.ok) {
      stateR.json().then(setS).catch(e => setErr(String(e)));
      setErr(null);
    } else {
      const j = await stateR.json().catch(() => null);
      setErr(j?.error ?? `HTTP ${stateR.status}`);
    }
    if (propR) {
      propR.json().then(j => {
        if (propR.ok) { setProposals(j); setProposalsError(null); }
        else setProposalsError(j.error ?? `HTTP ${propR.status}`);
      }).catch(() => setProposalsError(`HTTP ${propR.status}`));
    }
  };
  const saveSecret = () => {
    const v = secretDraft.trim();
    if (!v) return;
    localStorage.setItem(SERVICE_SECRET_KEY, v);
    setSecretDraft('');
    load();
  };
  const reload = load;
  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const healthColor = s?.system?.health === 'HEALTHY' ? C.ok : s?.system?.health ? C.warn : C.dim;
  const authFailed = !!err && /unauthorized|401/i.test(err);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#020617', color: '#e2e8f0', fontFamily: 'ui-monospace, Menlo, monospace' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px', borderBottom: '1px solid #1e293b' }}>
        <strong style={{ fontSize: 14, letterSpacing: 2 }}>PROTOFORGE</strong>
        <span style={st(C.dim)}>heidi workspace</span>
        {s?.system && <>
          <span style={{ marginLeft: 'auto', ...st(healthColor) }}>● {s.system.health}{s.system.cooStale ? ' (stale)' : ''}</span>
          <span style={st(C.accent)}>AUTONOMY {s.system.autonomyLevel} · {s.system.autonomyName}</span>
          <span style={st(C.dim)}>{s.engineering?.head}</span>
        </>}
      </header>
      {s?.engineering && <TelemetryBanner eng={s.engineering} />}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        <nav style={{ width: 130, borderRight: '1px solid #1e293b', padding: 8 }}>
          {NAV.map(n => (
            <button key={n} onClick={() => setTab(n)} style={{
              display: 'block', width: '100%', textAlign: 'left', background: tab === n ? '#1e293b' : 'transparent',
              color: tab === n ? C.accent : C.dim, border: 'none', borderRadius: 4, padding: '6px 8px', fontSize: 12, cursor: 'pointer', textTransform: 'capitalize',
            }}>{n}</button>
          ))}
        </nav>
        <main style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {err && (
            <Card title={authFailed ? 'authentication required' : 'error'} tone={authFailed ? C.warn : C.bad}>
              {err}
              {authFailed && (
                <div style={{ marginTop: 8 }}>
                  <input
                    type="password" value={secretDraft} onChange={e => setSecretDraft(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && saveSecret()}
                    placeholder="HYDI_SERVICE_SECRET"
                    style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '6px 10px', fontSize: 12, width: 280, marginRight: 8 }}
                  />
                  <button onClick={saveSecret} style={{ background: '#1e293b', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 6, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>set secret</button>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>stored in localStorage as <code>hydi.serviceSecret</code> — mints the service token this console&apos;s governed endpoints require.</div>
                </div>
              )}
            </Card>
          )}
          {!s ? <Card title="loading">{authFailed ? 'waiting for service secret…' : 'reading live state…'}</Card> : <>
            {tab === 'chat' && (
              <ChatTab
                pending={proposals?.recommended ?? []}
                chatAgent={chatAgent} setChatAgent={setChatAgent}
                onReview={id => { setFocusProposal(id); setTab('actions'); }}
              />
            )}
            {tab === 'actions' && (
              <ActionsTab proposals={proposals} error={proposalsError} reload={reload} focusId={focusProposal} offers={s?.offers ?? null} />
            )}
            {tab === 'agents' && <>
              {!s.agents ? <Card title="agents" tone={C.dim}>agent state not present in this build — rebuild or use the dev surface</Card> : <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 10 }}>
                  {(s.agents.team ?? []).map((a: W) => (
                    <Card key={a.agentId} title={<span>{a.role} <span onClick={() => setChatAgent(a.agentId)} style={{ cursor: 'pointer', color: C.accent }}>· chat</span></span>}
                      tone={AGENT_STATUS_COLOR[a.status] ?? C.dim}>
                      <span style={{ color: AGENT_STATUS_COLOR[a.status] ?? C.dim }}>● {a.status}</span><br />
                      <small style={{ color: C.dim }}>heartbeat: {a.lastHeartbeat ? a.lastHeartbeat.slice(11, 19) + 'Z' : 'never'}</small><br />
                      <small style={{ color: C.dim }}>mission: {a.currentMission ? a.currentMission.slice(0, 20) : 'none'}</small><br />
                      <small style={{ color: C.dim }}>authority: {a.authority}</small>
                    </Card>
                  ))}
                </div>
                <Card title="mission queue" tone={C.dim}>
                  running {s.agents.counts.running} · pending {s.agents.counts.pending} · needs-human {s.agents.counts.needsHuman} · stale {s.agents.counts.stale}
                  {(s.agents.missions ?? []).map((m: W) => (
                    <div key={m.missionId} style={{ marginTop: 4 }}>
                      • <span style={{ color: AGENT_STATUS_COLOR[m.status] ?? C.dim }}>[{m.status}]</span> <b>{m.role}</b> {m.objective}
                      <span style={{ color: '#475569' }}> · {m.missionId.slice(0, 20)} · p{m.priority} · attempt {m.attempt}{m.failure ? ` · ${String(m.failure).slice(0, 60)}` : ''}</span>
                    </div>
                  ))}
                </Card>
                <Card title="live activity" tone={C.accent}>
                  {(s.agents.activity ?? []).map((e: W, i: number) => (
                    <div key={i}>• {e.type} <span style={{ color: '#475569' }}>{e.at?.slice(11, 19)}Z</span> — {e.detail}</div>
                  ))}
                </Card>
              </>}
            </>}

            {tab === 'overview' && <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
                <Card title="system" tone={healthColor}>{s.system.health}{s.system.cooStale ? ' (stale snapshot)' : ''}</Card>
                <Card title="autopilot" tone={s.autopilot.state === 'RUNNING' ? C.ok : C.warn}>{s.autopilot.state}<br /><small style={{ color: C.dim }}>30min dev scan · head {s.autopilot.head ?? 'n/a'}</small></Card>
                <Card title="revenue" tone={C.bad}>{s.business.revenueVerified.split('—')[0]}</Card>
                <Card title="human decisions" tone={s.decisions.length ? C.warn : C.ok}>{s.decisions.length} pending</Card>
                <Card title="missions" tone={C.dim}>{s.missions.jobs.paidDelivered} delivered · {s.missions.jobs.escalated} escalated</Card>
              </div>
              <Card title="active goals">{s.goals.length ? s.goals.map((g: W) => <div key={g.id}>• [{g.status}] {g.title} <span style={{ color: '#475569' }}>({g.capability ?? 'no cap'})</span></div>) : 'no open goals'}</Card>
              <Card title="recommended next">{s.recommendations[0] ? `${s.recommendations[0].action} — ${s.recommendations[0].why}` : 'no justified action — NO_ACTION_REQUIRED'}</Card>
            </>}

            {tab === 'autopilot' && <>
              <Card title="loop state">{s.autopilot.state} · scan every 30min · last investigations:</Card>
              <Card title="recent investigations">{s.autopilot.lastInvestigations.length ? s.autopilot.lastInvestigations.map((i: W, n: number) => <div key={n}>• <b style={{ color: i.conclusion === 'CONFIRMED_DEFECT' ? C.warn : i.conclusion === 'NOT_A_DEFECT' ? C.ok : C.dim }}>{i.conclusion}</b> ({i.confidence}) — {i.target}</div>) : 'none yet'}</Card>
              <Card title="authorization">R0/R1/R2 autonomous · R3+ → decision queue · autonomy level {s.system.autonomyLevel} (granted by human_owner)</Card>
            </>}

            {tab === 'missions' && <>
              <Card title="customer jobs">{s.missions.jobs.total} total · {s.missions.jobs.paidDelivered} delivered · {s.missions.jobs.escalated} escalated to human</Card>
              <Card title="recent runtime events">{s.missions.events.map((e: W, i: number) => <div key={i}>• {e.type} <span style={{ color: '#475569' }}>{e.at?.slice(11, 19)}</span> — {e.detail}</div>)}</Card>
              <Card title="dev goals">{s.goals.filter((g: W) => g.capability?.startsWith?.('ops.dev')).map((g: W) => <div key={g.id}>[{g.status}] {g.title}</div>) || 'none'}</Card>
            </>}

            {tab === 'decisions' && <>
              <Card title="human decision queue" tone={s.decisions.length ? C.warn : C.ok}>
                {s.decisions.length ? s.decisions.map((d: W) => (
                  <div key={d.id} style={{ marginBottom: 8 }}>• <b>{d.title}</b> <span style={{ color: '#475569' }}>({d.kind})</span><br />
                    {d.kind === 'intervention'
                      ? <>
                        <ActionButton label="approve" kind="resolve" body={{ queueItemId: d.id, decision: 'approve' }} onDone={reload} />
                        <ActionButton label="reject" kind="resolve" body={{ queueItemId: d.id, decision: 'reject' }} onDone={reload} />
                      </>
                      : d.kind === 'human_action'
                        ? <>
                          <HumanActionButton label="verify" actionId={d.id} op="verify" onDone={reload} />
                          <small style={{ color: C.dim }}> verifier-gated — resolves only when the check passes · see prerequisites below</small>
                        </>
                        : <small style={{ color: '#475569' }}>ACTION UNAVAILABLE — no governed capability for this class; review evidence manually</small>}
                    <small style={{ color: C.dim }}> authority: J · evidence: {d.id}</small>
                  </div>
                )) : 'nothing requires J right now'}
              </Card>
              <Card title="human actions — verifier-gated prerequisites" tone={(s.humanActions ?? []).some((a: W) => a.status === 'OPEN' || a.status === 'BLOCKED') ? C.warn : C.ok}>
                {(s.humanActions ?? []).length ? (s.humanActions as W[]).map((a: W) => (
                  <div key={a.id} style={{ marginBottom: 10, borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
                    <b>{a.title}</b>{' '}
                    <span style={{ color: a.status === 'RESOLVED' ? C.ok : a.status === 'BLOCKED' ? C.bad : a.status === 'OPEN' ? C.warn : C.dim }}>[{a.status}]</span>{' '}
                    <span style={{ color: '#475569' }}>{a.priority} · {a.type}{a.sourceMissionId ? ` · mission ${a.sourceMissionId}` : ''}{a.sourceGoalId ? ` · goal ${String(a.sourceGoalId).slice(0, 8)}` : ''}</span><br />
                    {a.status !== 'RESOLVED' && (a.instructions ?? []).length > 0 && (
                      <ol style={{ margin: '4px 0', paddingLeft: 18, fontSize: 11, color: C.dim }}>
                        {a.instructions.map((step: string, i: number) => <li key={i}>{step}</li>)}
                      </ol>
                    )}
                    {(a.stillFailing ?? []).length > 0 && <small style={{ color: C.bad }}>failing: {a.stillFailing.join(' · ')}</small>}
                    {a.lastCheck && <small style={{ color: '#475569' }}> last check {a.lastCheck.slice(0, 19)}Z · attempts {a.attempts}</small>}
                    <div style={{ marginTop: 4 }}>
                      {a.claimable && <HumanActionButton label="claim" actionId={a.id} op="claim" onDone={reload} />}
                      {a.verifiable && a.status !== 'RESOLVED' && <HumanActionButton label="verify" actionId={a.id} op="verify" onDone={reload} />}
                      {a.attestationOnly && a.status !== 'RESOLVED' && <HumanActionButton label="attest done" actionId={a.id} op="resolve" onDone={reload} />}
                      {a.status !== 'RESOLVED' && <HumanActionButton label="reject" actionId={a.id} op="reject" onDone={reload} />}
                      {a.status === 'RESOLVED' && <small style={{ color: C.ok }}>resolved — linked goals released back to runnable</small>}
                    </div>
                  </div>
                )) : 'no durable human actions — all known external prerequisites are satisfied'}
              </Card>
            </>}

            {tab === 'recommend' && <>
              {s.recommendations.length ? s.recommendations.map((r: W, i: number) => (
                <Card key={i} title={`${r.authorization} · ${r.kind}`} tone={r.authorization.startsWith('R3') ? C.warn : C.accent}>
                  <b>{r.action}</b><br />why: {r.why}<br />evidence: {r.evidence}<br />value: {r.expectedValue} · effort: {r.effort} · risk: {r.risk}<br />
                  <span style={{ marginTop: 6, display: 'inline-block' }}>
                    {r.kind === 'dev_fix' && r.ref && <ActionButton label="start fix" kind="fix" body={{ investigationId: r.ref }} onDone={reload} />}
                    {r.kind === 'opportunity' && <ActionButton label="investigate" kind="investigate_opportunity" body={{ opportunityId: r.ref }} disabled={!r.ref} onDone={reload} />}
                    {r.kind === 'human_decision' && <small style={{ color: C.warn }}>requires J — see decisions tab</small>}
                  </span>
                </Card>
              )) : <Card title="recommendations">no justified action — NO_ACTION_REQUIRED</Card>}
            </>}

            {tab === 'products' && <>
              {s.business.products.map((p: W) => <Card key={p.name} title={p.name} tone={p.status === 'CURRENT' ? C.ok : C.dim}>{p.summary}<br /><small style={{ color: '#475569' }}>state: {p.status} · verified: {p.verified ?? 'never'}</small></Card>)}
            </>}

            {tab === 'opportunities' && <>
              <Card title="protoforge pipeline">{s.opportunities.map((o: W) => <div key={o.status}>{o.status}: {o.count} (top confidence {o.topConfidence ?? 'n/a'})</div>)}</Card>
            </>}

            {tab === 'validation' && <>
              <Card title="customer validation queue" tone={s.validation?.length ? C.accent : C.dim}>
                {s.validation?.length ? s.validation.map((v: W, i: number) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <b>{v.opportunity}</b><br />
                    stage: <span style={{ color: C.accent }}>{v.stage}</span>
                    {v.verdict ? ` · verdict ${v.verdict} (${v.confidence ?? 'n/a'})` : ''}
                    {v.evidenceCount ? ` · ${v.evidenceCount} evidence record(s)` : ''}
                    {v.blockedReason ? <><br /><span style={{ color: C.warn }}>blocked: {v.blockedReason}</span></> : null}
                    {v.nextHumanAction ? <><br /><small style={{ color: C.dim }}>human action: {v.nextHumanAction}</small></> : null}
                  </div>
                )) : 'no opportunities in validation — investigate first; validation requires evidence, not ideas'}
              </Card>
            </>}

            {tab === 'engineering' && <>
              <Card title="services">{s.engineering.servicesOnline}/{s.engineering.servicesTotal} online{s.engineering.services.map((v: W) => <div key={v.name}><span style={{ color: v.status === 'online' ? C.ok : C.bad }}>●</span> {v.name} <span style={{ color: '#475569' }}>{Math.round((v.memory ?? 0) / 1048576)}MB · {v.restarts ?? 0} restarts</span></div>)}</Card>
              <Card title="runtime">
                HEAD {s.engineering.head} · {s.engineering.dirtyPaths} dirty paths
                {' · '}Ollama {s.engineering.ollama.ok ? `up (${s.engineering.ollama.models.length} models)` : 'down'}
                {' · '}<span style={{ color: ({ HEALTHY: C.ok, DEGRADED: C.warn, TIMEOUT: C.bad, UNAVAILABLE: C.bad, STALE: C.dim } as Record<string, string>)[s.engineering.supabaseRestTelemetry?.status ?? 'UNAVAILABLE'] }}>●</span> Supabase REST {s.engineering.supabaseRestTelemetry?.status ?? 'UNAVAILABLE'}{s.engineering.supabaseRest?.ms != null ? ` ${s.engineering.supabaseRest.ms}ms` : ''}{s.engineering.supabaseRest?.circuit === 'open' ? ' (circuit open)' : ''}
                {' · '}<span style={{ color: ({ HEALTHY: C.ok, STALE: C.dim, TIMEOUT: C.bad, UNAVAILABLE: C.bad, DEGRADED: C.bad } as Record<string, string>)[s.engineering.servicesTelemetry?.status ?? 'UNAVAILABLE'] }}>●</span> PM2 {s.engineering.servicesTelemetry?.status ?? 'UNAVAILABLE'}{s.engineering.servicesTelemetry?.ageMs ? ` (${Math.round(s.engineering.servicesTelemetry.ageMs / 1000)}s old)` : ''}
              </Card>
              <Card title="recovery throttle">
                {Object.keys(s.engineering.recoveryStates ?? {}).length
                  ? (Object.values(s.engineering.recoveryStates) as W[]).map((r: W) => (
                    <div key={r.service}><span style={{ color: r.blocking ? C.bad : r.state === 'OPEN' ? C.warn : C.ok }}>●</span> {r.service} — {r.state} · {r.cycles} cycle(s){r.cooldownRemainingMs ? ` · cooldown ${Math.round(r.cooldownRemainingMs / 1000)}s` : ''}</div>
                  ))
                  : 'no failures tracked — recovery throttle idle'}
              </Card>
            </>}

            {tab === 'revenue' && <>
              <Card title="verified revenue" tone={C.bad}><div style={{ fontSize: 20, fontWeight: 700 }}>{s.business.revenueVerified.split('—')[0]}</div></Card>
              <Card title="commercial offers" tone={s.commercial?.counts?.blocked ? C.warn : C.dim}>
                {s.commercial?.offers?.length ? s.commercial.offers.map((o: W) => (
                  <div key={o.offerId} style={{ marginBottom: 6 }}>
                    <b>{o.offerId}</b> — {o.product} ${(o.priceCents / 100).toFixed(2)} · <span style={{ color: o.isTest ? '#475569' : o.stage === 'CHECKOUT_READY' ? C.ok : o.stage === 'OFFER_BLOCKED' ? C.warn : C.dim }}>{o.isTest ? 'TEST FIXTURE' : o.stage}</span><br />
                    <small style={{ color: '#475569' }}>{o.title} · {o.isTest ? 'test/qualification evidence — not sellable inventory' : (o.stageReason ?? '')}</small>
                  </div>
                )) : 'no offers — opportunities require approval/qualification first'}
                <div style={{ color: C.dim, fontSize: 11, marginTop: 6 }}>
                  prepared {s.commercial?.counts?.prepared ?? 0} · checkout-ready {s.commercial?.counts?.checkoutReady ?? 0} · blocked {s.commercial?.counts?.blocked ?? 0} · needs authorization {s.commercial?.counts?.authRequired ?? 0}{(s.commercial?.counts?.testFixtures ?? 0) > 0 ? ` · ${s.commercial!.counts.testFixtures} test fixture(s)` : ''}
                </div>
              </Card>
              <Card title="jobs">{s.missions.jobs.total} total · {s.missions.jobs.paidDelivered} delivered (TEST) · {s.missions.jobs.escalated} escalated</Card>
              <Card title="truth contract">Test payments and checkouts are not revenue. Only reconciled production transactions count.</Card>
            </>}
          </>}
        </main>
      </div>
    </div>
  );
}
