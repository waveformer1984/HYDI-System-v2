import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import type { GetServerSideProps } from 'next';
import { getOfferPageProps, DEMO_SLUG } from '../lib/makeready-bot/offer';

type PricingProps = {
  setup: string | null;
  monthly: string | null;
  showContactOnly: boolean;
  showBuyButton: boolean;
  stripe_payment_link: string;
};

type PageProps = {
  pricing: PricingProps;
  demo: {
    slug: string;
    display_name: string;
    demo: boolean;
    services: string[];
    policies: string[];
    phases_available: string[];
    add_ons: unknown[];
    stripe_payment_link: string;
    service_area?: string;
    lead_time?: string;
    insurance_statement?: string;
  };
};

export const getServerSideProps: GetServerSideProps<PageProps> = async () => ({
  props: getOfferPageProps(),
});

const styles = {
  page: {
    minHeight: '100vh',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    fontSize: 16,
    lineHeight: 1.45,
    color: '#1a1a1a',
    background: '#f8fafb',
    padding: '12px 14px 48px',
  } as React.CSSProperties,
  banner: {
    background: '#7c2d12',
    color: '#fff',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 12,
  } as React.CSSProperties,
  card: {
    background: '#fff',
    border: '1px solid #d0d7de',
    borderRadius: 12,
    padding: '14px 16px',
    marginBottom: 14,
  } as React.CSSProperties,
  h1: { fontSize: 22, margin: '0 0 8px', lineHeight: 1.2 } as React.CSSProperties,
  h2: { fontSize: 18, margin: '0 0 8px' } as React.CSSProperties,
  muted: { color: '#57606a', margin: '0 0 10px' } as React.CSSProperties,
  list: { margin: '0 0 12px', paddingLeft: 20 } as React.CSSProperties,
  input: {
    width: '100%',
    padding: 10,
    fontSize: 16,
    border: '1px solid #ccc',
    borderRadius: 8,
    marginBottom: 8,
  } as React.CSSProperties,
  btn: {
    width: '100%',
    padding: '12px 14px',
    fontSize: 16,
    fontWeight: 600,
    border: 0,
    borderRadius: 8,
    background: '#0f4c5c',
    color: '#fff',
    cursor: 'pointer',
  } as React.CSSProperties,
};

export default function MakeReadyBotOfferPage({ pricing, demo }: PageProps) {
  const [form, setForm] = useState({
    contact_name: '',
    email: '',
    phone: '',
    company_name: '',
    message: '',
  });
  const [leadStatus, setLeadStatus] = useState<'idle' | 'sending' | 'ok' | 'err'>('idle');
  const [leadMsg, setLeadMsg] = useState('');

  useEffect(() => {
    setLeadMsg('');
  }, [form]);

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    setLeadStatus('sending');
    setLeadMsg('');
    try {
      const res = await fetch('/api/makeready-bot/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setLeadStatus('err');
        setLeadMsg(data.error === 'invalid_email' ? 'Enter a valid email.' : 'Could not save — try again.');
        return;
      }
      setLeadStatus('ok');
      setLeadMsg('Thanks — we will follow up to schedule your demo.');
      setForm({ contact_name: '', email: '', phone: '', company_name: '', message: '' });
    } catch {
      setLeadStatus('err');
      setLeadMsg('Network error — try again.');
    }
  }

  return (
  <div style={styles.page}>
    <Head>
      <title>MakeReady Bot — builder intake for make-ready crews</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
    </Head>

    <div style={styles.banner} role="status">
      DEMO — fictional sample company below. Not a real cleaning business.
    </div>

    <header style={styles.card}>
      <h1 style={styles.h1}>MakeReady Bot</h1>
      <p style={styles.muted}>
        For post-construction and make-ready cleaning companies serving new-build communities (e.g. San Antonio).
      </p>
      <ul style={styles.list}>
        <li>Builders get instant scope estimates and can submit lots around the clock.</li>
        <li>Your owner receives structured job requests by email — no chasing texts.</li>
        <li>Typical onboarding: about 24 hours after you approve rates and service area.</li>
      </ul>
    </header>

    <section style={styles.card} aria-labelledby="pricing-heading">
      <h2 id="pricing-heading" style={styles.h2}>Pricing</h2>
      {pricing.showContactOnly ? (
        <p style={{ margin: 0, fontWeight: 600 }}>Contact for pricing</p>
      ) : (
        <p style={{ margin: 0 }}>
          One-time setup: {pricing.setup}
          <br />
          Monthly: {pricing.monthly}
        </p>
      )}
      {pricing.showBuyButton && (
        <p style={{ marginTop: 12 }}>
          <a
            href={pricing.stripe_payment_link}
            style={{ ...styles.btn, display: 'inline-block', textAlign: 'center', textDecoration: 'none' }}
          >
            Start checkout
          </a>
        </p>
      )}
    </section>

    <section style={styles.card} aria-labelledby="demo-heading">
      <h2 id="demo-heading" style={styles.h2}>Live demo widget</h2>
      <p style={styles.muted}>
        Fictional builder-facing intake — {demo.display_name}. Works in form mode when the local model is off.
      </p>
      <div id="makeready-demo-mount" />
      <Script
        src="/makeready-bot/widget.js"
        data-slug={DEMO_SLUG}
        data-api=""
        strategy="afterInteractive"
      />
    </section>

    <section style={styles.card} aria-labelledby="book-heading">
      <h2 id="book-heading" style={styles.h2}>Book a 10-min demo</h2>
      <form onSubmit={submitLead}>
        <label htmlFor="contact_name">Your name</label>
        <input
          id="contact_name"
          style={styles.input}
          required
          autoComplete="name"
          value={form.contact_name}
          onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
        />
        <label htmlFor="email">Work email</label>
        <input
          id="email"
          type="email"
          style={styles.input}
          required
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
        <label htmlFor="company_name">Company (optional)</label>
        <input
          id="company_name"
          style={styles.input}
          autoComplete="organization"
          value={form.company_name}
          onChange={(e) => setForm({ ...form, company_name: e.target.value })}
        />
        <label htmlFor="phone">Phone (optional)</label>
        <input
          id="phone"
          type="tel"
          style={styles.input}
          autoComplete="tel"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
        <label htmlFor="message">Notes (optional)</label>
        <textarea
          id="message"
          rows={3}
          style={{ ...styles.input, resize: 'vertical' }}
          value={form.message}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
        />
        <button type="submit" style={styles.btn} disabled={leadStatus === 'sending'}>
          {leadStatus === 'sending' ? 'Sending…' : 'Request demo'}
        </button>
        {leadMsg && (
          <p role="status" style={{ marginTop: 10, color: leadStatus === 'err' ? '#b42318' : '#0f4c5c' }}>
            {leadMsg}
          </p>
        )}
      </form>
    </section>
  </div>
  );
}