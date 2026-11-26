import { useState } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import type { Loadable } from './hooks';
import type { StatusSnapshot } from './types';
import { Dot, describeState } from './ui';

interface Props {
  online: boolean;
  status: Loadable<StatusSnapshot>;
}

function str(v: unknown): string {
  if (v === null || v === undefined || v === '') return 'unknown';
  return String(v);
}

export default function ChatStatusStrip({ online, status }: Props) {
  const [open, setOpen] = useState(false);
  const snap = status.data;
  const stateKey = !online
    ? 'phone_offline'
    : snap
      ? snap.state
      : status.error
        ? 'offline'
        : 'checking';
  const meta = describeState(stateKey);

  return (
    <div className={styles.card} style={{ marginBottom: 10 }}>
      <button
        type="button"
        className={styles.cardRow}
        style={{ width: '100%', background: 'transparent', border: 'none', color: 'inherit', padding: 0, textAlign: 'left' }}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>
          <Dot tone={meta.tone} />
          <strong style={{ marginLeft: 6 }}>{meta.label}</strong>
        </span>
        <span className={styles.muted} style={{ fontSize: 13 }}>
          {status.loading ? 'Checking…' : open ? 'Hide' : 'Details'}
        </span>
      </button>
      {open && (
        <dl className={styles.metrics} style={{ marginTop: 10, marginBottom: 0 }}>
          <div className={styles.metric}>
            <dt className={styles.muted}>Connection</dt>
            <dd className={styles.metricValue}>{str(snap?.state)}</dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.muted}>Health</dt>
            <dd className={styles.metricValue}>{str(snap?.health?.status)}</dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.muted}>HYDI status</dt>
            <dd className={styles.metricValue}>{str(snap?.health?.hydi_status)}</dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.muted}>API latency</dt>
            <dd className={styles.metricValue}>
              {snap?.api?.latency_ms != null ? `${snap.api.latency_ms} ms` : 'unknown'}
            </dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.muted}>Reachable</dt>
            <dd className={styles.metricValue}>{snap?.api?.reachable == null ? 'unknown' : snap.api.reachable ? 'yes' : 'no'}</dd>
          </div>
          <div className={styles.metric}>
            <dt className={styles.muted}>Checked</dt>
            <dd className={styles.metricValue} style={{ fontSize: 13 }}>{str(snap?.checked_at)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}