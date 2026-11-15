import { useCallback, useEffect, useState } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { heidiRequest, type ApiError } from '../../lib/heidi-mobile/client/api';
import { relativeTime } from '../../lib/heidi-mobile/client/format';
import type { RevenueConnector, RevenueOpportunity, RevenueOpsSnapshot } from './types';
import type { Loadable } from './hooks';
import { Freshness, SectionError } from './ui';

interface Props {
  online: boolean;
  now: number;
  onAuthError: (_error: ApiError) => void;
}

function useRevenueOps(online: boolean, onAuthError: (_e: ApiError) => void): Loadable<RevenueOpsSnapshot> {
  const [data, setData] = useState<RevenueOpsSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    const result = await heidiRequest<RevenueOpsSnapshot>('/revenue-ops', { timeoutMs: 12000 });
    setLoading(false);
    if (result.ok && result.data.ok) {
      setData(result.data);
      setSavedAt(Date.now());
      setError(null);
    } else {
      setError(result.ok ? { kind: 'server', message: 'revenue ops unavailable' } : result.error);
      if (!result.ok && ['not_paired', 'unauthorized'].includes(result.error.kind)) onAuthError(result.error);
    }
  }, [online, onAuthError]);

  useEffect(() => { void refresh(); }, [refresh]);
  return { data, loading, error, savedAt, fromCache: false, refresh };
}

function ConnectorRow({ c }: { c: RevenueConnector }) {
  const tone = c.access === 'active' && c.lastOk ? 'ok' : c.access === 'blocked' ? 'muted' : 'warn';
  return (
    <div className={styles.cardRow} style={{ justifyContent: 'space-between', fontSize: 13 }}>
      <span>{c.name}</span>
      <span className={styles.muted}>
        {c.access === 'blocked' ? 'blocked' : c.lastOk === false ? 'last scan failed' : c.lastOk ? `${c.lastCount ?? 0} listings` : c.access}
      </span>
      {tone === 'warn' && c.lastError && <span className={styles.muted}>{c.lastError.slice(0, 60)}</span>}
    </div>
  );
}

export default function RevenueOpsView({ online, now, onAuthError }: Props) {
  const ops = useRevenueOps(online, onAuthError);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const snap = ops.data;

  const act = async (action: string, id: string, extra: Record<string, unknown> = {}) => {
    setBusy(id);
    setNote(null);
    const result = await heidiRequest<{ ok: boolean; result?: unknown; error?: string }>('/revenue-ops', {
      method: 'POST',
      body: { action, id, ...extra },
      timeoutMs: 15000,
    });
    setBusy(null);
    if (result.ok && result.data.ok) {
      setNote(`${action} recorded.`);
      void ops.refresh();
    } else {
      setNote(result.ok ? `Failed: ${result.data.error || 'server'}` : result.error.message);
      if (!result.ok && ['not_paired', 'unauthorized'].includes(result.error.kind)) onAuthError(result.error);
    }
  };

  const awaiting = snap?.buckets?.awaitingApproval || [];
  const top = snap?.buckets?.top || [];

  return (
    <div className={styles.scroll}>
      <div className={styles.cardRow} style={{ marginBottom: 12 }}>
        <Freshness savedAt={ops.savedAt} fromCache={ops.fromCache} now={now} loading={ops.loading} />
        <button type="button" className={styles.btn} onClick={() => void ops.refresh()} disabled={ops.loading || !online}>Refresh</button>
      </div>
      {ops.error && <SectionError error={ops.error} />}
      {note && <div className={styles.card}><span className={styles.muted}>{note}</span></div>}

      <section className={styles.section} aria-labelledby="rev-connectors">
        <h2 id="rev-connectors" className={styles.sectionTitle}>Marketplace connectors</h2>
        <div className={styles.card}>
          {(snap?.connectors || []).map((c) => <ConnectorRow key={c.id} c={c} />)}
          {snap?.scout?.ranAt && (
            <span className={styles.muted}>Last scan {relativeTime(snap.scout.ranAt, now)}</span>
          )}
        </div>
      </section>

      {awaiting.length > 0 && (
        <section className={styles.section} aria-labelledby="rev-approve">
          <h2 id="rev-approve" className={styles.sectionTitle}>Awaiting approval ({awaiting.length})</h2>
          {awaiting.map((o) => (
            <OpportunityCard key={o.id} o={o} busy={busy === o.id} onApprove={() => void act('approve_proposal', o.id, { proposalVersion: o.proposal?.version })} onReject={() => void act('reject', o.id, { reason: 'operator_rejected' })} />
          ))}
        </section>
      )}

      <section className={styles.section} aria-labelledby="rev-top">
        <h2 id="rev-top" className={styles.sectionTitle}>Highest-scoring opportunities</h2>
        {!snap && !ops.loading && <div className={styles.card}><span className={styles.muted}>No data yet — job scout sync runs after each scan.</span></div>}
        {top.map((o) => (
          <OpportunityCard
            key={o.id}
            o={o}
            busy={busy === o.id}
            onQueue={() => void act('queue_approval', o.id)}
            onSubmit={() => void act('submit_proposal', o.id, { simulate: true })}
          />
        ))}
      </section>
    </div>
  );
}

function OpportunityCard({
  o,
  busy,
  onApprove,
  onReject,
  onQueue,
  onSubmit,
}: {
  o: RevenueOpportunity;
  busy: boolean;
  onApprove?: () => void;
  onReject?: () => void;
  onQueue?: () => void;
  onSubmit?: () => void;
}) {
  const econ = o.assessment?.economics;
  return (
    <article className={styles.card}>
      <div className={styles.cardRow} style={{ justifyContent: 'space-between' }}>
        <strong>{o.title}</strong>
        <span className={styles.muted}>{o.state}</span>
      </div>
      <div className={styles.muted}>{o.marketplace} · score {o.assessment?.opportunityScore ?? '—'}</div>
      {econ && (
        <div className={styles.muted}>
          Est. net ${econ.netRevenueUsd != null ? Math.round(econ.netRevenueUsd) : '—'} · risk {econ.riskScore}
        </div>
      )}
      {o.proposal && (
        <p className={styles.muted} style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'hidden' }}>{o.proposal.body.slice(0, 400)}…</p>
      )}
      {o.sourceUrl && (
        <a className={styles.link} href={o.sourceUrl} target="_blank" rel="noopener noreferrer">Open listing</a>
      )}
      <div className={styles.cardRow} style={{ gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {onQueue && o.state === 'PROPOSAL_READY' && (
          <button type="button" className={styles.btn} disabled={busy} onClick={onQueue}>Queue approval</button>
        )}
        {onApprove && <button type="button" className={styles.btn} disabled={busy} onClick={onApprove}>Approve proposal</button>}
        {onReject && <button type="button" className={styles.btn} disabled={busy} onClick={onReject}>Reject</button>}
        {onSubmit && o.state === 'AWAITING_APPROVAL' && (
          <button type="button" className={styles.btn} disabled={busy} onClick={onSubmit}>Test submit (simulated)</button>
        )}
      </div>
    </article>
  );
}