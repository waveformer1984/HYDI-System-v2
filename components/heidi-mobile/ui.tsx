import { useEffect, useRef, type ReactNode } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { relativeTime, isStale } from '../../lib/heidi-mobile/client/format';
import type { ConnectionState } from './types';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted';

export function Dot({ tone }: { tone: Tone }) {
  const cls = tone === 'ok' ? styles.dotOk : tone === 'warn' ? styles.dotWarn : tone === 'bad' ? styles.dotBad : tone === 'info' ? styles.dotInfo : '';
  return <span className={`${styles.dot} ${cls}`} aria-hidden="true" />;
}

export function toneForStatus(status: string | null | undefined): Tone {
  switch (status) {
    case 'healthy': case 'completed': case 'idle': case 'busy': case 'OK': return 'ok';
    case 'degraded': case 'pending': case 'processing': case 'in_progress': case 'WARNING': return 'warn';
    case 'critical': case 'offline': case 'failed': case 'error': case 'rejected': case 'CRITICAL': return 'bad';
    default: return 'muted';
  }
}

/** Wording for each connection state: short label, tone, and the next useful action. */
export function describeState(state: ConnectionState | 'phone_offline' | 'checking'): { label: string; tone: Tone; detail: string } {
  switch (state) {
    case 'online':
      return { label: 'HYDI online', tone: 'ok', detail: 'HYDI answered, accepted this phone, and reports every tracked subsystem healthy.' };
    case 'degraded':
      return { label: 'HYDI degraded', tone: 'warn', detail: 'HYDI is reachable but some subsystems are unhealthy, silent, or not reporting. See the details below.' };
    case 'offline':
      return {
        label: 'HYDI unavailable',
        tone: 'bad',
        detail: 'Heidi’s server could not reach HYDI. Check that the HYDI PC is powered on and “npm run boot” (or PM2) is running, and that the network/Tailscale link between them is up. Then tap Refresh.',
      };
    case 'unauthorized':
      return { label: 'Re-pair needed', tone: 'bad', detail: 'HYDI no longer accepts this phone’s device credentials (revoked, re-registered, or the clock is off by more than 5 minutes). Unpair in Control and pair again.' };
    case 'pending_approval':
      return { label: 'Awaiting approval', tone: 'info', detail: 'This phone is registered but an owner has not approved it yet. Approve it from an owner device or with POST /api/devices {"action":"approve"}.' };
    case 'forbidden':
      return { label: 'Not permitted', tone: 'warn', detail: 'This device’s role cannot read HYDI status. An owner can change its role.' };
    case 'unconfigured':
      return { label: 'Server not configured', tone: 'bad', detail: 'The Heidi server’s HYDI_API_URL is invalid. Fix it on the server and restart.' };
    case 'phone_offline':
      return { label: 'Phone offline', tone: 'bad', detail: 'Your phone has no network connection. Anything shown is the last copy saved on this phone.' };
    default:
      return { label: 'Checking…', tone: 'muted', detail: 'Contacting HYDI…' };
  }
}

/** "Last updated 4 min ago" with a visible STALE tag once data is old or came from cache. */
export function Freshness({ savedAt, fromCache, now, loading }: { savedAt: number | null; fromCache: boolean; now: number; loading?: boolean }) {
  if (!savedAt) return <span className={styles.muted}>{loading ? 'Loading…' : 'No data yet'}</span>;
  const stale = fromCache || isStale(savedAt, now);
  return (
    <span className={`${styles.muted} ${styles.small}`}>
      {stale && <span className={styles.staleTag}>{fromCache ? 'SAVED COPY' : 'STALE'}</span>}{' '}
      Last updated {relativeTime(savedAt, now)}
      {loading ? ' · refreshing…' : ''}
    </span>
  );
}

export function ConfirmSheet(props: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const { onCancel } = props;
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return (
    <div className={styles.sheetBackdrop} onClick={props.onCancel}>
      <div
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="heidi-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="heidi-sheet-title" className={styles.sheetTitle}>{props.title}</h2>
        <div className={styles.muted}>{props.body}</div>
        <div className={styles.btnRow}>
          <button ref={cancelRef} type="button" className={styles.btn} onClick={props.onCancel} disabled={props.busy}>Cancel</button>
          <button
            type="button"
            className={props.danger ? styles.btnDanger : styles.btnPrimary}
            onClick={props.onConfirm}
            disabled={props.busy}
          >
            {props.busy ? 'Working…' : props.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SectionError({ error }: { error: { kind: string; message: string; reason?: string } }) {
  return (
    <div className={styles.card} role="alert">
      <div className={styles.errorText}>
        {error.message}
        {error.reason ? ` (${error.reason})` : ''}
      </div>
    </div>
  );
}
