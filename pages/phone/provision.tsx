import { useEffect, useRef, useState } from 'react';

// Shows a one-time QR the phone's Hydi dashboard scans to import its keys.
// The QR holds a 5-minute single-use code, never a key. It is hidden after
// 60 seconds; a photo of the screen is useless once the code is used.

type Issued = { svg: string; expiresAt: number; keys: string[]; hosts: string[] };

const SHOW_MS = 60 * 1000;

export default function PhoneProvision() {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState<string>('');
  const [left, setLeft] = useState<number>(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function hide() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setIssued(null);
    setLeft(0);
  }

  async function show() {
    setError('');
    hide();
    try {
      const res = await fetch('/api/phone/provision/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hydi-Provision': '1' },
        body: '{}',
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(String(data.error || `Frank answered ${res.status}`));
        return;
      }
      setIssued({ svg: data.svg, expiresAt: data.expiresAt, keys: data.keys, hosts: data.hosts });
      const shownUntil = Date.now() + SHOW_MS;
      setLeft(SHOW_MS / 1000);
      timer.current = setInterval(() => {
        const s = Math.max(0, Math.round((shownUntil - Date.now()) / 1000));
        setLeft(s);
        if (s === 0) hide();
      }, 1000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'request failed');
    }
  }

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '0 auto', padding: 16, color: '#111', background: '#fff', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 22, margin: '8px 0' }}>Phone key QR</h1>
      <p style={{ color: '#444', lineHeight: 1.5 }}>
        On the phone, open the Hydi dashboard (http://127.0.0.1:3006), tap ⋯ → <b>Scan key QR</b>, then show the code
        below. The code works once, for 5 minutes, and contains no keys.
      </p>
      {!issued && (
        <button onClick={show} style={{ fontSize: 18, padding: '12px 20px', borderRadius: 10, border: '1px solid #222', background: '#111', color: '#fff' }}>
          Show QR
        </button>
      )}
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      {issued && (
        <section>
          <div style={{ maxWidth: 360, margin: '12px 0' }} dangerouslySetInnerHTML={{ __html: issued.svg }} />
          <p style={{ margin: '4px 0' }}>Hiding in <b>{left}s</b>. Keys it unlocks: {issued.keys.join(', ')}.</p>
          <p style={{ margin: '4px 0', color: '#444' }}>Phone will reach Frank at: {issued.hosts.join(', ')}</p>
          <button onClick={hide} style={{ marginTop: 8, fontSize: 16, padding: '8px 14px' }}>Hide now</button>
        </section>
      )}
    </main>
  );
}
