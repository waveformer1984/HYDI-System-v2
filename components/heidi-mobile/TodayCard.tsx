import { useCallback, useEffect, useState } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { heidiRequest } from '../../lib/heidi-mobile/client/api';

type BuilderRow = { name: string; permits: number };

type StatePayload = {
  ts?: string;
  heartbeat_age_s?: number;
  leads?: {
    last_digest_at?: string | null;
    lead_count?: number;
    top_builders?: BuilderRow[];
  };
};

type Draft = {
  id: string;
  builder: string;
  permits: number;
  areas: string[];
  body: string;
  contact_hint?: string;
};

type Decision = {
  draft_id: string;
  decision: string;
  ts?: string;
  edited_body?: string | null;
};

interface Props {
  online: boolean;
}

export default function TodayCard({ online }: Props) {
  const [state, setState] = useState<StatePayload | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const refresh = useCallback(async () => {
    if (!online) return;
    setLoading(true);
    setError(null);
    const [st, out] = await Promise.all([
      heidiRequest<StatePayload>('/state'),
      heidiRequest<{ drafts: Draft[]; decisions: Record<string, Decision> }>('/outreach'),
    ]);
    if (st.ok) setState(st.data);
    else setError(st.error.message);
    if (out.ok) {
      setDrafts(out.data.drafts || []);
      setDecisions(out.data.decisions || {});
    }
    setLoading(false);
  }, [online]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 120_000);
    return () => clearInterval(t);
  }, [refresh]);

  const recordDecision = async (draft: Draft, decision: 'approve' | 'reject' | 'edit', editedBody?: string) => {
    const body: Record<string, unknown> = {
      draft_id: draft.id,
      builder: draft.builder,
      decision,
    };
    if (decision === 'edit' && editedBody) body.edited_body = editedBody;
    const r = await heidiRequest('/outreach', { method: 'POST', body });
    if (r.ok) void refresh();
    else setError(r.error.message);
    setEditId(null);
  };

  const sweepLabel = state?.leads?.last_digest_at
    ? new Date(state.leads.last_digest_at).toLocaleString()
    : 'No sweep yet';
  const builders = state?.leads?.top_builders?.slice(0, 5) || [];

  return (
    <section className={styles.section} aria-labelledby="today-card">
      <div className={styles.card}>
        <div className={styles.cardRow}>
          <h2 id="today-card" className={styles.stateTitle} style={{ margin: 0 }}>Today</h2>
          <button type="button" className={styles.btn} onClick={() => void refresh()} disabled={loading || !online}>
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <div className={styles.muted}>Last sweep</div>
            <div className={styles.metricValue} style={{ fontSize: 14 }}>{sweepLabel}</div>
          </div>
          <div className={styles.metric}>
            <div className={styles.muted}>Leads scored</div>
            <div className={styles.metricValue}>{state?.leads?.lead_count ?? '—'}</div>
          </div>
        </div>
        {builders.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className={styles.muted} style={{ marginBottom: 4 }}>Top builders</div>
            <ul className={styles.list}>
              {builders.map((b) => (
                <li key={b.name}>{b.name} · {b.permits} permit{b.permits === 1 ? '' : 's'}</li>
              ))}
            </ul>
          </div>
        )}
        {error && <p className={styles.errorText} role="alert">{error}</p>}
        {drafts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className={styles.muted} style={{ marginBottom: 6 }}>Outreach drafts (not sent)</div>
            {drafts.map((d) => {
              const last = decisions[d.id];
              return (
                <article key={d.id} className={styles.card} style={{ marginBottom: 8, padding: 10 }}>
                  <strong>{d.builder}</strong>
                  <div className={styles.muted}>{d.permits} permit(s) · {d.areas.join(', ')}</div>
                  <p style={{ fontSize: 14, margin: '8px 0' }}>{d.body}</p>
                  {last && (
                    <p className={styles.muted} style={{ fontSize: 12 }}>
                      Last: {last.decision}
                      {last.ts ? ` · ${new Date(last.ts).toLocaleString()}` : ''}
                    </p>
                  )}
                  {editId === d.id ? (
                    <div>
                      <textarea
                        className={styles.textarea}
                        rows={4}
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        aria-label="Edited draft body"
                      />
                      <div className={styles.cardRow}>
                        <button type="button" className={styles.btnPrimary} onClick={() => void recordDecision(d, 'edit', editText)}>Save edit</button>
                        <button type="button" className={styles.btn} onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div className={styles.cardRow}>
                      <button type="button" className={styles.btnPrimary} onClick={() => void recordDecision(d, 'approve')}>Approve</button>
                      <button type="button" className={styles.btn} onClick={() => void recordDecision(d, 'reject')}>Reject</button>
                      <button type="button" className={styles.btn} onClick={() => { setEditId(d.id); setEditText(d.body); }}>Edit</button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}