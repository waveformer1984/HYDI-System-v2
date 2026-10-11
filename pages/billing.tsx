import React, { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { customerFetch, customerToken, formatMoney, formatDate, intervalLabel, palette } from '../lib/billing/client';

// Billing settings — a projection of GET /api/billing/account. Access state
// shown here is computed on the server from provider-confirmed subscription
// state; returning from checkout only starts a poll, it never grants access.

interface Usage { feature_key: string; limit_units: number | null; used_units: number; remaining_units: number | null; period_end: string }
interface Payment { payment_id: string; status: string; currency: string; amount_minor: number; amount_refunded_minor: number; occurred_at: string; invoice_url: string | null }
interface Account {
  tenant: { name: string; email: string };
  subscription: null | {
    subscription_id: string; status: string; has_access: boolean; access_until: string | null; access_hold: string | null;
    cancel_at_period_end: boolean; current_period_end: string | null; trial_end: string | null; past_due_since: string | null;
    plan: { name: string } | null;
    price: { currency: string; unit_amount_minor: number; billing_interval: string; interval_count: number } | null;
  };
  usage: Usage[];
  payments: Payment[];
  pending_checkouts: Array<{ intent_id: string; status: string; created_at: string }>;
}

const STATUS_TEXT: Record<string, [string, string]> = {
  active: ['Active', palette.good],
  trialing: ['Free trial', palette.good],
  past_due: ['Payment failed — action needed', palette.warn],
  unpaid: ['Unpaid — access paused', palette.bad],
  incomplete: ['Payment not completed', palette.warn],
  incomplete_expired: ['Checkout expired', palette.muted],
  canceled: ['Canceled', palette.muted],
  paused: ['Paused', palette.muted],
};

const box: React.CSSProperties = { background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 8, padding: 16, marginBottom: 16 };

export default function BillingPage() {
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const polls = useRef(0);

  const load = useCallback(async () => {
    if (!customerToken()) { setError('Open the access link you were given to view billing.'); return null; }
    const r = await customerFetch<Account>('/api/billing/account');
    if (r.ok) { setAccount(r.data as Account); setError(null); return r.data as Account; }
    setError(r.status === 401 ? 'Your access link is missing or expired. Ask your Hydi(ai) contact for a new one.' : 'Could not load billing details.');
    return null;
  }, []);

  useEffect(() => {
    const returning = new URL(window.location.href).searchParams.get('checkout') === 'return';
    setConfirming(returning);
    load();
    if (!returning) return undefined;
    // Poll while the provider confirms payment (webhook). Stop after ~2 minutes.
    const t = setInterval(async () => {
      polls.current += 1;
      const a = await load();
      if ((a && a.subscription && a.subscription.has_access) || polls.current > 40) {
        setConfirming(false);
        clearInterval(t);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [load]);

  async function portal() {
    setBusy(true);
    const r = await customerFetch<{ url: string }>('/api/billing/portal', { method: 'POST' });
    if (r.ok && 'url' in r.data) { window.location.href = r.data.url; return; }
    setBusy(false);
    setError((r.data as { message?: string }).message || 'Could not open the billing portal.');
  }

  async function changeSubscription(action: 'cancel' | 'reactivate') {
    if (!account?.subscription) return;
    if (action === 'cancel' && !window.confirm('Cancel your subscription? You keep access until the end of the current paid period.')) return;
    const reason = action === 'cancel' ? (window.prompt('Optional: tell us why you are canceling') || undefined) : undefined;
    setBusy(true);
    const r = await customerFetch<Account>('/api/billing/subscription', {
      method: 'POST', body: JSON.stringify({ action, subscription_id: account.subscription.subscription_id, reason }),
    });
    setBusy(false);
    if (r.ok) setAccount(r.data as Account);
    else setError((r.data as { message?: string }).message || 'That change could not be made.');
  }

  const sub = account?.subscription ?? null;
  const [label, color] = sub ? (STATUS_TEXT[sub.status] || [sub.status, palette.muted]) : ['No subscription', palette.muted];

  return (
    <div style={{ minHeight: '100vh', background: palette.bg, color: palette.text, fontFamily: 'system-ui, sans-serif', padding: '24px 16px' }}>
      <Head><title>Hydi(ai) — Billing</title></Head>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Billing</h1>
        {error && <div role="alert" style={{ ...box, borderColor: palette.bad }}>{error}</div>}
        {confirming && !(sub && sub.has_access) && (
          <div role="status" style={{ ...box, borderColor: palette.accent }}>
            Confirming your payment with our payment provider… Access is enabled as soon as the payment is confirmed. This page updates automatically.
          </div>
        )}
        {account && (
          <>
            <div style={box}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div style={{ color: palette.muted, fontSize: 13 }}>{account.tenant.name} · {account.tenant.email}</div>
                  <h2 style={{ margin: '4px 0' }}>{sub?.plan?.name || 'No active plan'}</h2>
                  {sub?.price && <div>{formatMoney(sub.price.unit_amount_minor, sub.price.currency)} {intervalLabel(sub.price.billing_interval, sub.price.interval_count)}</div>}
                </div>
                <div style={{ color, fontWeight: 600 }}>{label}</div>
              </div>
              {sub && (
                <div style={{ marginTop: 12, color: palette.muted, fontSize: 14 }}>
                  {sub.status === 'trialing' && <div>Trial ends {formatDate(sub.trial_end)}.</div>}
                  {sub.status === 'active' && !sub.cancel_at_period_end && <div>Renews {formatDate(sub.current_period_end)}.</div>}
                  {sub.cancel_at_period_end && sub.has_access && <div>Cancels {formatDate(sub.current_period_end)} — access continues until then.</div>}
                  {sub.status === 'past_due' && <div style={{ color: palette.warn }}>Your last payment failed. {sub.has_access ? `Access continues until ${formatDate(sub.access_until)} while we retry.` : 'Access is paused until payment succeeds.'} Update your payment method to keep your plan.</div>}
                  {sub.access_hold && <div style={{ color: palette.bad }}>Access is on hold ({sub.access_hold}). Please contact support.</div>}
                  {!sub.has_access && !sub.access_hold && sub.status !== 'past_due' && <div>Paid features are not currently available on this account.</div>}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                {sub && <button type="button" onClick={portal} disabled={busy}>Payment methods &amp; invoices</button>}
                {sub && !sub.cancel_at_period_end && ['active', 'trialing', 'past_due'].includes(sub.status) && (
                  <button type="button" onClick={() => changeSubscription('cancel')} disabled={busy}>Cancel subscription</button>
                )}
                {sub && sub.cancel_at_period_end && sub.has_access && (
                  <button type="button" onClick={() => changeSubscription('reactivate')} disabled={busy}>Keep my subscription</button>
                )}
                {(!sub || ['canceled', 'incomplete_expired'].includes(sub.status)) && <Link href="/pricing" style={{ color: palette.accent }}>Choose a plan</Link>}
              </div>
            </div>

            {account.usage.length > 0 && (
              <div style={box}>
                <h3 style={{ marginTop: 0 }}>Usage this period</h3>
                {account.usage.map((u) => {
                  const pct = u.limit_units ? Math.min(100, Math.round((u.used_units / u.limit_units) * 100)) : 0;
                  return (
                    <div key={u.feature_key} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>{u.feature_key.replace(/_/g, ' ')}</span>
                        <span>{u.limit_units === null ? `${u.used_units.toLocaleString()} used · unlimited` : `${u.used_units.toLocaleString()} / ${u.limit_units.toLocaleString()}`}</span>
                      </div>
                      {u.limit_units !== null && (
                        <div style={{ height: 6, background: palette.border, borderRadius: 3, marginTop: 4 }} aria-hidden>
                          <div style={{ width: `${pct}%`, height: 6, borderRadius: 3, background: pct >= 100 ? palette.bad : pct >= 80 ? palette.warn : palette.good }} />
                        </div>
                      )}
                      {u.remaining_units === 0 && <div style={{ color: palette.warn, fontSize: 13 }}>Limit reached — resets {formatDate(u.period_end)}.</div>}
                    </div>
                  );
                })}
              </div>
            )}

            <div style={box}>
              <h3 style={{ marginTop: 0 }}>Payment history</h3>
              {account.payments.length === 0 ? <p style={{ color: palette.muted }}>No payments yet.</p> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                    <thead><tr style={{ color: palette.muted, textAlign: 'left' }}><th>Date</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>
                    <tbody>
                      {account.payments.map((p) => (
                        <tr key={p.payment_id} style={{ borderTop: `1px solid ${palette.border}` }}>
                          <td>{formatDate(p.occurred_at)}</td>
                          <td>{formatMoney(p.amount_minor, p.currency)}{p.amount_refunded_minor > 0 ? ` (refunded ${formatMoney(p.amount_refunded_minor, p.currency)})` : ''}</td>
                          <td>{p.status.replace(/_/g, ' ')}</td>
                          <td>{p.invoice_url ? <a href={p.invoice_url} target="_blank" rel="noreferrer" style={{ color: palette.accent }}>View</a> : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
