import { useState, type FormEvent } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { heidiRequest } from '../../lib/heidi-mobile/client/api';

interface Props {
  sessionAvailable: boolean;
  /** Re-reads the session; resolves false if the browser did not keep the cookie. */
  onPaired: () => Promise<boolean>;
}

const COOKIE_DROPPED = 'HYDI accepted this phone, but the browser did not keep the session cookie. '
  + 'This happens when cookies are blocked for this site. Allow cookies for it and try again.';

/**
 * Pair this phone with HYDI. The device secret typed here is sent once, over
 * this same-origin request, to Heidi's server, which proves it against HYDI
 * and seals it into an HttpOnly cookie. It is never written to localStorage
 * and the field is cleared as soon as the request finishes.
 */
export default function PairingView({ sessionAvailable, onPaired }: Props) {
  const [mode, setMode] = useState<'choose' | 'existing'>('choose');
  const [deviceId, setDeviceId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pair = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await heidiRequest<{ paired: boolean }>('/session', {
      method: 'POST',
      body: { action: 'pair', device_id: deviceId.trim(), secret: secret.trim() },
    });
    setSecret('');
    if (result.ok) {
      if (!(await onPaired())) setError(COOKIE_DROPPED);
    } else {
      setError(result.error.reason ? `${result.error.message} (${result.error.reason})` : result.error.message);
    }
    setBusy(false);
  };

  const requestAccess = async () => {
    setBusy(true);
    setError(null);
    const result = await heidiRequest<{ paired: boolean; device_id: string }>('/session', {
      method: 'POST',
      body: { action: 'request', device_name: 'Heidi Mobile' },
    });
    if (result.ok) {
      if (!(await onPaired())) setError(COOKIE_DROPPED);
    } else {
      setError(result.error.message);
    }
    setBusy(false);
  };

  return (
    <div className={styles.scroll}>
      <div style={{ maxWidth: 440, margin: '0 auto', paddingTop: 12 }}>
        <h1 style={{ fontSize: 24, margin: '0 0 6px' }}>Connect to HYDI</h1>
        <p className={styles.muted} style={{ marginBottom: 16 }}>
          Heidi needs this phone to be an approved HYDI device. Your credentials stay on the Heidi server in a
          secure cookie — nothing secret is stored on the phone in a form scripts can read.
        </p>

        {!sessionAvailable && (
          <div className={`${styles.card}`} role="alert">
            <span className={styles.errorText}>
              The Heidi server has no session key configured, so it can’t create a secure session. See
              “Server setup” in <span className={styles.code}>docs/HEIDI_MOBILE.md</span>, then restart the server.
            </span>
          </div>
        )}

        {error && <div className={styles.card} role="alert"><span className={styles.errorText}>{error}</span></div>}

        {mode === 'choose' && (
          <>
            <div className={styles.card}>
              <div className={styles.itemTitle}>Request access</div>
              <p className={styles.muted} style={{ margin: '4px 0 0' }}>
                Registers this phone with HYDI as a new device. An owner must approve it before it can see anything.
              </p>
              <div className={styles.btnRow}>
                <button type="button" className={styles.btnPrimary} onClick={() => void requestAccess()} disabled={busy || !sessionAvailable}>
                  {busy ? 'Registering…' : 'Request access'}
                </button>
              </div>
            </div>
            <div className={styles.card}>
              <div className={styles.itemTitle}>I have a device ID and secret</div>
              <p className={styles.muted} style={{ margin: '4px 0 0' }}>
                Use the credentials returned when the device was registered with <span className={styles.code}>POST /api/devices</span>.
              </p>
              <div className={styles.btnRow}>
                <button type="button" className={styles.btn} onClick={() => setMode('existing')} disabled={!sessionAvailable}>
                  Enter credentials
                </button>
              </div>
            </div>
          </>
        )}

        {mode === 'existing' && (
          <form className={`${styles.card} ${styles.form}`} onSubmit={(e) => void pair(e)}>
            <label className={styles.label}>
              Device ID
              <input
                className={styles.input}
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                required
              />
            </label>
            <label className={styles.label}>
              Device secret
              <input
                className={styles.input}
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="current-password"
                required
              />
            </label>
            <div className={styles.btnRow}>
              <button type="button" className={styles.btnGhost} onClick={() => { setMode('choose'); setError(null); }} disabled={busy}>Back</button>
              <button type="submit" className={styles.btnPrimary} disabled={busy || !deviceId.trim() || !secret.trim()}>
                {busy ? 'Checking with HYDI…' : 'Pair'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
