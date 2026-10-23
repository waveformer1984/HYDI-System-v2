import Head from 'next/head';

export default function GalacticBytesSuccess() {
  return (
    <>
      <Head><title>Order received — Galactic Bytes</title></Head>
      <main style={{ maxWidth: 680, margin: '4rem auto', padding: '0 1.25rem', fontFamily: 'system-ui' }}>
        <h1>Order received</h1>
        <p>Your payment is being confirmed. Galactic Bytes will deliver to the email entered at checkout.</p>
        <p>Keep your Stripe receipt as proof of purchase.</p>
      </main>
    </>
  );
}
