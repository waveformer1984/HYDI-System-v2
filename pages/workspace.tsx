/**
 * ProtoForge Workspace — the unified Heidi operational surface.
 * All module data comes from /api/workspace/state (live durable state).
 * Chat embeds the existing governed /api/chat SSE stream.
 */
import { useEffect, useRef, useState } from 'react';

type W = Record<string, any>;

const NAV = ['overview', 'agents', 'missions', 'decisions', 'recommend', 'opportunities', 'engineering', 'revenue'];

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
  const send = async () => {
    if (!input.trim() || busy) return;
    const m = input; setInput(''); setBusy(true);
    setMsgs(v => [...v, { role: 'you', text: m }, { role: 'agent', text: '…' }]);
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: m, session_id: 'workspace', user_id: 'j', agent: agent === 'heidi' ? undefined : agent }) });
      const text = await r.text();
      const content = [...text.matchAll(/"content":"((?:[^"\\]|\\.)*)"/g)].map(x => JSON.parse(`"${x[1]}"`)).join('');
      setMsgs(v => [...v.slice(0, -1), { role: 'agent', text: content || '(no content)' }]);
    } catch (e) { setMsgs(v => [...v.slice(0, -1), { role: 'agent', text: `error: ${e}` }]); }
    setBusy(false);
  };
  useEffect(() => { ref.current?.scrollTo(0, ref.current.scrollHeight); }, [msgs]);
  return (
    <div style={{ borderTop: '1px solid #1e293b', padding: '10px 14px', background: '#0b1220' }}>
      <div ref={ref} style={{ maxHeight: 180, overflowY: 'auto', fontSize: 13 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ marginBottom: 6 }}>
            <span style={{ color: m.role === 'you' ? C.accent : C.ok, fontWeight: 600 }}>{m.role === 'you' ? 'J' : label}</span>
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
      const r = await fetch('/api/workspace/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, ...body }) });
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

export default function Workspace() {
  const [s, setS] = useState<W | null>(null);
  const [tab, setTab] = useState('overview');
  const [chatAgent, setChatAgent] = useState('heidi');
  const [err, setErr] = useState<string | null>(null);
  const reload = () => fetch('/api/workspace/state').then(r => r.json()).then(setS).catch(e => setErr(String(e)));
  useEffect(() => {
    const load = () => fetch('/api/workspace/state').then(r => r.json()).then(setS).catch(e => setErr(String(e)));
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const healthColor = s?.system?.health === 'HEALTHY' ? C.ok : s?.system?.health ? C.warn : C.dim;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#020617', color: '#e2e8f0', fontFamily: 'ui-monospace, Menlo, monospace' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px', borderBottom: '1px solid #1e293b' }}>
        <strong style={{ fontSize: 14, letterSpacing: 2 }}>PROTOFORGE</strong>
        <span style={st(C.dim)}>heidi workspace</span>
        {s && <>
          <span style={{ marginLeft: 'auto', ...st(healthColor) }}>● {s.system.health}{s.system.cooStale ? ' (stale)' : ''}</span>
          <span style={st(C.accent)}>AUTONOMY {s.system.autonomyLevel} · {s.system.autonomyName}</span>
          <span style={st(C.dim)}>{s.engineering.head}</span>
        </>}
      </header>
      {s && <TelemetryBanner eng={s.engineering} />}
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
          {err && <Card title="error" tone={C.bad}>{err}</Card>}
          {!s ? <Card title="loading">reading live state…</Card> : <>
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
                      : <small style={{ color: '#475569' }}>ACTION UNAVAILABLE — no governed capability for this class; review evidence manually</small>}
                    <small style={{ color: C.dim }}> authority: J · evidence: {d.id}</small>
                  </div>
                )) : 'nothing requires J right now'}
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

            {tab === 'engineering' && <>
              <Card title="services">{s.engineering.servicesOnline}/{s.engineering.servicesTotal} online{s.engineering.services.map((v: W) => <div key={v.name}><span style={{ color: v.status === 'online' ? C.ok : C.bad }}>●</span> {v.name} <span style={{ color: '#475569' }}>{Math.round((v.memory ?? 0) / 1048576)}MB · {v.restarts ?? 0} restarts</span></div>)}</Card>
              <Card title="runtime">
                HEAD {s.engineering.head} · {s.engineering.dirtyPaths} dirty paths
                {' · '}Ollama {s.engineering.ollama.ok ? `up (${s.engineering.ollama.models.length} models)` : 'down'}
                {' · '}<span style={{ color: ({ HEALTHY: C.ok, DEGRADED: C.warn, TIMEOUT: C.bad, UNAVAILABLE: C.bad, STALE: C.dim } as Record<string, string>)[s.engineering.supabaseRestTelemetry?.status ?? 'UNAVAILABLE'] }}>●</span> Supabase REST {s.engineering.supabaseRestTelemetry?.status ?? 'UNAVAILABLE'}{s.engineering.supabaseRest?.ms != null ? ` ${s.engineering.supabaseRest.ms}ms` : ''}{s.engineering.supabaseRest?.circuit === 'open' ? ' (circuit open)' : ''}
                {' · '}<span style={{ color: ({ HEALTHY: C.ok, STALE: C.dim, TIMEOUT: C.bad, UNAVAILABLE: C.bad, DEGRADED: C.bad } as Record<string, string>)[s.engineering.servicesTelemetry?.status ?? 'UNAVAILABLE'] }}>●</span> PM2 {s.engineering.servicesTelemetry?.status ?? 'UNAVAILABLE'}{s.engineering.servicesTelemetry?.ageMs ? ` (${Math.round(s.engineering.servicesTelemetry.ageMs / 1000)}s old)` : ''}
              </Card>
            </>}

            {tab === 'revenue' && <>
              <Card title="verified revenue" tone={C.bad}><div style={{ fontSize: 20, fontWeight: 700 }}>{s.business.revenueVerified.split('—')[0]}</div></Card>
              <Card title="jobs">{s.missions.jobs.total} total · {s.missions.jobs.paidDelivered} delivered (TEST) · {s.missions.jobs.escalated} escalated</Card>
              <Card title="truth contract">Test payments and checkouts are not revenue. Only reconciled production transactions count.</Card>
            </>}
          </>}
        </main>
      </div>
      <div style={{ borderTop: '1px solid #1e293b', padding: '4px 14px 0', background: '#0b1220', display: 'flex', gap: 10, alignItems: 'center' }}>
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
    </div>
  );
}
