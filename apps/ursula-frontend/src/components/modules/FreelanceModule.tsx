/**
 * FreelanceModule — Heidi's job scout in Ursula.
 *
 * LIVE mode: reads /api/job-scout (ranked leads that heidi-job-scout finds on
 * Freelancer.com, Remotive, RemoteOK and HN "Seeking freelancer" every 3h)
 * and records Jordan's decisions via POST /api/job-scout/:id.
 * TEST mode: sample leads, nothing written.
 *
 * Heidi never applies. "Mark applied" is a marker Jordan sets after applying
 * on the site himself; drafts are starters to edit, not messages to send.
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Briefcase, Search, FileText, Star, Clock, CheckCircle2, AlertCircle,
  ExternalLink, X, Copy, RefreshCw, Bookmark, Play,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

type Decision = 'shortlisted' | 'dismissed' | 'applied';

interface Lead {
  id: string;
  source: string;
  sourceUrl: string;
  title: string;
  description: string;
  company: string | null;
  budget: { min: number | null; max: number | null; currency: string; type: string; text?: string | null };
  skills: string[];
  postedAt: string | null;
  score: number;
  division: string | null;
  matched: string[];
  reasons: string[];
  draft: string | null;
  decision?: { status: Decision; at: string } | null;
}

interface ScoutStatus {
  ranAt: string;
  ok: boolean;
  sources: Record<string, { ok: boolean; count: number; error?: string }>;
  newLeads: number;
}

const SOURCE_LABEL: Record<string, string> = {
  freelancer: 'Freelancer.com', remotive: 'Remotive', remoteok: 'RemoteOK', hn: 'HN Seeking Freelancer',
};

const SAMPLE: Lead[] = [
  { id: 'freelancer:1', source: 'freelancer', sourceUrl: '#', title: '[sample] Next.js dashboard with Stripe billing', description: 'Sample lead shown in test mode.', company: null, budget: { min: 800, max: 2000, currency: 'USD', type: 'fixed' }, skills: ['React.js', 'Stripe'], postedAt: new Date().toISOString(), score: 88, division: 'AppForge', matched: ['next.js', 'stripe'], reasons: ['matches AppForge: next.js, stripe'], draft: 'Hi — I read your post…\n\n[EDIT: questions]', decision: null },
  { id: 'hn:2', source: 'hn', sourceUrl: '#', title: '[sample] SEEKING FREELANCER | Remote | LLM chatbot for support', description: 'Sample lead shown in test mode.', company: null, budget: { min: null, max: null, currency: 'USD', type: 'unknown' }, skills: [], postedAt: new Date().toISOString(), score: 64, division: 'Build-A-Mind', matched: ['llm', 'chatbot'], reasons: ['matches Build-A-Mind: llm, chatbot'], draft: null, decision: { status: 'shortlisted', at: new Date().toISOString() } },
];

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'shortlisted', label: 'Shortlisted' },
  { key: 'applied', label: 'Applied' },
  { key: 'dismissed', label: 'Dismissed' },
  { key: 'all', label: 'All' },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

function matchesFilter(l: Lead, f: FilterKey) {
  const s = l.decision?.status;
  if (f === 'all') return true;
  if (f === 'open') return !s || s === 'shortlisted';
  return s === f;
}

function fmtBudget(b: Lead['budget']) {
  if (b.text) return b.text;
  if (b.min == null && b.max == null) return '—';
  const cur = b.currency === 'USD' ? '$' : `${b.currency} `;
  const range = b.max && b.max !== b.min ? `${cur}${b.min ?? 0}–${cur}${b.max}` : `${cur}${b.min ?? b.max}`;
  return `${range}${b.type === 'hourly' ? '/hr' : b.type === 'annual' ? '/yr' : ''}`;
}

function ago(iso: string | null) {
  if (!iso) return '?';
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  return h < 1 ? 'just now' : h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function scoreColor(n: number) {
  return n >= 75 ? '#3fb950' : n >= 55 ? '#d29922' : '#8b949e';
}

export default function FreelanceModule() {
  const { isLive } = useMode();
  const [leads, setLeads] = useState<Lead[]>(SAMPLE);
  const [status, setStatus] = useState<ScoutStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<FilterKey>('open');
  const [openDraft, setOpenDraft] = useState<string | null>(null);
  const [scanIntervalMs, setScanIntervalMs] = useState(10800000);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    if (!isLive) { setLeads(SAMPLE); setStatus(null); setError(null); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/job-scout', { cache: 'no-store' });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setLeads(body.leads || []);
      setStatus(body.status || null);
      if (typeof body.scanIntervalMs === 'number' && body.scanIntervalMs > 0) setScanIntervalMs(body.scanIntervalMs);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'could not load leads');
    } finally {
      setLoading(false);
    }
  }, [isLive]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = isLive ? setInterval(load, 60000) : null;
    return () => { clearTimeout(first); if (t) clearInterval(t); };
  }, [load, isLive]);

  const decide = useCallback(async (id: string, next: Decision | 'clear') => {
    if (!isLive) {
      setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, decision: next === 'clear' ? null : { status: next, at: new Date().toISOString() } } : l)));
      return;
    }
    try {
      const res = await fetch(`/api/job-scout/${encodeURIComponent(id)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ursula-request': '1' },
        body: JSON.stringify({ status: next }),
      });
      const body = await res.json();
      if (!body.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, decision: body.decision } : l)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'could not save decision');
    }
  }, [isLive]);

  const runScanNow = useCallback(async () => {
    if (!isLive) return;
    setRunning(true);
    setRunMsg(null);
    try {
      const res = await fetch('/api/job-scout/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-ursula-request': '1' },
      });
      const body = await res.json();
      setRunMsg(body.ok ? 'Scan mission filed with heidi-core — it runs on the next scheduler tick.' : `Could not file scan mission: ${body.error || `HTTP ${res.status}`}`);
    } catch (e: unknown) {
      setRunMsg(`Could not file scan mission: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRunning(false);
    }
  }, [isLive]);

  const filtered = useMemo(() => leads.filter((l) => matchesFilter(l, filter)), [leads, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, leads.filter((l) => matchesFilter(l, f.key)).length])), [leads]);
  const strong = leads.filter((l) => l.score >= 75 && matchesFilter(l, 'open')).length;
  const scanAgeMs = status && status.ranAt ? Date.now() - Date.parse(status.ranAt) : null;
  const stale = scanAgeMs != null && scanAgeMs > 2 * scanIntervalMs;

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-2">
        <Briefcase size={20} style={{ color: '#3fb950' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>Freelance — Heidi job scout</h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#3fb95015', color: '#3fb950' }}>
          {counts.open} open
        </span>
        {!isLive && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#d2992215', color: '#d29922' }}>test mode · sample data</span>
        )}
        <button onClick={load} disabled={loading} className="ml-auto flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
        {isLive && (
          <button onClick={runScanNow} disabled={running} className="flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded border" style={{ borderColor: 'var(--border-color)', color: '#58a6ff' }}>
            <Play size={10} /> {running ? 'Filing…' : 'Run scan now'}
          </button>
        )}
      </div>
      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        Heidi scans Freelancer.com, Remotive, RemoteOK and HN &ldquo;Seeking freelancer&rdquo; every 3 hours and ranks posts against your divisions. She never applies — you shortlist, edit the draft and apply on the site yourself.
      </p>

      {/* Scan status */}
      {isLive && (
        <div className="mb-4 p-3 rounded-md border text-[11px] font-mono" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
          {status ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex items-center gap-1"><Clock size={10} /> last scan {ago(status.ranAt)} · {status.newLeads} new</span>
              {Object.entries(status.sources || {}).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1" style={{ color: v.ok ? '#3fb950' : '#f85149' }} title={v.error || ''}>
                  {v.ok ? <CheckCircle2 size={10} /> : <AlertCircle size={10} />} {SOURCE_LABEL[k] || k}{v.ok ? ` ${v.count}` : ' failed'}
                </span>
              ))}
            </div>
          ) : (
            <span>No scan yet — heidi-job-scout runs under hydi-schedulers (or run <code>node scripts/job-scout.js --once</code>).</span>
          )}
        </div>
      )}
      {/* Stale scan banner — status.json older than 2x the scan interval */}
      {isLive && stale && (
        <div className="mb-4 p-3 rounded-md border text-[11px] font-mono flex items-center gap-2" style={{ background: '#f8514915', borderColor: '#f8514960', color: '#f85149' }}>
          <AlertCircle size={12} />
          Scan is stale — last run {ago(status?.ranAt || null)} (over 2× the {Math.round(scanIntervalMs / 3600000)}h interval). The scheduler may be down; use “Run scan now” to file a mission.
        </div>
      )}
      {runMsg && (
        <div className="mb-4 p-2 rounded text-[11px] font-mono" style={{ background: 'var(--bg-sidebar)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
          {runMsg}
        </div>
      )}
      {error && (
        <div className="mb-4 p-2 rounded text-[11px] font-mono flex items-center gap-2" style={{ background: '#f8514915', color: '#f85149' }}>
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { icon: <Search size={14} />, label: 'Open leads', value: counts.open, color: '#58a6ff' },
          { icon: <Star size={14} />, label: 'Strong (75+)', value: strong, color: '#3fb950' },
          { icon: <Bookmark size={14} />, label: 'Shortlisted', value: counts.shortlisted, color: '#bc8cff' },
          { icon: <CheckCircle2 size={14} />, label: 'Applied', value: counts.applied, color: '#d29922' },
        ].map((s) => (
          <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className="px-2.5 py-1 rounded text-[10px] font-mono transition-colors"
            style={{
              background: filter === f.key ? '#3fb95020' : 'transparent',
              color: filter === f.key ? '#3fb950' : 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            {f.label} ({counts[f.key]})
          </button>
        ))}
      </div>

      {/* Leads */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-[11px] font-mono p-4 text-center" style={{ color: 'var(--text-secondary)' }}>Nothing here yet.</div>
        )}
        {filtered.map((lead) => {
          const s = lead.decision?.status;
          return (
            <div key={lead.id} className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: s === 'shortlisted' ? '#bc8cff60' : 'var(--border-color)', opacity: s === 'dismissed' ? 0.6 : 1 }}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <a href={lead.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline" style={{ color: 'var(--text-active)' }}>
                  {lead.title}
                </a>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-mono font-bold" style={{ color: '#3fb950' }}>{fmtBudget(lead.budget)}</span>
                  <span className="text-[11px] font-mono font-bold px-2 py-0.5 rounded" style={{ color: scoreColor(lead.score), background: `${scoreColor(lead.score)}15` }}>{lead.score}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[10px] font-mono mb-2" style={{ color: 'var(--text-secondary)' }}>
                <span className="flex items-center gap-1"><ExternalLink size={9} /> {SOURCE_LABEL[lead.source] || lead.source}{lead.company ? ` · ${lead.company}` : ''}</span>
                {lead.division && <span>{lead.division}</span>}
                <span className="flex items-center gap-1"><Clock size={9} /> {ago(lead.postedAt)}</span>
                {lead.matched.length > 0 && <span>{lead.matched.slice(0, 5).join(' · ')}</span>}
                {s && <span style={{ color: s === 'applied' ? '#d29922' : s === 'shortlisted' ? '#bc8cff' : '#8b949e' }}>{s}</span>}
              </div>
              <p className="text-[11px] mb-3 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>{lead.description}</p>
              <div className="flex flex-wrap items-center gap-2">
                <a href={lead.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono px-2 py-1 rounded border flex items-center gap-1" style={{ borderColor: 'var(--border-color)', color: 'var(--text-active)' }}>
                  <ExternalLink size={10} /> Open post
                </a>
                {s !== 'shortlisted' && <button onClick={() => decide(lead.id, 'shortlisted')} className="text-[10px] font-mono px-2 py-1 rounded border flex items-center gap-1" style={{ borderColor: 'var(--border-color)', color: '#bc8cff' }}><Bookmark size={10} /> Shortlist</button>}
                {s !== 'applied' && <button onClick={() => decide(lead.id, 'applied')} className="text-[10px] font-mono px-2 py-1 rounded border flex items-center gap-1" style={{ borderColor: 'var(--border-color)', color: '#d29922' }}><CheckCircle2 size={10} /> Mark applied</button>}
                {s !== 'dismissed' && <button onClick={() => decide(lead.id, 'dismissed')} className="text-[10px] font-mono px-2 py-1 rounded border flex items-center gap-1" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}><X size={10} /> Dismiss</button>}
                {s && <button onClick={() => decide(lead.id, 'clear')} className="text-[10px] font-mono px-2 py-1 rounded" style={{ color: 'var(--text-secondary)' }}>Undo</button>}
                {lead.draft && (
                  <button onClick={() => setOpenDraft(openDraft === lead.id ? null : lead.id)} className="text-[10px] font-mono px-2 py-1 rounded border flex items-center gap-1 ml-auto" style={{ borderColor: 'var(--border-color)', color: '#58a6ff' }}>
                    <FileText size={10} /> {openDraft === lead.id ? 'Hide draft' : 'Draft'}
                  </button>
                )}
              </div>
              {openDraft === lead.id && lead.draft && (
                <div className="mt-3 p-3 rounded border" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-editor)' }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Starter draft — edit before sending; Heidi never sends it.</span>
                    <button onClick={() => navigator.clipboard?.writeText(lead.draft || '')} className="text-[10px] font-mono flex items-center gap-1" style={{ color: '#58a6ff' }}><Copy size={10} /> Copy</button>
                  </div>
                  <pre className="text-[11px] whitespace-pre-wrap font-mono" style={{ color: 'var(--text-active)' }}>{lead.draft}</pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
