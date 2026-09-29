import { useEffect, useState } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { heidiRequest, type ApiError } from '../../lib/heidi-mobile/client/api';
import { relativeTime } from '../../lib/heidi-mobile/client/format';
import { isSpeechInputSupported, isSpeechOutputSupported } from '../../lib/heidi-mobile/client/voice';
import type { RealtimeState } from '../../lib/heidi-mobile/client/realtime';
import type { Preferences } from '../../lib/heidi-mobile/client/cache';
import type { Loadable } from './hooks';
import type { StatusSnapshot, Worker } from './types';
import { ConfirmSheet, Dot, toneForStatus } from './ui';

type Command = 'start' | 'restart' | 'stop';

interface Props {
  status: Loadable<StatusSnapshot>;
  deviceId: string | null;
  online: boolean;
  realtime: RealtimeState;
  prefs: Preferences;
  now: number;
  onPrefsChange: (_prefs: Preferences) => void;
  onRefreshAll: () => void;
  onReconnect: () => void;
  onUnpair: () => Promise<void>;
  onAuthError: (_error: ApiError) => void;
  onCommandQueued: () => void;
}

const COMMAND_TEXT: Record<Command, { label: string; body: string }> = {
  start: { label: 'Start', body: 'Queues a start command. WorkerOrchestrator runs it on its next poll (about 5 seconds).' },
  restart: { label: 'Restart', body: 'Queues a restart. Work in progress on this worker may be interrupted.' },
  stop: { label: 'Stop', body: 'Queues a stop. The worker will stop taking work until it is started again.' },
};

export default function ControlView(props: Props) {
  const { status, online, now } = props;
  const [pending, setPending] = useState<{ worker: Worker; command: Command } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [micSupported, setMicSupported] = useState(false);

  useEffect(() => {
    setTtsSupported(isSpeechOutputSupported());
    setMicSupported(isSpeechInputSupported());
  }, []);

  const workers = status.data?.system?.workers || [];

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    const result = await heidiRequest<{ queued: boolean; command: { id: string } }>('/control', {
      method: 'POST',
      body: { worker_type: pending.worker.worker_type, worker_id: pending.worker.worker_id, command: pending.command, confirm: true },
    });
    setBusy(false);
    const label = `${COMMAND_TEXT[pending.command].label} ${pending.worker.worker_type}`;
    setPending(null);
    if (result.ok) {
      setMessage({ ok: true, text: `${label}: queued. Track it under Tasks → Recent worker commands.` });
      props.onCommandQueued();
    } else {
      setMessage({ ok: false, text: `${label} was not queued: ${result.error.message}` });
      if (['not_paired', 'unauthorized'].includes(result.error.kind)) props.onAuthError(result.error);
    }
  };

  return (
    <div className={styles.scroll}>
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Connection</h2>
        <div className={styles.card}>
          <div className={styles.cardRow}>
            <span>Live updates</span>
            <span className={styles.statusLabel}>
              <Dot tone={props.realtime === 'live' ? 'ok' : props.realtime === 'stopped' ? 'muted' : 'warn'} />
              {props.realtime}
            </span>
          </div>
          <div className={styles.btnRow}>
            <button type="button" className={styles.btn} onClick={props.onRefreshAll} disabled={!online}>Refresh all</button>
            <button type="button" className={styles.btn} onClick={props.onReconnect} disabled={!online}>Reconnect</button>
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Workers</h2>
        {message && (
          <div className={styles.card} role="status">
            <span className={message.ok ? undefined : styles.errorText}>{message.text}</span>
          </div>
        )}
        {!status.data?.system && (
          <div className={styles.card}>
            <span className={styles.muted}>Worker controls appear once HYDI returns a status snapshot.</span>
          </div>
        )}
        {status.data?.system && workers.length === 0 && (
          <div className={styles.card}>
            <span className={styles.muted}>No workers are reporting to HYDI, so there is nothing to control.</span>
          </div>
        )}
        {workers.map((w) => (
          <article key={`${w.worker_type}:${w.worker_id || ''}`} className={styles.card}>
            <div className={styles.cardRow}>
              <div className={styles.itemMain}>
                <div className={styles.itemTitle}>{w.worker_type}</div>
                <div className={`${styles.muted} ${styles.small}`}>
                  {w.worker_id || 'default instance'} · heartbeat {relativeTime(w.last_heartbeat, now)}
                </div>
              </div>
              <span className={styles.statusLabel}><Dot tone={toneForStatus(w.status)} />{w.status}</span>
            </div>
            <div className={styles.btnRow}>
              {(['start', 'restart', 'stop'] as Command[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c === 'stop' ? styles.btnDanger : styles.btn}
                  onClick={() => { setMessage(null); setPending({ worker: w, command: c }); }}
                  disabled={!online || status.fromCache}
                >
                  {COMMAND_TEXT[c].label}
                </button>
              ))}
            </div>
          </article>
        ))}
        <p className={`${styles.muted} ${styles.small}`}>
          Only controls HYDI already supports are shown. Commands go through HYDI’s authenticated queue and are
          audit-logged; your device’s role must allow worker control. There is no remote shutdown or restart of HYDI itself.
        </p>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Voice</h2>
        <div className={styles.card}>
          {/* The whole row is the tap target, not just the checkbox. */}
          <label htmlFor="heidi-speak" className={styles.cardRow} style={{ minHeight: 48, cursor: ttsSupported ? 'pointer' : 'default' }}>
            <span style={{ flex: 1 }}>
              Read replies aloud
              <span className={`${styles.muted} ${styles.small}`} style={{ display: 'block' }}>
                {ttsSupported ? 'Uses this phone’s text-to-speech.' : 'Not supported by this browser.'}
              </span>
            </span>
            <input
              id="heidi-speak"
              type="checkbox"
              style={{ width: 26, height: 26, accentColor: '#7c3aed' }}
              checked={props.prefs.speakReplies}
              disabled={!ttsSupported}
              onChange={(e) => props.onPrefsChange({ ...props.prefs, speakReplies: e.target.checked })}
            />
          </label>
          <div className={`${styles.muted} ${styles.small}`} style={{ marginTop: 8 }}>
            Voice input: {micSupported ? 'available — tap 🎙 in Chat. Speech fills the message box; nothing is sent until you tap Send.' : 'not supported by this browser. Text chat works normally.'}
          </div>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>This phone</h2>
        <div className={styles.card}>
          <div className={styles.muted}>Paired as device</div>
          <div className={styles.code} style={{ display: 'inline-block', marginTop: 4 }}>{props.deviceId || 'unknown'}</div>
          <div className={styles.btnRow}>
            <button type="button" className={styles.btnDanger} onClick={() => setConfirmUnpair(true)}>Unpair this phone</button>
          </div>
        </div>
      </section>

      {pending && (
        <ConfirmSheet
          title={`${COMMAND_TEXT[pending.command].label} ${pending.worker.worker_type}?`}
          body={COMMAND_TEXT[pending.command].body}
          confirmLabel={COMMAND_TEXT[pending.command].label}
          danger={pending.command !== 'start'}
          busy={busy}
          onConfirm={() => void run()}
          onCancel={() => { if (!busy) setPending(null); }}
        />
      )}
      {confirmUnpair && (
        <ConfirmSheet
          title="Unpair this phone?"
          body="Heidi forgets this phone’s session and clears everything it saved here. The device stays registered in HYDI until an owner revokes it."
          confirmLabel="Unpair"
          danger
          onConfirm={() => { setConfirmUnpair(false); void props.onUnpair(); }}
          onCancel={() => setConfirmUnpair(false)}
        />
      )}
    </div>
  );
}
