import React, { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';

// Heidi COO Command Center — a projection over durable control-plane
// state. Nothing here is invented: agents/missions come from
// heidi_events (division='agents'), human actions from the normalized
// queue, COO state from the latest persisted coo_state snapshot.
// Stale values are labeled, never dressed up as live.

interface CooSnapshot {
  snapshotId: string;
  snapshotAt: string;
  ageMs: number;
  stale: boolean;
  verdict: string;
  applicationHealth: string;
  deployment?: { actualCommit?: string; daemonPid?: number; identity?: string; verdict?: string };
  goals?: { open?: number; inProgress?: number; pending?: number };
  protoforge?: { lastRunAt?: string; opportunitiesTotal?: number; pendingReview?: number };
  revenue?: { opportunitiesOpen?: number };
  nextAction?: { kind: string; reason?: string; capabilityId?: string };
  briefing?: string;
  humanActions?: unknown;
}
interface AgentRow {
  agentId: string; role: string; status: string; missionId: string;
  runtimeIdentity: string | null; lastHeartbeatAt: string | null;
  lastStep: string | null; authorizationLevel: string;
}
interface MissionRow {
  missionId: string; parentMissionId: string | null; role: string;
  objective: string; status: string; failure: string | null;
  result: unknown; attempt: number; updatedAt: string;
}
interface QueueItem {
  id: string; source: string; category: string; priority: number;
  status: string; reason: string; requestedAction: string;
  authorizationLevel: string; backlog?: boolean;
}
interface Msg { messageId: string; from: string; to: string; missionId: string | null; type: string; content: string; createdAt: string }
interface CooData {
  generatedAt: string;
  error?: string;
  coo: CooSnapshot | null;
  queue: { open: number; backlogRowCount: number; items: QueueItem[] } | null;
  agents: { active: number; stale: number; agents: AgentRow[]; missions: MissionRow[]; messages: Msg[] } | null;
}

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: '#3fb950', RUNNING: '#58a6ff', FAILED: '#f85149', STALE: '#d29922',
  NEEDS_HUMAN: '#f85149', STOPPED: '#8b949e', REGISTERED: '#8b949e',
  PENDING: '#8b949e', OPEN: '#f85149', ACKNOWLEDGED: '#d29922', EXPIRED: '#8b949e',
};

function ago(ts: string | null | undefined): string {
  if (!ts) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

const mono: React.CSSProperties = { fontFamily: 'Consolas, monospace', fontSize: 12 };
const cell: React.CSSProperties = { padding: '3px 8px', borderBottom: '1px solid #21262d', verticalAlign: 'top' };
const box: React.CSSProperties = { background: '#161b22', border: '1px solid #30363d', borderRadius: 6, padding: 10, marginBottom: 10 };

export default function CooCommandCenter() {
  const [data, setData] = useState<CooData | null>(null);
  const [chat, setChat] = useState<Array<{ who: string; text: string }>>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [selAgent, setSelAgent] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/coo');
      setData(await r.json());
    } catch { /* keep last state — staleness is displayed, not hidden */ }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const send = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setChat((c) => [...c, { who: 'you', text }]);
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, session_id: 'coo-ui', user_id: 'operator' }),
      });
      const raw = await r.text();
      const content = raw.split('\n')
        .filter((l) => l.startsWith('data: ') && l.includes('"content"'))
        .map((l) => { try { return JSON.parse(l.slice(6)).content } catch { return '' } })
        .join('');
      setChat((c) => [...c, { who: 'heidi', text: content || '(no response)' }]);
      setTimeout(load, 1500);
    } catch (e) {
      setChat((c) => [...c, { who: 'heidi', text: `request failed: ${e instanceof Error ? e.message : 'unknown'}` }]);
    } finally { setBusy(false); }
  }, [busy, load]);

  useEffect(() => { logRef.current?.scrollTo(0, 1e6); }, [chat]);

  const coo = data?.coo ?? null;
  const agents = data?.agents;
  const queue = data?.queue;
  const selMission = selAgent ? agents?.missions.find((m) => m.missionId === agents.agents.find((a) => a.agentId === selAgent)?.missionId) : null;
  const selMessages = selAgent ? agents?.messages.filter((m) => m.from === selAgent || m.to === selAgent || m.missionId === selMission?.missionId) : [];

  return (
    <div style={{ background: '#0d1117', color: '#c9d1d9', minHeight: '100vh', padding: 16, ...mono }}>
      <Head><title>Heidi COO</title></Head>

      <div style={{ ...box, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <b style={{ fontSize: 15 }}>HEIDI · COO COMMAND</b>
          <span style={{ marginLeft: 12, color: STATUS_COLOR[coo?.verdict ?? ''] ?? '#8b949e' }}>
            {coo ? `${coo.verdict} · health ${coo.applicationHealth}` : data?.error ? `UNKNOWN — ${data.error}` : 'UNKNOWN'}
          </span>
        </div>
        <div style={{ color: '#8b949e' }}>
          {coo ? <>commit {coo.deployment?.actualCommit ?? '?'} · daemon {coo.deployment?.daemonPid ?? '?'} · </> : null}
          {coo?.stale
            ? <b style={{ color: '#d29922' }}>STALE · updated {ago(coo.snapshotAt)}</b>
            : <>updated {ago(coo?.snapshotAt)} · data {ago(data?.generatedAt)}</>}
        </div>
      </div>

      {coo?.nextAction && (
        <div style={{ ...box, borderLeft: '3px solid #58a6ff' }}>
          <b>NEXT ACTION:</b> {coo.nextAction.kind}{coo.nextAction.capabilityId ? ` · ${coo.nextAction.capabilityId}` : ''}
          {coo.nextAction.reason ? <div style={{ color: '#8b949e' }}>{coo.nextAction.reason}</div> : null}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={box}>
          <b>AGENTS</b> <span style={{ color: '#8b949e' }}>{agents ? `${agents.active} active · ${agents.stale} stale` : 'UNKNOWN'}</span>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <thead><tr style={{ color: '#8b949e', textAlign: 'left' }}>
              <th style={cell}>agent</th><th style={cell}>role</th><th style={cell}>status</th><th style={cell}>heartbeat</th><th style={cell}>step</th><th style={cell}>auth</th>
            </tr></thead>
            <tbody>
              {(agents?.agents ?? []).map((a) => (
                <tr key={a.agentId} onClick={() => setSelAgent(a.agentId === selAgent ? null : a.agentId)}
                  style={{ cursor: 'pointer', background: selAgent === a.agentId ? '#21262d' : 'transparent' }}>
                  <td style={cell}>{a.agentId.slice(0, 34)}</td>
                  <td style={cell}>{a.role}</td>
                  <td style={{ ...cell, color: STATUS_COLOR[a.status] ?? '#c9d1d9' }}>{a.status}</td>
                  <td style={cell}>{ago(a.lastHeartbeatAt)}</td>
                  <td style={cell}>{a.lastStep ?? '—'}</td>
                  <td style={cell}>{a.authorizationLevel}</td>
                </tr>
              ))}
              {(agents?.agents.length ?? 0) === 0 && <tr><td style={cell} colSpan={6}>no agents registered</td></tr>}
            </tbody>
          </table>
          {selAgent && selMission && (
            <div style={{ marginTop: 8, padding: 8, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4 }}>
              <b>MISSION {selMission.missionId}</b> <span style={{ color: STATUS_COLOR[selMission.status] }}>{selMission.status}</span>
              <div>objective: {selMission.objective}</div>
              {selMission.failure && <div style={{ color: '#f85149' }}>failure: {selMission.failure}</div>}
              {selMission.result != null && <div>result: <code>{JSON.stringify(selMission.result).slice(0, 400)}</code></div>}
              <div style={{ marginTop: 4, color: '#8b949e' }}>
                {(selMessages ?? []).map((m) => <div key={m.messageId}>[{m.type}] {m.from} → {m.to}: {m.content.slice(0, 90)}</div>)}
              </div>
            </div>
          )}
        </div>

        <div style={box}>
          <b>MISSIONS</b>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
            <thead><tr style={{ color: '#8b949e', textAlign: 'left' }}>
              <th style={cell}>mission</th><th style={cell}>role</th><th style={cell}>status</th><th style={cell}>objective</th>
            </tr></thead>
            <tbody>
              {(agents?.missions ?? []).slice(-10).reverse().map((m) => (
                <tr key={m.missionId}>
                  <td style={cell}>{m.missionId.slice(0, 20)}{m.parentMissionId ? ' ↳' : ''}</td>
                  <td style={cell}>{m.role}</td>
                  <td style={{ ...cell, color: STATUS_COLOR[m.status] ?? '#c9d1d9' }}>{m.status}</td>
                  <td style={cell}>{m.objective.slice(0, 48)}</td>
                </tr>
              ))}
              {(agents?.missions.length ?? 0) === 0 && <tr><td style={cell} colSpan={4}>no missions</td></tr>}
            </tbody>
          </table>
          <div style={{ marginTop: 8, color: '#8b949e' }}>
            ProtoForge: {coo?.protoforge ? `${coo.protoforge.opportunitiesTotal ?? 0} opportunities, ${coo.protoforge.pendingReview ?? 0} pending review` : 'UNKNOWN'}
            {' · '}Revenue: {coo?.revenue ? `${coo.revenue.opportunitiesOpen ?? 0} open` : 'UNKNOWN'}
          </div>
        </div>
      </div>

      <div style={box}>
        <b>HUMAN ACTIONS</b> <span style={{ color: '#8b949e' }}>{queue ? `${queue.open} open · ${queue.backlogRowCount} backlog rows` : 'UNKNOWN'}</span>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
          <thead><tr style={{ color: '#8b949e', textAlign: 'left' }}>
            <th style={cell}>item</th><th style={cell}>source</th><th style={cell}>status</th><th style={cell}>reason</th><th style={cell}>auth</th><th style={cell}></th>
          </tr></thead>
          <tbody>
            {(queue?.items ?? []).filter((i) => i.status === 'OPEN' || i.status === 'ACKNOWLEDGED').map((i) => (
              <tr key={i.id}>
                <td style={cell}>{i.id.slice(0, 42)}</td>
                <td style={cell}>{i.source}</td>
                <td style={{ ...cell, color: STATUS_COLOR[i.status] ?? '#c9d1d9' }}>{i.status}{i.backlog ? ' · backlog' : ''}</td>
                <td style={cell}>{i.reason.slice(0, 70)}</td>
                <td style={cell}>{i.authorizationLevel}</td>
                <td style={cell}>
                  {!i.backlog && i.status === 'OPEN' && (
                    <span style={{ display: 'flex', gap: 4 }}>
                      {['acknowledge', 'approve', 'reject'].map((v) => (
                        <button key={v} disabled={busy} onClick={() => send(`${v} ${i.id}`)}
                          style={{ ...mono, background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>
                          {v}
                        </button>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {(queue?.items.filter((i) => i.status === 'OPEN' || i.status === 'ACKNOWLEDGED').length ?? 0) === 0 &&
              <tr><td style={cell} colSpan={6}>no open human actions</td></tr>}
          </tbody>
        </table>
      </div>

      <div style={box}>
        <b>CONVERSATION</b>
        <div ref={logRef} style={{ height: 180, overflowY: 'auto', marginTop: 6, padding: 6, background: '#0d1117', borderRadius: 4 }}>
          {chat.length === 0 && <div style={{ color: '#8b949e' }}>Ask Heidi: "how's it going?" · "what needs my attention?" · commands: acknowledge|stop|retry|approve|reject|inspect &lt;id&gt;</div>}
          {chat.map((m, i) => (
            <div key={i} style={{ marginBottom: 6, whiteSpace: 'pre-wrap' }}>
              <b style={{ color: m.who === 'you' ? '#58a6ff' : '#3fb950' }}>{m.who}:</b> {m.text}
            </div>
          ))}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); send(input); setInput(''); }} style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} disabled={busy}
            placeholder="talk to Heidi — commands are exact: 'stop agent-…'"
            style={{ ...mono, flex: 1, background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '6px 10px' }} />
          <button type="submit" disabled={busy} style={{ ...mono, background: '#238636', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: 'pointer' }}>send</button>
        </form>
      </div>
    </div>
  );
}
