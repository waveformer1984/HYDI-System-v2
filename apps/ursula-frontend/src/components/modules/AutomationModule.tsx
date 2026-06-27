/**
 * AutomationModule — Outreach, Response & Onboarding Monitor
 * 
 * Monitors the automated outreach pipeline, onboarding sequences,
 * and follow-up schedules from the payment gateway automation engine.
 * 
 * Config: Uses NEXT_PUBLIC_RAILWAY_URL for live data from Railway gateway.
 * Error handling: Shows connection error state when gateway unreachable.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Mail, Users, Send, Clock, CheckCircle2, XCircle, RefreshCw,
  ArrowUpRight, Activity, UserPlus, Zap, Calendar, TrendingUp,
  AlertCircle, Play,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

const RAILWAY_URL = process.env.NEXT_PUBLIC_RAILWAY_URL || 'https://web-services-production-55bf.up.railway.app';
const MASTER_KEY = process.env.NEXT_PUBLIC_GATEWAY_MASTER_KEY || '';

interface AutomationHealth {
  enabled: boolean;
  total_prospects: number;
  by_status: Record<string, number>;
  pending_followups: number;
  templates: {
    outreach: string[];
    welcome: string[];
    followup: string[];
  };
}

interface Prospect {
  email: string;
  name: string;
  persona: string;
  source: string;
  status: string;
  outreach_step: number;
  last_contacted: string | null;
  created_at: string;
}

interface EmailLogEntry {
  timestamp: string;
  to: string;
  subject: string;
  status: string;
  resend_id: string;
}

type Tab = 'dashboard' | 'prospects' | 'emails' | 'actions';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new: { bg: '#3fb95015', text: '#3fb950' },
  outreach_1: { bg: '#d2992215', text: '#d29922' },
  outreach_2: { bg: '#d2992215', text: '#d29922' },
  outreach_3: { bg: '#d2992215', text: '#d29922' },
  responded: { bg: '#58a6ff15', text: '#58a6ff' },
  converted: { bg: '#3fb95015', text: '#3fb950' },
  unsubscribed: { bg: '#f8514915', text: '#f85149' },
};

export default function AutomationModule() {
  const { isLive } = useMode();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [health, setHealth] = useState<AutomationHealth | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [emails, setEmails] = useState<EmailLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(MASTER_KEY ? { Authorization: `Bearer ${MASTER_KEY}` } : {}),
  };

  const fetchHealth = useCallback(async () => {
    if (!isLive) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${RAILWAY_URL}/v1/admin/automation/health`, { headers });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setHealth(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, [isLive]);

  const fetchProspects = useCallback(async () => {
    if (!isLive) return;
    try {
      const res = await fetch(`${RAILWAY_URL}/v1/admin/automation/prospects`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      setProspects(data.prospects || []);
    } catch { /* silent */ }
  }, [isLive]);

  const fetchEmails = useCallback(async () => {
    if (!isLive) return;
    try {
      const res = await fetch(`${RAILWAY_URL}/v1/admin/automation/emails?limit=30`, { headers });
      if (!res.ok) return;
      const data = await res.json();
      setEmails(data.emails || []);
    } catch { /* silent */ }
  }, [isLive]);

  const runAction = async (endpoint: string, label: string) => {
    setActionResult(null);
    try {
      const res = await fetch(`${RAILWAY_URL}${endpoint}`, { method: 'POST', headers });
      const data = await res.json();
      setActionResult(`${label}: ${JSON.stringify(data)}`);
      fetchHealth();
      fetchProspects();
      fetchEmails();
    } catch (err) {
      setActionResult(`${label} failed: ${err instanceof Error ? err.message : 'error'}`);
    }
  };

  useEffect(() => {
    if (isLive) {
      fetchHealth();
      fetchProspects();
      fetchEmails();
    }
  }, [isLive, fetchHealth, fetchProspects, fetchEmails]);

  // Mock data for test mode
  const mockHealth: AutomationHealth = {
    enabled: true,
    total_prospects: 3,
    by_status: { new: 1, outreach_1: 1, converted: 1 },
    pending_followups: 4,
    templates: {
      outreach: ['outreach_1', 'outreach_2', 'outreach_3'],
      welcome: ['hydi_starter', 'hydi_pro', 'lead_pack'],
      followup: ['day_3', 'day_7', 'day_14', 'day_30'],
    },
  };

  const mockProspects: Prospect[] = [
    { email: 'alex@startup.io', name: 'Alex', persona: 'The Builder', source: 'linkedin', status: 'outreach_1', outreach_step: 1, last_contacted: '2026-02-10T12:00:00Z', created_at: '2026-02-09T10:00:00Z' },
    { email: 'sam@agency.co', name: 'Sam', persona: 'The Hustler', source: 'reddit', status: 'new', outreach_step: 0, last_contacted: null, created_at: '2026-02-11T08:00:00Z' },
    { email: 'pat@scaler.com', name: 'Pat', persona: 'The Scaler', source: 'referral', status: 'converted', outreach_step: 2, last_contacted: '2026-02-11T09:00:00Z', created_at: '2026-02-08T14:00:00Z' },
  ];

  const mockEmails: EmailLogEntry[] = [
    { timestamp: '2026-02-11T12:00:00Z', to: 'pat@scaler.com', subject: 'Welcome to HYDI Starter!', status: 'sent', resend_id: 'abc123' },
    { timestamp: '2026-02-10T12:00:00Z', to: 'alex@startup.io', subject: 'Quick question about growing your business', status: 'sent', resend_id: 'def456' },
  ];

  const displayHealth = isLive ? health : mockHealth;
  const displayProspects = isLive ? prospects : mockProspects;
  const displayEmails = isLive ? emails : mockEmails;

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <Activity size={12} /> },
    { key: 'prospects', label: 'Prospects', icon: <Users size={12} /> },
    { key: 'emails', label: 'Email Log', icon: <Mail size={12} /> },
    { key: 'actions', label: 'Actions', icon: <Zap size={12} /> },
  ];

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Send size={20} style={{ color: 'var(--text-accent)' }} />
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
            Automation Monitor
          </h1>
          {displayHealth?.enabled ? (
            <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: '#3fb950', background: '#3fb95015' }}>
              <CheckCircle2 size={10} /> Active
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: '#f85149', background: '#f8514915' }}>
              <XCircle size={10} /> Disabled
            </span>
          )}
        </div>
        {isLive && (
          <button
            onClick={() => { fetchHealth(); fetchProspects(); fetchEmails(); }}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors hover:bg-white/5"
            style={{ color: 'var(--text-accent)' }}
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-mono transition-colors"
            style={{
              color: tab === t.key ? 'var(--text-active)' : 'var(--text-secondary)',
              borderBottom: tab === t.key ? '2px solid var(--text-accent)' : '2px solid transparent',
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Dashboard Tab */}
      {tab === 'dashboard' && displayHealth && (
        <div className="space-y-4">
          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { icon: <Users size={14} />, label: 'Prospects', value: displayHealth.total_prospects },
              { icon: <Send size={14} />, label: 'In Outreach', value: (displayHealth.by_status.outreach_1 || 0) + (displayHealth.by_status.outreach_2 || 0) + (displayHealth.by_status.outreach_3 || 0) },
              { icon: <CheckCircle2 size={14} />, label: 'Converted', value: displayHealth.by_status.converted || 0 },
              { icon: <Clock size={14} />, label: 'Pending Follow-ups', value: displayHealth.pending_followups },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-md p-3 border text-center"
                style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
              >
                <div className="flex justify-center mb-1" style={{ color: 'var(--text-accent)' }}>{stat.icon}</div>
                <div className="text-lg font-bold font-mono" style={{ color: 'var(--text-active)' }}>{stat.value}</div>
                <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{stat.label}</div>
              </div>
            ))}
          </div>

          {/* Pipeline Breakdown */}
          <div className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-active)' }}>Pipeline</h3>
            <div className="space-y-2">
              {Object.entries(displayHealth.by_status).map(([status, count]) => {
                const colors = STATUS_COLORS[status] || { bg: '#8b949e15', text: '#8b949e' };
                return (
                  <div key={status} className="flex items-center justify-between">
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded" style={{ background: colors.bg, color: colors.text }}>
                      {status}
                    </span>
                    <span className="text-sm font-mono font-bold" style={{ color: 'var(--text-active)' }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Templates Available */}
          <div className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-active)' }}>Templates</h3>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Outreach', count: displayHealth.templates.outreach.length, icon: <Send size={12} /> },
                { label: 'Welcome', count: displayHealth.templates.welcome.length, icon: <UserPlus size={12} /> },
                { label: 'Follow-up', count: displayHealth.templates.followup.length, icon: <Calendar size={12} /> },
              ].map((t) => (
                <div key={t.label} className="text-center">
                  <div className="flex justify-center mb-1" style={{ color: 'var(--text-accent)' }}>{t.icon}</div>
                  <div className="text-sm font-bold font-mono" style={{ color: 'var(--text-active)' }}>{t.count}</div>
                  <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{t.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Gateway Link */}
          <a
            href={`${RAILWAY_URL}/health`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-mono hover:underline"
            style={{ color: 'var(--text-accent)' }}
          >
            {RAILWAY_URL} <ArrowUpRight size={10} />
          </a>
        </div>
      )}

      {/* Prospects Tab */}
      {tab === 'prospects' && (
        <div className="space-y-2">
          {displayProspects.length === 0 ? (
            <div className="text-center py-8 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              No prospects yet. Add prospects via the Actions tab or API.
            </div>
          ) : (
            displayProspects.map((p) => {
              const colors = STATUS_COLORS[p.status] || { bg: '#8b949e15', text: '#8b949e' };
              return (
                <div
                  key={p.email}
                  className="rounded-md p-3 border"
                  style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{p.name}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: colors.bg, color: colors.text }}>
                      {p.status}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {p.email} · {p.persona || 'No persona'} · via {p.source || 'unknown'}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    <span>Step {p.outreach_step}/3</span>
                    {p.last_contacted && <span>Last: {new Date(p.last_contacted).toLocaleDateString()}</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Email Log Tab */}
      {tab === 'emails' && (
        <div className="space-y-2">
          {displayEmails.length === 0 ? (
            <div className="text-center py-8 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              No emails sent yet.
            </div>
          ) : (
            displayEmails.slice().reverse().map((e, i) => (
              <div
                key={i}
                className="rounded-md p-3 border"
                style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-mono font-semibold" style={{ color: 'var(--text-active)' }}>
                    {e.subject}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{
                    background: e.status === 'sent' ? '#3fb95015' : e.status === 'logged_only' ? '#d2992215' : '#f8514915',
                    color: e.status === 'sent' ? '#3fb950' : e.status === 'logged_only' ? '#d29922' : '#f85149',
                  }}>
                    {e.status}
                  </span>
                </div>
                <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                  To: {e.to} · {new Date(e.timestamp).toLocaleString()}
                  {e.resend_id && ` · ID: ${e.resend_id}`}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Actions Tab */}
      {tab === 'actions' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Run All Outreach', desc: 'Send next outreach step to all eligible prospects', endpoint: '/v1/admin/automation/outreach/run', icon: <Send size={14} /> },
              { label: 'Run Follow-ups', desc: 'Send all due follow-up emails', endpoint: '/v1/admin/automation/followups/run', icon: <Calendar size={14} /> },
            ].map((action) => (
              <button
                key={action.label}
                onClick={() => isLive && runAction(action.endpoint, action.label)}
                disabled={!isLive}
                className="rounded-md p-4 border text-left transition-colors hover:bg-white/5 disabled:opacity-50"
                style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span style={{ color: 'var(--text-accent)' }}>{action.icon}</span>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{action.label}</span>
                </div>
                <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{action.desc}</div>
              </button>
            ))}
          </div>

          {/* API Reference */}
          <div className="rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-active)' }}>API Endpoints</h3>
            <div className="space-y-1">
              {[
                { method: 'GET', path: '/v1/admin/automation/health', desc: 'Automation status' },
                { method: 'POST', path: '/v1/admin/automation/prospects', desc: 'Add prospect' },
                { method: 'GET', path: '/v1/admin/automation/prospects', desc: 'List prospects' },
                { method: 'POST', path: '/v1/admin/automation/outreach/run', desc: 'Run all outreach' },
                { method: 'POST', path: '/v1/admin/automation/followups/run', desc: 'Run follow-ups' },
                { method: 'POST', path: '/v1/admin/automation/onboard', desc: 'Manual onboard' },
                { method: 'GET', path: '/v1/admin/automation/emails', desc: 'Email audit log' },
              ].map((ep) => (
                <div key={ep.path} className="flex items-center gap-2 text-[11px] font-mono">
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{
                    background: ep.method === 'POST' ? '#d2992215' : '#3fb95015',
                    color: ep.method === 'POST' ? '#d29922' : '#3fb950',
                  }}>
                    {ep.method}
                  </span>
                  <span style={{ color: 'var(--text-active)' }}>{ep.path}</span>
                  <span style={{ color: 'var(--text-secondary)' }}>— {ep.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {actionResult && (
            <div className="p-3 rounded-md border text-[11px] font-mono" style={{ background: '#58a6ff15', borderColor: '#58a6ff30', color: '#58a6ff' }}>
              {actionResult}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-4 p-3 rounded-md border text-[11px] font-mono flex items-center gap-2" style={{ background: '#f8514915', borderColor: '#f8514930', color: '#f85149' }}>
          <AlertCircle size={12} /> Gateway error: {error}
        </div>
      )}
    </div>
  );
}
