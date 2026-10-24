import Head from 'next/head';
import Link from 'next/link';

export default function GalacticBytesCancel() {
  return (
    <>
      <Head><title>Checkout canceled — Galactic Bytes</title></Head>
      <main style={{ maxWidth: 680, margin: '4rem auto', padding: '0 1.25rem', fontFamily: 'system-ui' }}>
        <h1>Checkout canceled</h1>
        <p>No order was completed.</p>
        <Link href="/galactic-bytes">Return to Galactic Bytes</Link>
      </main>
    </>
  );
}
