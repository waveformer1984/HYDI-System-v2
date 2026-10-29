import { useEffect, useRef, useState } from 'react';

// Shows a one-time code the phone's Hydi dashboard imports its keys with —
// as a QR to scan, and as text to copy or type (for when the phone can't see
// Frank's screen, e.g. over remote desktop). The code works once, for 5
// minutes, and contains no keys; it stays on screen until it expires, is
// used, or "Hide now" is tapped.

type Issued = { svg: string; payload: string; code: string; expiresAt: number; keys: string[]; hosts: string[] };

function grouped(code: string): string {
  return (code.match(/.{1,4}/g) || []).join('-');
}

function mmss(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function PhoneProvision() {
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState<string>('');
  const [left, setLeft] = useState<number>(0);
  const [copied, setCopied] = useState<string>('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  function hide() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setIssued(null);
    setLeft(0);
    setCopied('');
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
      setIssued({ svg: data.svg, payload: data.payload, code: data.code, expiresAt: data.expiresAt, keys: data.keys, hosts: data.hosts });
      const tick = () => {
        const s = Math.max(0, Math.round((Number(data.expiresAt) - Date.now()) / 1000));
        setLeft(s);
        if (s === 0) hide();
      };
      tick();
      timer.current = setInterval(tick, 1000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'request failed');
    }
  }

  async function copyCode() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.payload);
      setCopied('Copied. Paste it on the phone: ⚙ → Scan key QR → Paste code.');
    } catch {
      // Clipboard API refused (e.g. not focused): select the text instead.
      textRef.current?.select();
      setCopied('Selected — press Ctrl+C to copy.');
    }
  }

  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 520, margin: '0 auto', padding: 16, color: '#111', background: '#fff', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 22, margin: '8px 0' }}>Phone key code</h1>
      <p style={{ color: '#444', lineHeight: 1.5 }}>
        On the phone, open the Hydi dashboard (http://127.0.0.1:3006), tap ⚙ → <b>Scan key QR</b>. Then either scan the QR
        below, or use <b>Paste code</b> with the copied code or the short code typed in. The code works once, for 5 minutes,
        and contains no keys.
      </p>
      {!issued && (
        <button onClick={show} style={{ fontSize: 18, padding: '12px 20px', borderRadius: 10, border: '1px solid #222', background: '#111', color: '#fff' }}>
          Show code
        </button>
      )}
      {error && <p style={{ color: '#b00020' }}>{error}</p>}
      {issued && (
        <section>
          <div style={{ maxWidth: 360, margin: '12px 0' }} dangerouslySetInnerHTML={{ __html: issued.svg }} />
          <p style={{ margin: '4px 0' }}>Expires in <b>{mmss(left)}</b>. Keys it unlocks: {issued.keys.join(', ')}.</p>
          <p style={{ margin: '12px 0 4px' }}>Short code (type it on the phone if copying doesn&apos;t reach it):</p>
          <p style={{ margin: '0 0 8px', fontFamily: 'ui-monospace, monospace', fontSize: 20, letterSpacing: 1, wordBreak: 'break-all' }}>{grouped(issued.code)}</p>
          <textarea
            ref={textRef}
            readOnly
            value={issued.payload}
            onFocus={(e) => e.currentTarget.select()}
            rows={3}
            aria-label="Full code"
            style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={copyCode} style={{ fontSize: 16, padding: '8px 14px', borderRadius: 8, border: '1px solid #222', background: '#111', color: '#fff' }}>Copy code</button>
            <button onClick={hide} style={{ fontSize: 16, padding: '8px 14px' }}>Hide now</button>
          </div>
          {copied && <p style={{ margin: '6px 0', color: '#0a6' }}>{copied}</p>}
          <p style={{ margin: '8px 0', color: '#444' }}>Phone will reach Frank at: {issued.hosts.join(', ')}</p>
        </section>
      )}
    </main>
  );
}
