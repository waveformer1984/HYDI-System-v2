import { useCallback, useEffect, useRef, useState } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { heidiRequest, type ApiError } from '../../lib/heidi-mobile/client/api';
import { isTerminal, mergeJobLines, nextPollDelay, type JobLine } from '../../lib/heidi-mobile/client/jobs';
import { ConfirmSheet, Dot } from './ui';

interface CatalogEntry {
  kind: string;
  summary: string;
  confirm_required: boolean;
  timeout_ms: number;
}

interface JobSummary {
  id: string;
  kind: string;
  state: string;
  duration_ms: number;
  exit_code: number | null;
  error: string | null;
  steps: { label: string; state: string }[];
  artifacts: string[];
  truncated: boolean;
}

const SUITES = ['heidi-mobile', 'mobile-ops'];

const toneFor = (state: string) =>
  state === 'succeeded' ? 'ok' : state === 'running' ? 'warn' : state === 'cancelled' ? 'muted' : 'bad';

/**
 * Long-running allowlisted jobs on the HYDI host (builds, test suites):
 * start with confirmation, follow live output, cancel. The log is paged by a
 * sequence cursor, so a dropped connection resumes where it stopped.
 */
export default function JobsPanel({ online, onAuthError }: { online: boolean; onAuthError: (_error: ApiError) => void }) {
  const [catalog, setCatalog] = useState<CatalogEntry[] | null>(null);
  const [recent, setRecent] = useState<JobSummary[]>([]);
  const [active, setActive] = useState<JobSummary | null>(null);
  const [lines, setLines] = useState<JobLine[]>([]);
  const [conn, setConn] = useState<'idle' | 'live' | 'reconnecting'>('idle');
  const [pending, setPending] = useState<{ kind: string; suite?: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cursor = useRef(0);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followId = useRef<string | null>(null);

  const handleError = useCallback(
    (e: ApiError) => {
      if (['not_paired', 'unauthorized'].includes(e.kind)) onAuthError(e);
    },
    [onAuthError],
  );

  const loadList = useCallback(async () => {
    const r = await heidiRequest<{ catalog: CatalogEntry[]; jobs: JobSummary[] }>('/jobs');
    if (r.ok) {
      setCatalog(r.data.catalog);
      setRecent(r.data.jobs);
    } else handleError(r.error);
  }, [handleError]);

  const stopFollowing = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const poll = useCallback(async () => {
    const id = followId.current;
    if (!id) return;
    const r = await heidiRequest<{ job: JobSummary; lines: JobLine[]; next_since: number; more: boolean; gap: boolean }>(
      `/jobs?id=${id}&since=${cursor.current}`,
      { timeoutMs: 10000 },
    );
    if (followId.current !== id) return;
    if (r.ok) {
      failures.current = 0;
      setConn('live');
      setActive(r.data.job);
      setLines((prev) => mergeJobLines(prev, r.data.lines));
      cursor.current = Math.max(cursor.current, r.data.next_since);
      if (r.data.gap) setMessage('Some older output was dropped on the host (log limit).');
      if (isTerminal(r.data.job.state) && !r.data.more) {
        setConn('idle');
        void loadList();
        return;
      }
      timer.current = setTimeout(() => void poll(), r.data.more ? 0 : nextPollDelay(0, true));
    } else {
      handleError(r.error);
      // A 4xx (job unknown — host restarted — or not allowed) won't fix itself; stop.
      if (r.error.kind === 'client' || r.error.kind === 'forbidden') {
        setConn('idle');
        setMessage(`Stopped following this job: ${r.error.message}`);
        return;
      }
      failures.current += 1;
      setConn('reconnecting');
      timer.current = setTimeout(() => void poll(), nextPollDelay(failures.current, true));
    }
  }, [handleError, loadList]);

  const follow = useCallback(
    (job: JobSummary) => {
      stopFollowing();
      followId.current = job.id;
      cursor.current = 0;
      failures.current = 0;
      setActive(job);
      setLines([]);
      setMessage(null);
      void poll();
    },
    [poll],
  );

  useEffect(() => {
    void loadList();
    return stopFollowing;
  }, [loadList]);

  // Coming back online resumes the log immediately.
  useEffect(() => {
    if (online && conn === 'reconnecting') {
      stopFollowing();
      void poll();
    }
  }, [online, conn, poll]);

  const start = async (kind: string, suite?: string, confirm = false) => {
    setBusy(true);
    setMessage(null);
    const r = await heidiRequest<{ ok: boolean; job: JobSummary }>('/jobs', {
      method: 'POST',
      body: { kind, args: suite ? { suite } : {}, confirm: confirm || undefined },
    });
    setBusy(false);
    setPending(null);
    if (r.ok && r.data.job) {
      follow(r.data.job);
      void loadList();
    } else if (!r.ok) {
      setMessage(`${kind} did not start: ${r.error.message}`);
      handleError(r.error);
    }
  };

  const cancel = async () => {
    if (!active) return;
    const r = await heidiRequest<{ ok: boolean; job: JobSummary }>('/jobs', { method: 'POST', body: { id: active.id, cancel: true } });
    if (r.ok) {
      setActive(r.data.job);
      stopFollowing();
      void poll();
    } else {
      setMessage(`Cancel failed: ${r.error.message}`);
      handleError(r.error);
    }
  };

  const request = (entry: CatalogEntry, suite?: string) => {
    if (entry.confirm_required) setPending({ kind: entry.kind, suite });
    else void start(entry.kind, suite);
  };

  return (
    <div className={styles.card}>
      <p className={`${styles.muted} ${styles.small}`}>
        Allowlisted builds and test suites run on the HYDI host — fixed commands only, bounded time and output, audit-logged.
      </p>
      {catalog === null && <span className={styles.muted}>Loading jobs…</span>}
      {catalog && catalog.length === 0 && <span className={styles.muted}>This phone&apos;s role cannot start jobs.</span>}
      <div className={styles.btnRow} style={{ flexWrap: 'wrap' }}>
        {(catalog || []).map((entry) =>
          entry.kind === 'tests.suite' ? (
            SUITES.map((s) => (
              <button key={`${entry.kind}:${s}`} type="button" className={styles.btn} disabled={!online || busy} onClick={() => request(entry, s)}>
                Tests: {s}
              </button>
            ))
          ) : (
            <button key={entry.kind} type="button" className={styles.btn} disabled={!online || busy} title={entry.summary} onClick={() => request(entry)}>
              {entry.kind}
            </button>
          ),
        )}
      </div>

      {message && <p className={styles.errorText}>{message}</p>}

      {active && (
        <div style={{ marginTop: 8 }}>
          <div className={styles.cardRow}>
            <span className={styles.statusLabel}>
              <Dot tone={toneFor(active.state)} /> {active.kind} · {active.state} · {Math.round(active.duration_ms / 1000)}s
            </span>
            {active.state === 'running' && (
              <button type="button" className={styles.btn} onClick={() => void cancel()}>
                Cancel
              </button>
            )}
          </div>
          {conn === 'reconnecting' && <p className={`${styles.muted} ${styles.small}`}>Connection lost — reconnecting; the log will resume where it stopped.</p>}
          {active.error && <p className={styles.errorText}>{active.error}</p>}
          {active.artifacts.length > 0 && <p className={styles.small}>Artifact on host: {active.artifacts.join(', ')}</p>}
          <pre className={styles.code} style={{ marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 11, maxHeight: 320, overflow: 'auto' }}>
            {lines.map((l) => `${l.stream === 'stderr' ? '! ' : l.stream === 'system' ? '# ' : ''}${l.text}`).join('\n') || '…'}
          </pre>
        </div>
      )}

      {recent.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <p className={`${styles.muted} ${styles.small}`}>Recent jobs</p>
          {recent.slice(0, 5).map((j) => (
            <button key={j.id} type="button" className={styles.btn} style={{ display: 'block', width: '100%', textAlign: 'left', marginTop: 4 }} onClick={() => follow(j)}>
              <Dot tone={toneFor(j.state)} /> {j.kind} · {j.state}
            </button>
          ))}
        </div>
      )}

      {pending && (
        <ConfirmSheet
          title={`Run ${pending.kind}${pending.suite ? ` (${pending.suite})` : ''}?`}
          body={(catalog || []).find((c) => c.kind === pending.kind)?.summary || 'Runs on the HYDI host.'}
          confirmLabel="Run"
          busy={busy}
          onConfirm={() => void start(pending.kind, pending.suite, true)}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
