import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  customerFetch, customerToken, setCustomerToken, formatMoney, intervalLabel, newIdempotencyKey, palette,
} from '../lib/billing/client';

// Pricing page — a projection of GET /api/billing/catalog (published offers
// only). Buying starts a provider-hosted checkout; nothing here grants
// access. Access follows the provider's verified confirmation.

interface Price {
  price_version_id: string; version: number; currency: string; unit_amount_minor: number;
  billing_interval: string; interval_count: number; trial_days: number;
}
interface Plan { plan_id: string; plan_key: string; name: string; description: string; features: string[]; limits: Record<string, number>; prices: Price[] }
interface Product { product_id: string; product_key: string; name: string; description: string; plans: Plan[] }

const FEATURE_LABELS: Record<string, string> = {
  ai_completions: 'AI completions',
  api_access: 'API access',
};

const box: React.CSSProperties = { background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 8, padding: 16 };

export default function PricingPage() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [hasToken, setHasToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setHasToken(!!customerToken());
    if (new URL(window.location.href).searchParams.get('checkout') === 'canceled') {
      setNotice('Checkout was canceled. You have not been charged.');
    }
    fetch('/api/billing/catalog')
      .then((r) => r.json())
      .then((d) => (d.products ? setProducts(d.products) : setError(d.message || 'Could not load plans')))
      .catch(() => setError('Could not load plans'));
  }, []);

  async function buy(price: Price) {
    setBusy(price.price_version_id);
    setError(null);
    const r = await customerFetch<{ url: string }>('/api/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ price_version_id: price.price_version_id, idempotency_key: newIdempotencyKey('checkout') }),
    });
    if (r.ok && 'url' in r.data) {
      window.location.href = r.data.url;
      return;
    }
    setBusy(null);
    const err = r.data as { error: string; message?: string };
    if (err.error === 'subscription_exists') setError('You already have a subscription. Manage it from Billing settings.');
    else if (r.status === 401) setError('Your access link is missing or expired. Ask your Hydi(ai) contact for a new one.');
    else setError(err.message || 'Checkout could not be started. Please try again.');
  }

  return (
    <div style={{ minHeight: '100vh', background: palette.bg, color: palette.text, fontFamily: 'system-ui, sans-serif', padding: '24px 16px' }}>
      <Head><title>Hydi(ai) — Pricing</title></Head>
      <div style={{ maxWidth: 960, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Plans</h1>
        <p style={{ color: palette.muted }}>Prices are charged by our payment provider. Taxes, where applicable, are shown at checkout. Cancel any time from Billing settings; access continues to the end of the paid period.</p>
        {notice && <div style={{ ...box, borderColor: palette.warn, marginBottom: 16 }}>{notice}</div>}
        {error && <div role="alert" style={{ ...box, borderColor: palette.bad, marginBottom: 16 }}>{error}</div>}
        {!hasToken && (
          <div style={{ ...box, marginBottom: 16 }}>
            <label htmlFor="tok">Have an access link or token? Paste it to purchase:</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input id="tok" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} style={{ flex: '1 1 240px', padding: 8, background: palette.bg, color: palette.text, border: `1px solid ${palette.border}`, borderRadius: 4 }} />
              <button type="button" onClick={() => { setCustomerToken(tokenInput); setHasToken(true); }} disabled={!tokenInput.trim()}>Save</button>
            </div>
          </div>
        )}
        {!products && !error && <p>Loading plans…</p>}
        {products && products.length === 0 && <p>No plans are available right now.</p>}
        {products?.map((product) => (
          <section key={product.product_id} style={{ marginBottom: 24 }}>
            <h2>{product.name}</h2>
            {product.description && <p style={{ color: palette.muted }}>{product.description}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
              {product.plans.map((plan) => (
                <div key={plan.plan_id} style={box}>
                  <h3 style={{ marginTop: 0 }}>{plan.name}</h3>
                  {plan.description && <p style={{ color: palette.muted }}>{plan.description}</p>}
                  <ul style={{ paddingLeft: 18 }}>
                    {plan.features.map((f) => (
                      <li key={f}>
                        {FEATURE_LABELS[f] || f}
                        {plan.limits[f] !== undefined ? ` — ${plan.limits[f].toLocaleString()} per billing period` : ' — unlimited'}
                      </li>
                    ))}
                    {plan.limits.seats !== undefined && <li>{plan.limits.seats} seat{plan.limits.seats === 1 ? '' : 's'}</li>}
                  </ul>
                  {plan.prices.map((price) => (
                    <div key={price.price_version_id} style={{ borderTop: `1px solid ${palette.border}`, paddingTop: 12, marginTop: 12 }}>
                      <div style={{ fontSize: 22, fontWeight: 600 }}>{formatMoney(price.unit_amount_minor, price.currency)}</div>
                      <div style={{ color: palette.muted }}>{intervalLabel(price.billing_interval, price.interval_count)}, renews automatically</div>
                      {price.trial_days > 0 && <div style={{ color: palette.good }}>{price.trial_days}-day free trial</div>}
                      <button type="button" style={{ marginTop: 10, width: '100%', padding: 10 }} disabled={!hasToken || busy !== null} onClick={() => buy(price)}>
                        {busy === price.price_version_id ? 'Opening secure checkout…' : 'Subscribe'}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        ))}
        <p style={{ color: palette.muted, fontSize: 13 }}>Already subscribed? <Link href="/billing" style={{ color: palette.accent }}>Billing settings</Link></p>
      </div>
    </div>
  );
}
