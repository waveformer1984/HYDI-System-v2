import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Head from 'next/head';

type Job = {
  id: string;
  request_id: string;
  builder_company: string;
  contact_name: string;
  phone: string;
  lot_number: string;
  address: string;
  community?: string | null;
  phases: string[];
  sq_ft: number;
  stories: number;
  target_date?: string | null;
  closing_date?: string | null;
  notes?: string | null;
  estimate_cents?: number | null;
  crew_status: string;
  scheduled_at?: string | null;
  crew_label?: string | null;
  crew_notes?: string | null;
};

const QUEUE_KEY = 'makeready_crew_offline_queue';

function fmtMoney(cents?: number | null) {
  if (cents == null) return '—';
  return `$${(cents / 100).toFixed(2)}`;
}

function mapsUrl(address: string) {
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

function loadQueue(): unknown[] {
  if (typeof window === 'undefined') return [];
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(q: unknown[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

export default function MakeReadyCrewPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [pin, setPin] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selected, setSelected] = useState<Job | null>(null);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleAt, setScheduleAt] = useState('');
  const [crewLabel, setCrewLabel] = useState('');
  const [note, setNote] = useState('');

  const grouped = useMemo(() => {
    const g: Record<string, Job[]> = { new: [], scheduled: [], in_progress: [], done: [] };
    for (const j of jobs) {
      const key = g[j.crew_status] ? j.crew_status : 'new';
      g[key].push(j);
    }
    return g;
  }, [jobs]);

  const refreshJobs = useCallback(async () => {
    const res = await fetch('/api/makeready-crew/jobs', { credentials: 'include' });
    if (res.status === 401) {
      setAuthed(false);
      return;
    }
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'load_failed');
    setJobs(data.jobs);
    setAuthed(true);
  }, []);

  const flushQueue = useCallback(async () => {
    const queue = loadQueue();
    if (!queue.length || !navigator.onLine) return;
    setSyncing(true);
    try {
      const res = await fetch('/api/makeready-crew/sync', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queue }),
      });
      const data = await res.json();
      if (data.ok && Array.isArray(data.results)) {
        const failed = new Set(data.results.filter((r: { ok: boolean }) => !r.ok));
        const remaining = (queue as { clientId: string }[]).filter((q, i) => {
          const r = data.results[i];
          return !r?.ok;
        });
        saveQueue(remaining);
        if (!failed.size) await refreshJobs();
      }
    } finally {
      setSyncing(false);
    }
  }, [refreshJobs]);

  useEffect(() => {
    const on = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) flushQueue();
    };
    window.addEventListener('online', on);
    window.addEventListener('offline', on);
    setOnline(navigator.onLine);
    refreshJobs().catch(() => setAuthed(false));
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', on);
    };
  }, [refreshJobs, flushQueue]);

  async function login(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const res = await fetch('/api/makeready-crew/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) {
      setError('Sign-in failed. Check your PIN.');
      return;
    }
    setAuthed(true);
    await refreshJobs();
  }

  async function runAction(action: string, payload: Record<string, unknown> = {}) {
    if (!selected) return;
    setError(null);
    const clientId = `${selected.id}:${action}:${Date.now()}`;
    const body = { requestId: selected.id, action, payload };

    if (!navigator.onLine) {
      const q = loadQueue() as object[];
      q.push({ clientId, requestId: selected.id, action, payload, createdAt: new Date().toISOString() });
      saveQueue(q);
      setError('Offline — change queued. It will sync when you’re back online.');
      return;
    }

    const res = await fetch('/api/makeready-crew/action', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) {
      setError(`Could not update job (${data.error || res.status}).`);
      return;
    }
    await refreshJobs();
    if (data.job) setSelected(data.job);
  }

  const ui = {
    page: {
      minHeight: '100vh',
      fontFamily: 'system-ui, sans-serif',
      background: '#0f172a',
      color: '#f8fafc',
      padding: '12px',
      fontSize: 18,
    } as React.CSSProperties,
    btn: {
      minHeight: 52,
      minWidth: 120,
      fontSize: 18,
      padding: '12px 16px',
      borderRadius: 12,
      border: 'none',
      background: '#0d9488',
      color: '#fff',
      fontWeight: 600,
      marginRight: 8,
      marginTop: 8,
    } as React.CSSProperties,
    card: {
      background: '#1e293b',
      borderRadius: 14,
      padding: 14,
      marginBottom: 10,
      border: '1px solid #334155',
    } as React.CSSProperties,
    pill: (on: boolean) =>
      ({
        display: 'inline-block',
        padding: '6px 12px',
        borderRadius: 999,
        background: on ? '#14532d' : '#7f1d1d',
        fontSize: 14,
        marginBottom: 8,
      }) as React.CSSProperties,
  };

  if (authed === false) {
    return (
      <>
        <Head>
          <title>MakeReady Crew — Sign in</title>
          <link rel="manifest" href="/api/makeready-crew/manifest" />
          <meta name="theme-color" content="#0f766e" />
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        </Head>
        <main style={ui.page}>
          <h1 style={{ fontSize: 28 }}>MakeReady Crew</h1>
          <p>Owner sign-in required.</p>
          <form onSubmit={login}>
            <label htmlFor="pin" style={{ display: 'block', marginBottom: 8 }}>
              PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              style={{ fontSize: 22, padding: 12, width: '100%', maxWidth: 280, borderRadius: 10 }}
            />
            <button type="submit" style={{ ...ui.btn, width: '100%', maxWidth: 280 }}>
              Sign in
            </button>
          </form>
          {error ? <p role="alert" style={{ color: '#fca5a5' }}>{error}</p> : null}
        </main>
      </>
    );
  }

  return (
    <>
      <Head>
        <title>MakeReady Crew</title>
        <link rel="manifest" href="/api/makeready-crew/manifest" />
        <meta name="theme-color" content="#0f766e" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <main style={ui.page}>
        <header style={{ marginBottom: 12 }}>
          <h1 style={{ fontSize: 26, margin: 0 }}>Crew board</h1>
          <span style={ui.pill(online)} role="status">
            {online ? 'Online' : 'Offline — changes queue locally'}
          </span>
          {syncing ? <span style={{ marginLeft: 8 }}>Syncing…</span> : null}
        </header>

        {!selected ? (
          <section>
            {(['new', 'scheduled', 'in_progress', 'done'] as const).map((status) => (
              <JobBucket key={status} title={status.replace('_', ' ')} jobs={grouped[status]} ui={ui} onOpen={setSelected} />
            ))}
          </section>
        ) : (
          <section>
            <button type="button" style={ui.btn} onClick={() => setSelected(null)}>
              ← Back
            </button>
            <article style={ui.card}>
              <h2 style={{ marginTop: 0 }}>{selected.builder_company}</h2>
              <p>
                Lot {selected.lot_number} · {selected.address}
                {selected.community ? ` (${selected.community})` : ''}
              </p>
              <p>
                {selected.sq_ft} sq ft · {selected.stories} story · Est. {fmtMoney(selected.estimate_cents)}
              </p>
              <p>Phases: {(selected.phases || []).join(', ') || '—'}</p>
              <p>
                Target {selected.target_date || '—'} · Closing {selected.closing_date || '—'}
              </p>
              <p>Status: <strong>{selected.crew_status}</strong></p>
              {selected.notes ? <p>Builder notes: {selected.notes}</p> : null}
              {selected.crew_notes ? <pre style={{ whiteSpace: 'pre-wrap' }}>{selected.crew_notes}</pre> : null}
              <p>
                <a href={`tel:${selected.phone}`} style={{ color: '#5eead4', fontSize: 20 }}>
                  Call {selected.contact_name}
                </a>
                {' · '}
                <a href={mapsUrl(selected.address)} target="_blank" rel="noreferrer" style={{ color: '#5eead4' }}>
                  Maps
                </a>
              </p>
              <label htmlFor="scheduleAt">Schedule</label>
              <input
                id="scheduleAt"
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                style={{ display: 'block', width: '100%', marginBottom: 8, fontSize: 18, padding: 8 }}
              />
              <label htmlFor="crewLabel">Crew</label>
              <input
                id="crewLabel"
                value={crewLabel}
                onChange={(e) => setCrewLabel(e.target.value)}
                style={{ display: 'block', width: '100%', marginBottom: 8, fontSize: 18, padding: 8 }}
              />
              <button
                type="button"
                style={ui.btn}
                onClick={() =>
                  runAction('schedule', {
                    scheduled_at: scheduleAt ? new Date(scheduleAt).toISOString() : undefined,
                    crew_label: crewLabel,
                  })
                }
              >
                Accept / Schedule
              </button>
              <button type="button" style={ui.btn} onClick={() => runAction('start')}>
                Start job
              </button>
              <button type="button" style={ui.btn} onClick={() => runAction('complete', {})}>
                Mark complete
              </button>
              <label htmlFor="note">Note</label>
              <textarea
                id="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                style={{ width: '100%', fontSize: 18, marginBottom: 8 }}
              />
              <button type="button" style={ui.btn} onClick={() => runAction('note', { note })}>
                Add note
              </button>
            </article>
            {error ? <p role="alert" style={{ color: '#fca5a5' }}>{error}</p> : null}
          </section>
        )}
      </main>
    </>
  );
}

function JobBucket({
  title,
  jobs,
  ui,
  onOpen,
}: {
  title: string;
  jobs: Job[];
  ui: { card: React.CSSProperties; btn: React.CSSProperties };
  onOpen: (j: Job) => void;
}) {
  if (!jobs?.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ textTransform: 'capitalize', fontSize: 20 }}>{title}</h2>
      {jobs.map((j) => (
        <button
          key={j.id}
          type="button"
          onClick={() => onOpen(j)}
          style={{ ...ui.card, width: '100%', textAlign: 'left', cursor: 'pointer' }}
        >
          <strong>{j.builder_company}</strong>
          <span style={{ display: 'block', opacity: 0.9, fontSize: 16 }}>
            Lot {j.lot_number} — {j.address}
          </span>
        </button>
      ))}
    </div>
  );
}