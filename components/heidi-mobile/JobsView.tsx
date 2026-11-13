import { useCallback, useEffect, useState } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { heidiRequest, type ApiError } from '../../lib/heidi-mobile/client/api';
import { relativeTime } from '../../lib/heidi-mobile/client/format';
import type { JobDecision, JobLead, JobScoutSnapshot } from './types';
import type { Loadable } from './hooks';
import { Freshness, SectionError } from './ui';

interface Props {
  online: boolean;
  now: number;
  onAuthError: (_error: ApiError) => void;
}

function useJobScout(online: boolean, onAuthError: (_e: ApiError) => void): Loadable<JobScoutSnapshot> {
  const [data, setData] = useState<JobScoutSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    const result = await heidiRequest<JobScoutSnapshot>('/job-scout', { timeoutMs: 10000 });
    setLoading(false);
    if (result.ok && result.data.ok) {
      setData(result.data);
      setSavedAt(Date.now());
      setError(null);
    } else {
      setError(result.ok ? { kind: 'server', message: 'job scout returned an error' } : result.error);
      if (!result.ok && ['not_paired', 'unauthorized'].includes(result.error.kind)) onAuthError(result.error);
    }
  }, [online, onAuthError]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { data, loading, error, savedAt, fromCache: false, refresh };
}

const DECISION_LABEL: Record<JobDecision, string> = { shortlisted: 'Shortlist', dismissed: 'Dismiss', applied: 'Mark applied' };

function budgetLabel(l: JobLead): string | null {
  const b = l.budget;
  if (!b) return null;
  if (b.text) return b.text;
  if (b.min == null && b.max == null) return null;
  const cur = b.currency && b.currency !== 'USD' ? `${b.currency} ` : '$';
  if (b.min != null && b.max != null && b.max) return `${cur}${b.min}–${cur}${b.max}${b.type === 'hourly' ? '/hr' : ''}`;
  return `${cur}${b.min ?? b.max}${b.type === 'hourly' ? '/hr' : ''}`;
}

/**
 * Job scout leads from Heidi's read-only scan. "Open post" links to the
 * original listing; decisions (shortlist / dismiss / applied) are recorded
 * locally. There is intentionally NO apply button — Jordan applies on the
 * site himself.
 */
export default function JobsView({ online, now, onAuthError }: Props) {
  const scout = useJobScout(online, onAuthError);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const snap = scout.data;

  const decide = async (lead: JobLead, status: JobDecision | 'clear') => {
    setBusyId(lead.id);
    setNote(null);
    const result = await heidiRequest<{ ok: boolean; decision: unknown }>('/job-scout', {
      method: 'POST',
      body: { id: lead.id, status },
      timeoutMs: 10000,
    });
    setBusyId(null);
    if (result.ok && result.data.ok) {
      setNote(status === 'clear' ? 'Decision cleared.' : `${DECISION_LABEL[status as JobDecision]} recorded.`);
      void scout.refresh();
    } else {
      setNote(`Not saved: ${result.ok ? 'server error' : result.error.message}`);
      if (!result.ok && ['not_paired', 'unauthorized'].includes(result.error.kind)) onAuthError(result.error);
    }
  };

  const status = snap?.status || null;
  const stale = status?.ranAt ? now - Date.parse(status.ranAt) > 2 * 3 * 3600 * 1000 : false;

  return (
    <div className={styles.scroll}>
      <div className={styles.cardRow} style={{ marginBottom: 12 }}>
        <Freshness savedAt={scout.savedAt} fromCache={scout.fromCache} now={now} loading={scout.loading} />
        <button type="button" className={styles.btn} onClick={() => void scout.refresh()} disabled={scout.loading || !online}>Refresh</button>
      </div>
      {scout.error && <SectionError error={{ ...scout.error, message: `Couldn’t load leads: ${scout.error.message}${snap ? ' — showing the last saved copy.' : ''}` }} />}
      {note && <div className={styles.card}><span className={styles.muted}>{note}</span></div>}

      {status && (
        <section className={styles.section} aria-labelledby="js-status">
          <h2 id="js-status" className={styles.sectionTitle}>Last scan</h2>
          <div className={styles.card}>
            <span className={styles.muted}>
              {status.ranAt ? relativeTime(status.ranAt, now) : 'never'}
              {status.fetched != null ? ` · ${status.fetched} fetched · ${status.kept ?? 0} kept` : ''}
              {status.newStrong ? ` · ${status.newStrong} new strong` : ''}
            </span>
            {stale && <div className={styles.bannerBad} role="alert">Scan is stale — check hydi-schedulers on Frank.</div>}
            {status.notify?.deferred && <div className={styles.muted}>Lead alerts deferred (quiet hours) — they send on the next scan.</div>}
          </div>
        </section>
      )}

      <section className={styles.section} aria-labelledby="js-leads">
        <h2 id="js-leads" className={styles.sectionTitle}>Leads</h2>
        {!snap && !scout.loading && <div className={styles.card}><span className={styles.muted}>No scan yet — the scout runs every 3 hours, or run <code>node scripts/job-scout.js --once</code> on Frank.</span></div>}
        {snap && snap.leads.length === 0 && <div className={styles.card}><span className={styles.muted}>No open leads — everything was dismissed or applied.</span></div>}
        {(snap?.leads || []).map((l) => {
          const budget = budgetLabel(l);
          const decided = l.decision?.status || null;
          return (
            <article key={l.id} className={styles.card}>
              <div className={styles.cardRow} style={{ justifyContent: 'space-between' }}>
                <strong>{l.title}</strong>
                <span className={styles.muted}>score {l.score}{l.division ? ` · ${l.division}` : ''}</span>
              </div>
              <div className={styles.muted} style={{ marginTop: 4 }}>
                {l.company ? `${l.company} · ` : ''}{l.source}
                {budget ? ` · ${budget}` : ''}
                {l.postedAt ? ` · posted ${relativeTime(l.postedAt, now)}` : ''}
              </div>
              {decided && <div className={styles.muted} style={{ marginTop: 4 }}>Marked {decided} {l.decision?.at ? relativeTime(l.decision.at, now) : ''}</div>}
              {l.draft && <details style={{ marginTop: 6 }}><summary className={styles.muted}>Draft proposal (edit before use)</summary><pre className={styles.muted} style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{l.draft}</pre></details>}
              <div className={styles.cardRow} style={{ marginTop: 8, flexWrap: 'wrap' }}>
                <a className={styles.btn} href={l.sourceUrl} target="_blank" rel="noopener noreferrer">Open post</a>
                {(['shortlisted', 'dismissed', 'applied'] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={styles.btn}
                    disabled={busyId === l.id || decided === d}
                    onClick={() => void decide(l, d)}
                  >
                    {DECISION_LABEL[d]}{decided === d ? ' ✓' : ''}
                  </button>
                ))}
                {decided && decided !== 'dismissed' && (
                  <button type="button" className={styles.btn} disabled={busyId === l.id} onClick={() => void decide(l, 'clear')}>Clear</button>
                )}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
