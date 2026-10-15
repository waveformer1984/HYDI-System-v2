import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { palette } from '../../lib/billing/client';

export default function BillingSignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await fetch('/api/billing/auth/signin', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      setError((data as { message?: string }).message || 'Sign-in failed');
      setBusy(false);
      return;
    }
    window.location.href = '/billing';
  }

  return (
    <>
      <Head><title>Sign in — Billing</title></Head>
      <main style={{ maxWidth: 420, margin: '48px auto', padding: 16, color: palette.text, background: palette.bg, minHeight: '100vh' }}>
        <h1 style={{ fontSize: 22 }}>Billing sign in</h1>
        <p style={{ color: palette.muted }}>Use your Hydi(ai) account. Legacy access links still work during the deprecation window.</p>
        <form onSubmit={submit} style={{ display: 'grid', gap: 12, marginTop: 24 }}>
          <label>
            Email
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
          </label>
          <label>
            Password
            <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} style={{ width: '100%', marginTop: 4 }} />
          </label>
          {error && <p style={{ color: palette.bad }}>{error}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p style={{ marginTop: 24 }}>
          <Link href="/billing/signup">Create account</Link>
          {' · '}
          <Link href="/pricing">Pricing</Link>
        </p>
      </main>
    </>
  );
}
