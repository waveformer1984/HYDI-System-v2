import Head from 'next/head';
import { FormEvent, useState } from 'react';

export default function GalacticBytesStorefront() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function checkout(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const idempotencyKey = globalThis.crypto.randomUUID();
      const response = await fetch('/api/galactic-bytes/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({ email }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.url !== 'string') throw new Error(result.message || 'Checkout is unavailable.');
      window.location.assign(result.url);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Checkout is unavailable.');
      setLoading(false);
    }
  }

  return (
    <>
      <Head><title>Galactic Bytes</title></Head>
      <main style={{ maxWidth: 680, margin: '4rem auto', padding: '0 1.25rem', fontFamily: 'system-ui' }}>
        <p>Galactic Bytes</p>
        <h1>First digital product</h1>
        <p>A focused digital deliverable from Galactic Bytes. The current price is shown securely on Stripe Checkout.</p>
        <form onSubmit={checkout}>
          <label htmlFor="email">Delivery email</label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            style={{ display: 'block', width: '100%', padding: '.75rem', margin: '.5rem 0 1rem' }}
          />
          <button type="submit" disabled={loading}>{loading ? 'Opening checkout…' : 'Buy securely with Stripe'}</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    </>
  );
}
