import { useCallback, useEffect, useState } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { heidiRequest, type ApiError } from '../../lib/heidi-mobile/client/api';

export interface JobDigestLead {
  id: string;
  title: string;
  score: number;
  pay: string | null;
  whyFit: string;
  proposal: string;
  sourceUrl: string;
  decision?: { status: string; at: string } | null;
}

interface DigestResponse {
  ok: boolean;
  digest?: JobDigestLead[];
}

interface Props {
  online: boolean;
  onAuthError: (_error: ApiError) => void;
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  return false;
}

/**
 * Top job picks for chat — one-tap prepare only (Jordan submits on the site).
 */
export default function JobApplyDigestCard({ online, onAuthError }: Props) {
  const [leads, setLeads] = useState<JobDigestLead[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    if (!online) return;
    const res = await heidiRequest<DigestResponse>('/job-scout?digest=1', { timeoutMs: 12000 });
    if (res.ok && res.data.ok && res.data.digest) {
      setLeads(res.data.digest);
    } else if (!res.ok && ['not_paired', 'unauthorized'].includes(res.error.kind)) {
      onAuthError(res.error);
    }
  }, [online, onAuthError]);

  useEffect(() => { void refresh(); }, [refresh]);

  const prepare = async (id: string) => {
    setBusy(id);
    setNote(null);
    const res = await heidiRequest<{ ok: boolean; proposal: string; sourceUrl: string }>('/job-scout', {
      method: 'POST',
      body: { id, action: 'prepare_apply' },
      timeoutMs: 12000,
    });
    setBusy(null);
    if (!res.ok || !res.data.ok) {
      setNote(res.ok ? 'Could not prepare apply.' : res.error.message);
      return;
    }
    const copied = await copyToClipboard(res.data.proposal);
    window.open(res.data.sourceUrl, '_blank', 'noopener,noreferrer');
    setNote(
      copied
        ? 'Proposal copied — paste on the job page and tap Submit yourself. Then tap “I sent it”.'
        : 'Job page opened — copy proposal from Edit, paste, Submit yourself, then “I sent it”.',
    );
    void refresh();
  };

  const confirmSent = async (id: string) => {
    setBusy(id);
    const res = await heidiRequest<{ ok: boolean }>('/job-scout', {
      method: 'POST',
      body: { id, action: 'confirm_sent' },
      timeoutMs: 10000,
    });
    setBusy(null);
    if (res.ok && res.data.ok) {
      setNote('Marked applied — Hydi did not submit anything.');
      void refresh();
    } else {
      setNote(res.ok ? 'Confirm failed — prepare apply first.' : res.error.message);
    }
  };

  const skip = async (id: string) => {
    setBusy(id);
    await heidiRequest('/job-scout', { method: 'POST', body: { id, status: 'skipped' }, timeoutMs: 10000 });
    setBusy(null);
    void refresh();
  };

  const saveEdit = async (id: string) => {
    const draft = editing[id];
    if (draft == null) return;
    setBusy(id);
    await heidiRequest('/job-scout', { method: 'POST', body: { id, action: 'save_draft', draft }, timeoutMs: 10000 });
    setBusy(null);
    setEditing((e) => { const n = { ...e }; delete n[id]; return n; });
    void refresh();
  };

  if (!leads.length) return null;

  return (
    <section className={styles.briefCard} aria-label="Job picks" style={{ marginBottom: 12 }}>
      <div className={styles.briefTitle}>Job picks (paste &amp; submit yourself)</div>
      {note && <div className={styles.muted} style={{ marginBottom: 8 }}>{note}</div>}
      {leads.map((l) => {
        const status = l.decision?.status;
        const draftText = editing[l.id] ?? l.proposal;
        return (
          <article key={l.id} className={styles.card} style={{ marginTop: 8 }}>
            <strong>{l.title}</strong>
            <div className={styles.muted}>Score {l.score}{l.pay ? ` · ${l.pay}` : ''}</div>
            <div className={styles.muted} style={{ marginTop: 4 }}>{l.whyFit}</div>
            {status === 'drafted' && (
              <div className={styles.muted}>Drafted — confirm after you Submit on the site.</div>
            )}
            <textarea
              className={styles.textarea}
              style={{ width: '100%', minHeight: 72, marginTop: 6, fontSize: 12 }}
              value={draftText}
              onChange={(e) => setEditing((prev) => ({ ...prev, [l.id]: e.target.value }))}
              aria-label="Proposal draft"
            />
            <div className={styles.cardRow} style={{ marginTop: 8, flexWrap: 'wrap' }}>
              <button type="button" className={styles.btn} disabled={busy === l.id || !online} onClick={() => void prepare(l.id)}>
                ✅ Apply
              </button>
              <button type="button" className={styles.btn} disabled={busy === l.id} onClick={() => void saveEdit(l.id)}>
                ✏️ Save edit
              </button>
              <button type="button" className={styles.btn} disabled={busy === l.id} onClick={() => void skip(l.id)}>
                ❌ Skip
              </button>
              {status === 'drafted' && (
                <button type="button" className={styles.btn} disabled={busy === l.id} onClick={() => void confirmSent(l.id)}>
                  I sent it
                </button>
              )}
            </div>
          </article>
        );
      })}
      <p className={styles.muted} style={{ marginTop: 8, marginBottom: 0 }}>
        Hydi never bids or messages. ~30s: paste proposal and Submit on the job site.
      </p>
    </section>
  );
}