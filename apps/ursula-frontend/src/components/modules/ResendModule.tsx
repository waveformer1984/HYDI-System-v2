/**
 * ResendModule — Email Platform Monitor & Composer
 * 
 * Full Resend email platform integration for Ursula.
 * Tabs: Dashboard, Compose, Email Log, Domains, API Reference.
 * 
 * Config: NEXT_PUBLIC_RAILWAY_URL for email log, NEXT_PUBLIC_RESEND_API_KEY for Resend API.
 * Error handling: Graceful fallback to mock data in test mode.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Mail, Send, CheckCircle2, XCircle, RefreshCw, ArrowUpRight,
  Globe, Key, AlertCircle, Clock, TrendingUp, FileText,
  AtSign, Inbox, BarChart3, Copy, ExternalLink,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

const RAILWAY_URL = process.env.NEXT_PUBLIC_RAILWAY_URL || 'https://web-services-production-55bf.up.railway.app';
const MASTER_KEY = process.env.NEXT_PUBLIC_GATEWAY_MASTER_KEY || '';
const RESEND_API_KEY = process.env.NEXT_PUBLIC_RESEND_API_KEY || '';

interface ResendDomain {
  id: string;
  name: string;
  status: string;
  created_at: string;
  region: string;
  records: { record: string; name: string; type: string; ttl: string; status: string; value: string; priority?: number }[];
}

interface EmailLogEntry {
  timestamp: string;
  to: string;
  subject: string;
  status: string;
  resend_id: string;
}

type Tab = 'dashboard' | 'compose' | 'emails' | 'domains' | 'reference';

export default function ResendModule() {
  const { isLive } = useMode();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [domains, setDomains] = useState<ResendDomain[]>([]);
  const [emails, setEmails] = useState<EmailLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFrom, setComposeFrom] = useState('hello@protoforgeindustries.com');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; id?: string; error?: string } | null>(null);

  const totalSent = emails.filter(e => e.status === 'sent').length;
  const totalFailed = emails.filter(e => e.status.startsWith('error')).length;
  const totalLogged = emails.filter(e => e.status === 'logged_only').length;
  const verifiedDomains = domains.filter(d => d.status === 'verified').length;

  const gwH: Record<string, string> = { 'Content-Type': 'application/json', ...(MASTER_KEY ? { Authorization: `Bearer ${MASTER_KEY}` } : {}) };
  const rsH: Record<string, string> = { 'Content-Type': 'application/json', ...(RESEND_API_KEY ? { Authorization: `Bearer ${RESEND_API_KEY}` } : {}) };

  const fetchDomains = useCallback(async () => {
    if (!isLive || !RESEND_API_KEY) return;
    try {
      const res = await fetch('https://api.resend.com/domains', { headers: rsH });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDomains(data.data || []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to fetch domains'); }
  }, [isLive]);

  const fetchEmails = useCallback(async () => {
    if (!isLive) return;
    try {
      const res = await fetch(`${RAILWAY_URL}/v1/admin/automation/emails?limit=50`, { headers: gwH });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEmails(data.emails || []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Failed to fetch emails'); }
  }, [isLive]);

  const refreshAll = useCallback(async () => {
    setLoading(true); setError(null);
    await Promise.all([fetchDomains(), fetchEmails()]);
    setLoading(false);
  }, [fetchDomains, fetchEmails]);

  useEffect(() => { if (isLive) refreshAll(); }, [isLive, refreshAll]);

  const sendEmail = async () => {
    if (!composeTo || !composeSubject || !composeBody) return;
    setSending(true); setSendResult(null);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: rsH,
        body: JSON.stringify({ from: `HYDI <${composeFrom}>`, to: [composeTo], subject: composeSubject, html: composeBody.replace(/\n/g, '<br/>') }),
      });
      const data = await res.json();
      if (res.ok) { setSendResult({ success: true, id: data.id }); setComposeTo(''); setComposeSubject(''); setComposeBody(''); fetchEmails(); }
      else { setSendResult({ success: false, error: data.message || `HTTP ${res.status}` }); }
    } catch (err) { setSendResult({ success: false, error: err instanceof Error ? err.message : 'Send failed' }); }
    finally { setSending(false); }
  };

  const clip = (text: string, label: string) => { navigator.clipboard.writeText(text); setCopied(label); setTimeout(() => setCopied(null), 2000); };

  // Mock data
  const mockDomains: ResendDomain[] = [{
    id: 'dom_mock1', name: 'protoforgeindustries.com', status: 'verified', created_at: '2026-02-11T21:50:00Z', region: 'us-east-1',
    records: [
      { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', ttl: 'Auto', status: 'verified', value: 'p=MIGfMA0...' },
      { record: 'SPF', name: 'send', type: 'TXT', ttl: 'Auto', status: 'verified', value: 'v=spf1 include:amazonses.com ~all' },
      { record: 'MX', name: 'send', type: 'MX', ttl: 'Auto', status: 'verified', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10 },
    ],
  }];
  const mockEmails: EmailLogEntry[] = [
    { timestamp: '2026-02-11T21:56:25Z', to: 'waveformer1984@gmail.com', subject: 'Welcome to HYDI Starter!', status: 'sent', resend_id: '2b8e4606' },
    { timestamp: '2026-02-11T19:53:54Z', to: 'test@protoforge.dev', subject: 'Welcome to HYDI Starter!', status: 'error_403', resend_id: '' },
  ];

  const dD = isLive ? domains : mockDomains;
  const dE = isLive ? emails : mockEmails;
  const dS = isLive ? totalSent : 2;
  const dF = isLive ? totalFailed : 1;
  const dL = isLive ? totalLogged : 0;
  const dV = isLive ? verifiedDomains : 1;

  const iS: React.CSSProperties = { background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--text-active)' };
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <BarChart3 size={12} /> },
    { key: 'compose', label: 'Compose', icon: <Send size={12} /> },
    { key: 'emails', label: 'Email Log', icon: <Inbox size={12} /> },
    { key: 'domains', label: 'Domains', icon: <Globe size={12} /> },
    { key: 'reference', label: 'API Reference', icon: <FileText size={12} /> },
  ];

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Mail size={20} style={{ color: 'var(--text-accent)' }} />
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>Resend Email Platform</h1>
          <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: dV > 0 ? '#3fb950' : '#f85149', background: dV > 0 ? '#3fb95015' : '#f8514915' }}>
            {dV > 0 ? <CheckCircle2 size={10} /> : <XCircle size={10} />} {dV > 0 ? `${dV} Verified` : 'No Domains'}
          </span>
        </div>
        {isLive && (
          <button onClick={refreshAll} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono hover:bg-white/5" style={{ color: 'var(--text-accent)' }}>
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      </div>

      <div className="flex gap-1 mb-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono"
            style={{ color: tab === t.key ? 'var(--text-active)' : 'var(--text-secondary)', borderBottom: tab === t.key ? '2px solid var(--text-accent)' : '2px solid transparent' }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Dashboard */}
      {tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: <CheckCircle2 size={14} />, label: 'Sent', value: dS, color: '#3fb950' },
              { icon: <XCircle size={14} />, label: 'Failed', value: dF, color: '#f85149' },
              { icon: <Clock size={14} />, label: 'Logged Only', value: dL, color: '#d29922' },
              { icon: <Globe size={14} />, label: 'Domains', value: dV, color: '#58a6ff' },
            ].map((s) => (
              <div key={s.label} className="rounded-md p-3 border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
                <div className="text-lg font-bold font-mono" style={{ color: 'var(--text-active)' }}>{s.value}</div>
                <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-active)' }}><AtSign size={14} /> Sender Identity</h3>
            {[['From Name', 'HYDI'], ['From Email', 'hello@protoforgeindustries.com'], ['Provider', 'Resend'], ['Region', 'us-east-1'], ['API Key', RESEND_API_KEY ? 'Configured' : 'Not Set (env)']].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-1">
                <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>{k}</span>
                <span className="text-[11px] font-mono font-semibold" style={{ color: k === 'API Key' ? (RESEND_API_KEY ? '#3fb950' : '#d29922') : 'var(--text-active)' }}>{v}</span>
              </div>
            ))}
          </div>
          <div className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--text-active)' }}><TrendingUp size={14} /> Recent</h3>
            {dE.slice(0, 5).map((e, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 border-b last:border-b-0" style={{ borderColor: 'var(--border-color)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: e.status === 'sent' ? '#3fb95015' : '#f8514915', color: e.status === 'sent' ? '#3fb950' : '#f85149' }}>{e.status === 'sent' ? '✓' : '✗'}</span>
                  <span className="text-[11px] font-mono" style={{ color: 'var(--text-active)' }}>{e.to}</span>
                </div>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{new Date(e.timestamp).toLocaleString()}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4">
            {[['Resend Dashboard', 'https://resend.com/emails'], ['Manage Domains', 'https://resend.com/domains'], ['Gateway Docs', `${RAILWAY_URL}/docs`]].map(([l, u]) => (
              <a key={l} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-mono hover:underline" style={{ color: 'var(--text-accent)' }}>{l} <ArrowUpRight size={10} /></a>
            ))}
          </div>
        </div>
      )}

      {/* Compose */}
      {tab === 'compose' && (
        <div className="max-w-2xl space-y-4">
          <div className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-active)' }}><Send size={14} /> Send Email</h3>
            {!RESEND_API_KEY && isLive && (
              <div className="mb-3 p-3 rounded-md border text-[11px] font-mono flex items-center gap-2" style={{ background: '#d2992215', borderColor: '#d2992230', color: '#d29922' }}>
                <AlertCircle size={12} /> Set NEXT_PUBLIC_RESEND_API_KEY in .env.local to send from Ursula.
              </div>
            )}
            <div className="space-y-3">
              {[['From', composeFrom, setComposeFrom, 'hello@protoforgeindustries.com'], ['To', composeTo, setComposeTo, 'recipient@example.com'], ['Subject', composeSubject, setComposeSubject, 'Email subject']].map(([label, val, setter, ph]) => (
                <div key={label as string}>
                  <label className="block text-[10px] font-mono mb-1" style={{ color: 'var(--text-secondary)' }}>{label as string}</label>
                  <input type="text" value={val as string} onChange={(e) => (setter as React.Dispatch<React.SetStateAction<string>>)(e.target.value)} className="w-full px-3 py-2 rounded border text-[12px] font-mono" style={iS} placeholder={ph as string} />
                </div>
              ))}
              <div>
                <label className="block text-[10px] font-mono mb-1" style={{ color: 'var(--text-secondary)' }}>Body</label>
                <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} rows={8} className="w-full px-3 py-2 rounded border text-[12px] font-mono resize-y" style={iS} placeholder="Email content..." />
              </div>
              <button onClick={sendEmail} disabled={sending || !composeTo || !composeSubject || !composeBody || (!RESEND_API_KEY && isLive)} className="flex items-center gap-2 px-4 py-2 rounded text-[12px] font-mono font-semibold disabled:opacity-50" style={{ background: 'var(--text-accent)', color: '#fff' }}>
                <Send size={12} /> {sending ? 'Sending...' : 'Send Email'}
              </button>
            </div>
            {sendResult && (
              <div className="mt-3 p-3 rounded-md border text-[11px] font-mono flex items-center gap-2" style={{ background: sendResult.success ? '#3fb95015' : '#f8514915', borderColor: sendResult.success ? '#3fb95030' : '#f8514930', color: sendResult.success ? '#3fb950' : '#f85149' }}>
                {sendResult.success ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                {sendResult.success ? `Sent! ID: ${sendResult.id}` : `Error: ${sendResult.error}`}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Email Log */}
      {tab === 'emails' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>{dE.length} emails</span>
            <div className="flex gap-2 text-[10px] font-mono">
              <span style={{ color: '#3fb950' }}>{dS} sent</span>
              <span style={{ color: '#f85149' }}>{dF} failed</span>
              <span style={{ color: '#d29922' }}>{dL} logged</span>
            </div>
          </div>
          {dE.length === 0 ? (
            <div className="text-center py-8 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>No emails yet.</div>
          ) : dE.map((e, i) => (
            <div key={i} className="rounded-md p-3 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--text-active)' }}>{e.subject}</span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: e.status === 'sent' ? '#3fb95015' : e.status === 'logged_only' ? '#d2992215' : '#f8514915', color: e.status === 'sent' ? '#3fb950' : e.status === 'logged_only' ? '#d29922' : '#f85149' }}>{e.status}</span>
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <span>To: {e.to}</span><span>{new Date(e.timestamp).toLocaleString()}</span>
              </div>
              {e.resend_id && (
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[9px] font-mono" style={{ color: 'var(--text-secondary)' }}>ID: {e.resend_id}</span>
                  <button onClick={() => clip(e.resend_id, e.resend_id)} title="Copy"><Copy size={9} style={{ color: 'var(--text-secondary)' }} /></button>
                  {copied === e.resend_id && <span className="text-[9px] font-mono" style={{ color: '#3fb950' }}>copied</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Domains */}
      {tab === 'domains' && (
        <div className="space-y-3">
          {dD.length === 0 ? (
            <div className="text-center py-8 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              {!RESEND_API_KEY && isLive ? 'Set NEXT_PUBLIC_RESEND_API_KEY to view domains.' : 'No domains configured.'}
            </div>
          ) : dD.map((d) => (
            <div key={d.id} className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Globe size={14} style={{ color: 'var(--text-accent)' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{d.name}</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: d.status === 'verified' ? '#3fb95015' : '#d2992215', color: d.status === 'verified' ? '#3fb950' : '#d29922' }}>{d.status}</span>
              </div>
              <div className="flex gap-4 mb-3 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <span>Region: {d.region}</span><span>Added: {new Date(d.created_at).toLocaleDateString()}</span>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] font-mono font-semibold mb-1" style={{ color: 'var(--text-active)' }}>DNS Records</div>
                {d.records.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] font-mono py-1 border-b last:border-b-0" style={{ borderColor: 'var(--border-color)' }}>
                    <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: '#58a6ff15', color: '#58a6ff' }}>{r.type}</span>
                    <span style={{ color: 'var(--text-active)' }}>{r.name}</span>
                    <span className="px-1.5 py-0.5 rounded" style={{ background: r.status === 'verified' ? '#3fb95015' : '#d2992215', color: r.status === 'verified' ? '#3fb950' : '#d29922' }}>{r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* API Reference */}
      {tab === 'reference' && (
        <div className="space-y-4">
          <div className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-active)' }}>Resend API</h3>
            {[
              ['POST', 'https://api.resend.com/emails', 'Send email'],
              ['GET', 'https://api.resend.com/emails/:id', 'Get email status'],
              ['GET', 'https://api.resend.com/domains', 'List domains'],
              ['POST', 'https://api.resend.com/domains', 'Add domain'],
              ['GET', 'https://api.resend.com/domains/:id/verify', 'Verify domain'],
              ['GET', 'https://api.resend.com/api-keys', 'List API keys'],
            ].map(([m, p, d]) => (
              <div key={p} className="flex items-center gap-2 text-[11px] font-mono py-1">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: m === 'POST' ? '#d2992215' : '#3fb95015', color: m === 'POST' ? '#d29922' : '#3fb950' }}>{m}</span>
                <span style={{ color: 'var(--text-active)' }}>{p}</span>
                <span style={{ color: 'var(--text-secondary)' }}>— {d}</span>
              </div>
            ))}
          </div>
          <div className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-active)' }}>Gateway Email Endpoints</h3>
            {[
              ['GET', '/v1/admin/automation/emails', 'Email audit log'],
              ['POST', '/v1/admin/automation/onboard', 'Trigger onboarding email'],
              ['POST', '/v1/admin/automation/outreach/run', 'Run outreach sequence'],
              ['POST', '/v1/admin/automation/followups/run', 'Run follow-ups'],
            ].map(([m, p, d]) => (
              <div key={p} className="flex items-center gap-2 text-[11px] font-mono py-1">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: m === 'POST' ? '#d2992215' : '#3fb95015', color: m === 'POST' ? '#d29922' : '#3fb950' }}>{m}</span>
                <span style={{ color: 'var(--text-active)' }}>{p}</span>
                <span style={{ color: 'var(--text-secondary)' }}>— {d}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-4">
            {[['Resend Docs', 'https://resend.com/docs'], ['API Reference', 'https://resend.com/docs/api-reference']].map(([l, u]) => (
              <a key={l} href={u} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11px] font-mono hover:underline" style={{ color: 'var(--text-accent)' }}>{l} <ArrowUpRight size={10} /></a>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 rounded-md border text-[11px] font-mono flex items-center gap-2" style={{ background: '#f8514915', borderColor: '#f8514930', color: '#f85149' }}>
          <AlertCircle size={12} /> {error}
        </div>
      )}
    </div>
  );
}
