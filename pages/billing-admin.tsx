import React, { useCallback, useEffect, useState } from 'react';
import Head from 'next/head';
import { adminFetch, serviceSecret, setServiceSecret, formatMoney, palette } from '../lib/billing/client';

// Revenue dashboard (operator). Every number is shown per currency with the
// exact definition it was computed from (lib/billing/reporting.js). Cash
// collected, MRR and recognized revenue are kept separate on purpose.

interface Definition { key: string; label: string; formula: string; source: string; window: string; currency: string; included: string; excluded: string; refresh: string; limitations: string }
interface Report {
  window: { from: string; to: string; timezone: string };
  generated_at: string;
  definitions: Definition[];
  metrics: Record<string, unknown> & {
    gross_collected: Record<string, number>;
    refunds: Record<string, number>;
    open_disputes: Record<string, number>;
    tax_collected: { amounts: Record<string, number>; tax_unknown_count: number };
    processing_fees: { amounts: Record<string, number> | null; fee_unknown_count: number };
    net_collections: { amounts: Record<string, number>; fees_deducted: boolean };
    mrr: Record<string, number>;
    subscribers_by_status: Record<string, number>;
    revenue_by_plan: Record<string, Record<string, number>>;
    checkout_conversion: { started: number; completed: number; rate: number | null };
    usage_and_cost: { units_by_feature: Record<string, number>; cost_micros: Record<string, number>; cost_records: Record<string, number>; contribution_margin_micros_estimate: Record<string, number> };
    not_computed: Record<string, string>;
  };
}
interface WebhookRow { event_row_id: string; provider_event_id: string; event_type: string; status: string; attempts: number; last_error: string | null; received_at: string }

const box: React.CSSProperties = { background: palette.panel, border: `1px solid ${palette.border}`, borderRadius: 8, padding: 14, marginBottom: 14 };
const cell: React.CSSProperties = { padding: '4px 8px', borderTop: `1px solid ${palette.border}`, verticalAlign: 'top' };

function money(map: Record<string, number> | null | undefined): string {
  if (!map) return 'unknown';
  const entries = Object.entries(map);
  return entries.length ? entries.map(([c, v]) => formatMoney(v, c)).join(' · ') : '—';
}

function micros(map: Record<string, number>): string {
  const entries = Object.entries(map);
  return entries.length ? entries.map(([c, v]) => `${(v / 1e6).toFixed(4)} ${c.toUpperCase()}`).join(' · ') : '—';
}

function monthStart(offset: number): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1)).toISOString().slice(0, 10);
}

export default function BillingAdmin() {
  const [hasSecret, setHasSecret] = useState(false);
  const [secretInput, setSecretInput] = useState('');
  const [from, setFrom] = useState(monthStart(0));
  const [to, setTo] = useState(monthStart(1));
  const [report, setReport] = useState<Report | null>(null);
  const [events, setEvents] = useState<WebhookRow[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [showDefs, setShowDefs] = useState(false);

  const load = useCallback(async () => {
    const q = `from=${encodeURIComponent(`${from}T00:00:00Z`)}&to=${encodeURIComponent(`${to}T00:00:00Z`)}`;
    const r = await adminFetch<Report>(`/api/billing/admin/revenue?${q}`);
    if (!r.ok) { setMessage(r.status === 401 || r.status === 403 ? 'Not authorized: set the HYDI service secret.' : 'Could not load the report.'); return; }
    setReport(r.data as Report);
    const w = await adminFetch<{ events: WebhookRow[] }>('/api/billing/admin/webhooks?status=dead_letter&limit=50');
    if (w.ok) setEvents((w.data as { events: WebhookRow[] }).events);
  }, [from, to]);

  useEffect(() => { const ok = !!serviceSecret(); setHasSecret(ok); if (ok) load(); }, [load]);

  async function replay(row: WebhookRow) {
    const reason = window.prompt(`Replay ${row.event_type} (${row.provider_event_id})? Enter a reason (required):`);
    if (!reason) return;
    const r = await adminFetch<{ outcome: string }>('/api/billing/admin/webhooks', { method: 'POST', body: JSON.stringify({ op: 'replay', event_row_id: row.event_row_id, confirm: true, reason }) });
    setMessage(r.ok ? `Replay outcome: ${(r.data as { outcome: string }).outcome}` : `Replay refused: ${(r.data as { message?: string }).message || r.status}`);
    load();
  }

  async function reconcile() {
    if (!window.confirm('Re-read every open subscription and stale checkout from the payment provider?')) return;
    const r = await adminFetch<{ subscriptions_checked: number; subscriptions_changed: number; checkouts_checked: number; errors: unknown[] }>('/api/billing/admin/reconcile', { method: 'POST' });
    if (r.ok) {
      const d = r.data as { subscriptions_checked: number; subscriptions_changed: number; checkouts_checked: number; errors: unknown[] };
      setMessage(`Reconciled: ${d.subscriptions_checked} subscriptions (${d.subscriptions_changed} changed), ${d.checkouts_checked} checkouts, ${d.errors.length} errors.`);
    } else setMessage(`Reconcile failed: ${(r.data as { message?: string }).message || r.status}`);
    load();
  }

  const m = report?.metrics;
  const tiles: Array<[string, string, string]> = m ? [
    ['gross_collected', 'Gross collected', money(m.gross_collected)],
    ['refunds', 'Refunds', money(m.refunds)],
    ['net_collections', m.net_collections.fees_deducted ? 'Net collections' : 'Net collections (before fees)', money(m.net_collections.amounts)],
    ['mrr', 'MRR (list price, snapshot)', money(m.mrr)],
    ['open_disputes', 'Open disputes', money(m.open_disputes)],
    ['tax_collected', `Tax collected${m.tax_collected.tax_unknown_count ? ` (${m.tax_collected.tax_unknown_count} unknown)` : ''}`, money(m.tax_collected.amounts)],
    ['processing_fees', 'Processing fees', m.processing_fees.amounts ? money(m.processing_fees.amounts) : `unknown (${m.processing_fees.fee_unknown_count} payments)`],
    ['checkout_conversion', 'Checkout conversion', m.checkout_conversion.rate === null ? '—' : `${Math.round(m.checkout_conversion.rate * 100)}% (${m.checkout_conversion.completed}/${m.checkout_conversion.started})`],
  ] : [];

  return (
    <div style={{ minHeight: '100vh', background: palette.bg, color: palette.text, fontFamily: 'system-ui, sans-serif', padding: '20px 16px' }}>
      <Head><title>Hydi(ai) — Revenue</title></Head>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <h1 style={{ marginTop: 0 }}>Revenue</h1>
        {!hasSecret && (
          <div style={box}>
            <label htmlFor="sec">HYDI service secret (kept in this browser only):</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <input id="sec" type="password" value={secretInput} onChange={(e) => setSecretInput(e.target.value)} style={{ flex: '1 1 240px', padding: 8 }} />
              <button type="button" onClick={() => { setServiceSecret(secretInput); setHasSecret(true); setSecretInput(''); }}>Save</button>
            </div>
          </div>
        )}
        <div style={{ ...box, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label>From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To (exclusive) <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <span style={{ color: palette.muted }}>UTC</span>
          <button type="button" onClick={load}>Refresh</button>
          <button type="button" onClick={reconcile}>Reconcile with provider</button>
          <button type="button" onClick={() => setShowDefs((v) => !v)}>{showDefs ? 'Hide' : 'Show'} metric definitions</button>
        </div>
        {message && <div role="status" style={{ ...box, borderColor: palette.accent }}>{message}</div>}
        {m && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 14 }}>
              {tiles.map(([key, label, value]) => (
                <div key={key} style={{ ...box, marginBottom: 0 }} title={report?.definitions.find((d) => d.key === key)?.formula}>
                  <div style={{ color: palette.muted, fontSize: 13 }}>{label}</div>
                  <div style={{ fontSize: 20, fontWeight: 600, marginTop: 4 }}>{value}</div>
                </div>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
              <div style={box}>
                <h3 style={{ marginTop: 0 }}>Customers by status</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
                  {Object.entries(m.subscribers_by_status).map(([s, n]) => <tr key={s}><td style={cell}>{s}</td><td style={{ ...cell, textAlign: 'right' }}>{n}</td></tr>)}
                </tbody></table>
              </div>
              <div style={box}>
                <h3 style={{ marginTop: 0 }}>Collected by stream / plan</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
                  {Object.entries(m.revenue_by_plan).map(([k, v]) => <tr key={k}><td style={cell}>{k}</td><td style={{ ...cell, textAlign: 'right' }}>{money(v)}</td></tr>)}
                </tbody></table>
              </div>
              <div style={box}>
                <h3 style={{ marginTop: 0 }}>Usage &amp; variable cost <span style={{ color: palette.warn, fontSize: 12 }}>ESTIMATE</span></h3>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
                  {Object.entries(m.usage_and_cost.units_by_feature).map(([k, v]) => <tr key={k}><td style={cell}>{k} units</td><td style={{ ...cell, textAlign: 'right' }}>{v.toLocaleString()}</td></tr>)}
                  <tr><td style={cell}>Provider cost</td><td style={{ ...cell, textAlign: 'right' }}>{micros(m.usage_and_cost.cost_micros)}</td></tr>
                  <tr><td style={cell}>Unpriced cost records</td><td style={{ ...cell, textAlign: 'right' }}>{m.usage_and_cost.cost_records.unpriced}</td></tr>
                  <tr><td style={cell}>Contribution margin (est.)</td><td style={{ ...cell, textAlign: 'right' }}>{micros(m.usage_and_cost.contribution_margin_micros_estimate)}</td></tr>
                </tbody></table>
              </div>
              <div style={box}>
                <h3 style={{ marginTop: 0 }}>Not computed</h3>
                <ul style={{ margin: 0, paddingLeft: 18, color: palette.muted }}>
                  {Object.entries(m.not_computed).map(([k, v]) => <li key={k}><strong>{k.replace(/_/g, ' ')}</strong>: {v}</li>)}
                </ul>
              </div>
            </div>
            <div style={box}>
              <h3 style={{ marginTop: 0 }}>Dead-lettered webhooks ({events.length})</h3>
              {events.length === 0 ? <p style={{ color: palette.muted, margin: 0 }}>None.</p> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead><tr style={{ textAlign: 'left', color: palette.muted }}><th>Received</th><th>Type</th><th>Attempts</th><th>Last error</th><th /></tr></thead>
                    <tbody>{events.map((e) => (
                      <tr key={e.event_row_id}>
                        <td style={cell}>{new Date(e.received_at).toISOString().replace('T', ' ').slice(0, 19)}</td>
                        <td style={cell}>{e.event_type}</td>
                        <td style={cell}>{e.attempts}</td>
                        <td style={{ ...cell, maxWidth: 380, wordBreak: 'break-word' }}>{e.last_error}</td>
                        <td style={cell}><button type="button" onClick={() => replay(e)}>Replay</button></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </div>
            {showDefs && report && (
              <div style={box}>
                <h3 style={{ marginTop: 0 }}>Metric definitions</h3>
                {report.definitions.map((d) => (
                  <div key={d.key} style={{ borderTop: `1px solid ${palette.border}`, padding: '8px 0', fontSize: 13 }}>
                    <strong>{d.label}</strong>
                    <div><span style={{ color: palette.muted }}>Formula:</span> {d.formula}</div>
                    <div><span style={{ color: palette.muted }}>Source:</span> {d.source} · <span style={{ color: palette.muted }}>Window:</span> {d.window} · <span style={{ color: palette.muted }}>Currency:</span> {d.currency}</div>
                    <div><span style={{ color: palette.muted }}>Includes:</span> {d.included} · <span style={{ color: palette.muted }}>Excludes:</span> {d.excluded}</div>
                    <div><span style={{ color: palette.muted }}>Refresh:</span> {d.refresh} · <span style={{ color: palette.muted }}>Limitations:</span> {d.limitations}</div>
                  </div>
                ))}
              </div>
            )}
            <p style={{ color: palette.muted, fontSize: 12 }}>Window {report?.window.from} → {report?.window.to} ({report?.window.timezone}); generated {report?.generated_at}.</p>
          </>
        )}
      </div>
    </div>
  );
}
