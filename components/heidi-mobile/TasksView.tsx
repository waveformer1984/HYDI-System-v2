import { useState } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { heidiRequest, type ApiError } from '../../lib/heidi-mobile/client/api';
import { relativeTime } from '../../lib/heidi-mobile/client/format';
import type { Loadable } from './hooks';
import type { Approval, TasksSnapshot } from './types';
import { ConfirmSheet, Dot, Freshness, SectionError, toneForStatus } from './ui';

interface Props {
  tasks: Loadable<TasksSnapshot>;
  online: boolean;
  now: number;
  onAuthError: (_error: ApiError) => void;
}

type Decision = 'approve' | 'reject';

interface Outcome {
  id: string;
  ok: boolean;
  text: string;
}

export default function TasksView({ tasks, online, now, onAuthError }: Props) {
  const [pending, setPending] = useState<{ approval: Approval; decision: Decision } | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const snap = tasks.data;

  const decide = async () => {
    if (!pending) return;
    const { approval, decision } = pending;
    setBusy(true);
    const result = await heidiRequest<{ ok: boolean; status: string | null; error: string | null }>('/tasks', {
      method: 'POST',
      body: { id: approval.id, decision },
      timeoutMs: 40000,
    });
    setBusy(false);
    setPending(null);
    if (result.ok) {
      const executedFailed = decision === 'approve' && result.data.status === 'failed';
      setOutcomes((o) => ({
        ...o,
        [approval.id]: {
          id: approval.id,
          ok: !executedFailed,
          text: decision === 'reject' ? 'Rejected — it will not run.'
            : executedFailed ? `Approved, but the action failed: ${result.data.error || 'no detail from HYDI'}`
              : 'Approved and executed.',
        },
      }));
      void tasks.refresh();
    } else {
      // Nothing is removed from the list on failure — the task is still pending.
      setOutcomes((o) => ({ ...o, [approval.id]: { id: approval.id, ok: false, text: `Not ${decision === 'approve' ? 'approved' : 'rejected'}: ${result.error.message}` } }));
      if (['not_paired', 'unauthorized'].includes(result.error.kind)) onAuthError(result.error);
    }
  };

  const approvals = snap?.approvals;
  const work = snap?.work;
  const commands = snap?.commands;

  return (
    <div className={styles.scroll}>
      <div className={styles.cardRow} style={{ marginBottom: 12 }}>
        <Freshness savedAt={tasks.savedAt} fromCache={tasks.fromCache} now={now} loading={tasks.loading} />
        <button type="button" className={styles.btn} onClick={() => void tasks.refresh()} disabled={tasks.loading || !online}>Refresh</button>
      </div>
      {tasks.error && <SectionError error={{ ...tasks.error, message: `Couldn’t load tasks: ${tasks.error.message}${snap ? ' — showing the last saved copy.' : ''}` }} />}

      <section className={styles.section} aria-labelledby="ht-approvals">
        <h2 id="ht-approvals" className={styles.sectionTitle}>Needs your approval</h2>
        {approvals && !approvals.ok && <SectionError error={approvals.error} />}
        {approvals?.ok && approvals.data.length === 0 && (
          <div className={styles.card}><span className={styles.muted}>Nothing is waiting for approval.</span></div>
        )}
        {approvals?.ok && approvals.data.map((a) => {
          const outcome = outcomes[a.id];
          return (
            <article key={a.id} className={styles.card}>
              <div className={styles.cardRow}>
                <div className={styles.itemTitle}>{a.action_type.replace(/_/g, ' ')}</div>
                <span className={`${styles.muted} ${styles.small}`}>{relativeTime(a.created_at, now)}</span>
              </div>
              {a.summary && <p className={styles.muted} style={{ margin: '6px 0 0' }}>{a.summary}</p>}
              <div className={`${styles.muted} ${styles.small}`} style={{ marginTop: 4 }}>
                Escalated by ProtoForge · id <span className={styles.code}>{a.id.slice(0, 8)}</span>
              </div>
              {outcome && (
                <p className={outcome.ok ? styles.muted : styles.errorText} role="status" style={{ marginBottom: 0 }}>{outcome.text}</p>
              )}
              <div className={styles.btnRow}>
                <button type="button" className={styles.btnDanger} onClick={() => setPending({ approval: a, decision: 'reject' })} disabled={!online}>
                  Reject
                </button>
                <button type="button" className={styles.btnPrimary} onClick={() => setPending({ approval: a, decision: 'approve' })} disabled={!online}>
                  Approve
                </button>
              </div>
            </article>
          );
        })}
      </section>

      <section className={styles.section} aria-labelledby="ht-work">
        <h2 id="ht-work" className={styles.sectionTitle}>
          <span>Agent work</span>
          {work?.ok && <span className={styles.small}>{work.data.queue_depth} queued</span>}
        </h2>
        {work && !work.ok && <SectionError error={work.error} />}
        {work?.ok && work.data.sessions.length === 0 && (
          <div className={styles.card}><span className={styles.muted}>No work sessions recorded.</span></div>
        )}
        {work?.ok && work.data.sessions.slice(0, 10).map((s, i) => (
          <article key={s.id || i} className={styles.card}>
            <div className={styles.cardRow}>
              <div className={styles.itemTitle}>{s.goal || 'Untitled goal'}</div>
              <span className={styles.statusLabel}><Dot tone={toneForStatus(s.status)} />{s.status.replace(/_/g, ' ')}</span>
            </div>
            {s.current_task && <div className={styles.muted} style={{ marginTop: 4 }}>Now: {s.current_task}</div>}
            {s.total_steps > 0 && (
              <>
                <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={s.total_steps} aria-valuenow={s.completed_steps} aria-label="Steps completed">
                  <div className={styles.progressFill} style={{ width: `${Math.round((s.completed_steps / s.total_steps) * 100)}%` }} />
                </div>
                <div className={`${styles.muted} ${styles.small}`} style={{ marginTop: 4 }}>
                  {s.completed_steps}/{s.total_steps} steps · started {relativeTime(s.created_at, now)}
                </div>
              </>
            )}
          </article>
        ))}
      </section>

      <section className={styles.section} aria-labelledby="ht-commands">
        <h2 id="ht-commands" className={styles.sectionTitle}>Recent worker commands</h2>
        {commands && !commands.ok && <SectionError error={commands.error} />}
        {commands?.ok && commands.data.length === 0 && (
          <div className={styles.card}><span className={styles.muted}>No commands have been issued.</span></div>
        )}
        {commands?.ok && commands.data.length > 0 && (
          <ul className={`${styles.list} ${styles.listCard}`}>
            {commands.data.slice(0, 10).map((c, i) => (
              <li key={c.id || i} className={styles.listItem}>
                <div className={styles.itemMain}>
                  <div className={styles.itemTitle}>{c.command} {c.worker_type}{c.worker_id ? ` (${c.worker_id})` : ''}</div>
                  <div className={`${styles.muted} ${styles.small}`}>by {c.requested_by || 'unknown'} · {relativeTime(c.created_at, now)}</div>
                  {c.error && <div className={styles.errorText}>{c.error}</div>}
                </div>
                <span className={styles.statusLabel}><Dot tone={toneForStatus(c.status)} />{c.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {pending && (
        <ConfirmSheet
          title={pending.decision === 'approve' ? `Approve ${pending.approval.action_type.replace(/_/g, ' ')}?` : `Reject ${pending.approval.action_type.replace(/_/g, ' ')}?`}
          body={pending.decision === 'approve'
            ? 'HYDI will execute this action immediately. This cannot be undone from Heidi.'
            : 'The action will be marked rejected and will not run.'}
          confirmLabel={pending.decision === 'approve' ? 'Approve & run' : 'Reject'}
          danger={pending.decision === 'reject'}
          busy={busy}
          onConfirm={() => void decide()}
          onCancel={() => { if (!busy) setPending(null); }}
        />
      )}
    </div>
  );
}
