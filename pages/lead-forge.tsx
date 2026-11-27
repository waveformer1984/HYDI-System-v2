import React from 'react';
import Head from 'next/head';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GetServerSideProps } from 'next';
import { listNiches } from '../lead-forge/lib/config';

type Niche = { id: string; label: string };
type PackRow = {
  id: string;
  niche: string;
  city: string;
  radius: number;
  lead_count: number;
  delivery_status: string;
  created_at: string;
};
type LeadRow = {
  id: string;
  pack_id: string;
  business_name: string;
  category: string | null;
  fit_score: number | null;
  status: string;
  signals: string[];
  fit_reasons: string[];
  email_1: string | null;
  email_2: string | null;
  email_3: string | null;
  notes: string | null;
  next_follow_up: string | null;
  phone: string | null;
  website: string | null;
  email: string | null;
};
type ActivityRow = { id: string; lead_id: string; kind: string; body: string; created_at: string };
type JobRow = { id: string; status: string; packId: string | null; error: string | null; boardWarning?: string | null };

const PIPELINE = [
  'new', 'reviewed', 'approved', 'contacted', 'replied', 'won', 'lost', 'do_not_contact',
] as const;

const shell: React.CSSProperties = {
  maxWidth: 380,
  margin: '0 auto',
  minHeight: '100vh',
  fontFamily: 'system-ui, -apple-system, sans-serif',
  fontSize: 15,
  lineHeight: 1.4,
  color: '#111',
  background: '#f4f6f8',
  padding: '10px 12px 80px',
};

type PageProps = { niches: Niche[] };

export const getServerSideProps: GetServerSideProps<PageProps> = async () => ({
  props: {
    niches: listNiches().map((n) => ({ id: n.id, label: n.id.replace(/-/g, ' ') })),
  },
});

function authHeaders(): HeadersInit {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('HYDI_SERVICE_TOKEN');
  return token ? { 'x-hydi-service-token': token } : {};
}

async function apiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

export default function LeadForgePage({ niches }: PageProps) {
  const [niche, setNiche] = useState(niches[0]?.id || 'hvac');
  const [city, setCity] = useState('San Antonio, TX');
  const [radius, setRadius] = useState(25);
  const [count, setCount] = useState(25);
  const [outreach, setOutreach] = useState(false);
  const [job, setJob] = useState<JobRow | null>(null);
  const [packs, setPacks] = useState<PackRow[]>([]);
  const [selectedPackId, setSelectedPackId] = useState<string | null>(null);
  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sortDesc, setSortDesc] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === selectedLeadId) || null,
    [leads, selectedLeadId],
  );

  const filteredLeads = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let rows = [...leads];
    if (q) rows = rows.filter((l) => l.business_name.toLowerCase().includes(q) || (l.category || '').toLowerCase().includes(q));
    rows.sort((a, b) => (sortDesc ? 1 : -1) * ((b.fit_score || 0) - (a.fit_score || 0)));
    return rows;
  }, [leads, filter, sortDesc]);

  const pipelineCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const s of PIPELINE) counts[s] = 0;
    for (const lead of leads) counts[lead.status] = (counts[lead.status] || 0) + 1;
    return counts;
  }, [leads]);

  const loadPacks = useCallback(async () => {
    const data = await apiJson('/api/lead-forge/packs');
    setPacks(data.packs || []);
  }, []);

  const loadPack = useCallback(async (packId: string) => {
    const data = await apiJson(`/api/lead-forge/packs/${encodeURIComponent(packId)}`);
    setLeads(data.leads || []);
    setActivities(data.activities || []);
    setSelectedPackId(packId);
    setSelectedLeadId(null);
  }, []);

  useEffect(() => { loadPacks().catch((e) => setError(e.message)); }, [loadPacks]);

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const data = await apiJson(`/api/lead-forge/jobs/${job.id}`);
        const next = data.job as JobRow;
        setJob(next);
        if (next.status === 'completed' && next.packId) {
          await loadPacks();
          await loadPack(next.packId);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'job poll failed');
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [job, loadPack, loadPacks]);

  async function startPack() {
    setBusy(true);
    setError(null);
    try {
      const data = await apiJson('/api/lead-forge/packs', {
        method: 'POST',
        body: JSON.stringify({ niche, city, radius, count, outreach }),
      });
      setJob({ id: data.jobId, status: data.status, packId: null, error: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'start failed');
    } finally {
      setBusy(false);
    }
  }

  async function patchLead(patch: Partial<LeadRow>) {
    if (!selectedLead) return;
    setBusy(true);
    try {
      const data = await apiJson(`/api/lead-forge/leads/${selectedLead.id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      setLeads((rows) => rows.map((r) => (r.id === selectedLead.id ? data.lead : r)));
      if (selectedPackId) await loadPack(selectedPackId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'update failed');
    } finally {
      setBusy(false);
    }
  }

  async function suppressLead() {
    if (!selectedLead) return;
    setBusy(true);
    try {
      await apiJson(`/api/lead-forge/leads/${selectedLead.id}/suppress`, { method: 'POST', body: '{}' });
      if (selectedPackId) await loadPack(selectedPackId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'suppress failed');
    } finally {
      setBusy(false);
    }
  }

  const leadActivities = useMemo(
    () => activities.filter((a) => a.lead_id === selectedLeadId),
    [activities, selectedLeadId],
  );

  return (
    <>
      <Head>
        <title>Lead Forge</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>
      <main style={shell}>
        <header style={{ marginBottom: 12 }}>
          <h1 style={{ fontSize: 20, margin: '0 0 4px' }}>Lead Forge</h1>
          <p style={{ margin: 0, color: '#555', fontSize: 13 }}>Review-only packs · copy drafts manually · no auto-send</p>
        </header>

        {error && (
          <ErrorBanner onClick={() => setError(null)}>{error}</ErrorBanner>
        )}

        <section style={card}>
          <h2 style={h2}>Generate pack</h2>
          <label style={label}>Niche</label>
          <select style={input} value={niche} onChange={(e) => setNiche(e.target.value)}>
            {niches.map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
          </select>
          <label style={label}>City</label>
          <input style={input} value={city} onChange={(e) => setCity(e.target.value)} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <label style={label}>Radius (mi)</label>
              <input style={input} type="number" min={1} max={100} value={radius} onChange={(e) => setRadius(Number(e.target.value))} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={label}>Count</label>
              <input style={input} type="number" min={1} max={500} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </div>
          </div>
          <label style={{ ...label, display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="checkbox" checked={outreach} onChange={(e) => setOutreach(e.target.checked)} />
            Include outreach drafts in CSV
          </label>
          <button type="button" style={btnPrimary} disabled={busy} onClick={startPack}>Start pack job</button>
          {job && (
            <p style={{ marginTop: 10, fontSize: 13 }}>
              Job <code>{job.id.slice(0, 8)}</code> · <strong>{job.status}</strong>
              {job.boardWarning ? ` · board: ${job.boardWarning}` : ''}
              {job.error ? ` · ${job.error}` : ''}
            </p>
          )}
        </section>

        <section style={card}>
          <h2 style={h2}>Packs</h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {packs.map((p) => (
              <li key={p.id} style={{ marginBottom: 8 }}>
                <button type="button" style={btnGhost} onClick={() => loadPack(p.id)}>
                  {p.niche} · {p.city} · {p.lead_count} leads
                </button>
              </li>
            ))}
            {!packs.length && <li style={{ color: '#666' }}>No imported packs yet.</li>}
          </ul>
        </section>

        {selectedPackId && (
          <section style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h2 style={{ ...h2, marginBottom: 0 }}>Pack {selectedPackId}</h2>
              <a
                href={`/api/lead-forge/packs/${encodeURIComponent(selectedPackId)}?download=csv`}
                style={{ fontSize: 13 }}
              >
                CSV
              </a>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '10px 0' }}>
              {PIPELINE.map((s) => (
                <span key={s} style={pill}>{s.replace(/_/g, ' ')}: {pipelineCounts[s] || 0}</span>
              ))}
            </div>
            <input style={input} placeholder="Filter leads" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button type="button" style={{ ...btnGhost, marginTop: 6 }} onClick={() => setSortDesc((v) => !v)}>
              Sort fit score {sortDesc ? '↓' : '↑'}
            </button>
            <div style={{ marginTop: 10, maxHeight: 220, overflowY: 'auto' }}>
              {filteredLeads.map((lead) => (
                <button
                  key={lead.id}
                  type="button"
                  style={{ ...btnGhost, width: '100%', textAlign: 'left', marginBottom: 6 }}
                  onClick={() => setSelectedLeadId(lead.id)}
                >
                  <strong>{lead.business_name}</strong>
                  <span style={{ color: '#666' }}> · {lead.fit_score ?? '—'}</span>
                  <span style={{ display: 'block', fontSize: 12, color: '#555' }}>{lead.status}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {selectedLead && (
          <section style={card}>
            <h2 style={h2}>{selectedLead.business_name}</h2>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#444' }}>
              Score {selectedLead.fit_score ?? '—'} · {selectedLead.category || '—'}
            </p>
            <p style={{ fontSize: 12, color: '#555' }}>Signals: {(selectedLead.signals || []).join(', ') || '—'}</p>
            <p style={{ fontSize: 12, color: '#555' }}>Reasons: {(selectedLead.fit_reasons || []).join('; ') || '—'}</p>
            <StatusRow status={selectedLead.status} onPick={(s: string) => patchLead({ status: s })} disabled={busy} />
            <label style={label}>Notes</label>
            <textarea
              style={{ ...input, minHeight: 64 }}
              value={selectedLead.notes || ''}
              onChange={(e) => patchLead({ notes: e.target.value })}
            />
            <label style={label}>Next follow-up (YYYY-MM-DD)</label>
            <input
              style={input}
              value={selectedLead.next_follow_up || ''}
              onChange={(e) => patchLead({ next_follow_up: e.target.value || null })}
            />
            {(['email_1', 'email_2', 'email_3'] as const).map((key, idx) => (
              <div key={key} style={{ marginTop: 8 }}>
                <label style={label}>Draft {idx + 1} (copy only)</label>
                <textarea
                  style={{ ...input, minHeight: 72, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                  value={selectedLead[key] || ''}
                  onChange={(e) => patchLead({ [key]: e.target.value })}
                />
                <button
                  type="button"
                  style={{ ...btnGhost, marginTop: 4 }}
                  onClick={() => navigator.clipboard?.writeText(selectedLead[key] || '')}
                >
                  Copy draft
                </button>
              </div>
            ))}
            <button type="button" style={{ ...btnDanger, marginTop: 10 }} disabled={busy} onClick={suppressLead}>
              Suppress business
            </button>
            <h3 style={{ fontSize: 14, marginTop: 14 }}>Activity</h3>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
              {leadActivities.map((a) => (
                <li key={a.id} style={{ marginBottom: 4 }}>{a.created_at}: [{a.kind}] {a.body}</li>
              ))}
              {!leadActivities.length && <li>No activity yet.</li>}
            </ul>
          </section>
        )}
      </main>
    </>
  );
}

function ErrorBanner({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return (
    <div role="button" tabIndex={0} onClick={onClick} onKeyDown={() => {}} style={{ background: '#fde8e8', color: '#7f1d1d', padding: 10, borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
      {children}
    </div>
  );
}

function StatusRow({ status, onPick, disabled }: { status: string; onPick: (s: string) => void; disabled: boolean }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
      {PIPELINE.map((s) => (
        <button
          key={s}
          type="button"
          disabled={disabled}
          style={{
            ...pill,
            border: status === s ? '2px solid #111' : '1px solid #ccc',
            cursor: disabled ? 'default' : 'pointer',
            background: status === s ? '#e8eef8' : '#fff',
          }}
          onClick={() => onPick(s)}
        >
          {s.replace(/_/g, ' ')}
        </button>
      ))}
    </div>
  );
}

const card: React.CSSProperties = { background: '#fff', border: '1px solid #d8dee4', borderRadius: 12, padding: 12, marginBottom: 12 };
const h2: React.CSSProperties = { fontSize: 16, margin: '0 0 8px' };
const label: React.CSSProperties = { display: 'block', fontSize: 12, color: '#555', marginTop: 8, marginBottom: 4 };
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', fontSize: 14 };
const btnPrimary: React.CSSProperties = { marginTop: 12, width: '100%', padding: '10px 12px', borderRadius: 8, border: 'none', background: '#1f6feb', color: '#fff', fontWeight: 600, fontSize: 14 };
const btnGhost: React.CSSProperties = { padding: '8px 10px', borderRadius: 8, border: '1px solid #ccc', background: '#fafafa', fontSize: 13 };
const btnDanger: React.CSSProperties = { ...btnPrimary, background: '#b42318' };
const pill: React.CSSProperties = { fontSize: 11, padding: '4px 6px', borderRadius: 999, background: '#f0f3f6', border: '1px solid #e5e9ee' };