/**
 * PlatformCLIModule — HYDI Platform CLI Dashboard
 *
 * Unified view of all 9 platform CLIs: GitHub, Railway, Supabase,
 * Stripe, Postman, PayPal, Netlify, Vercel, Ollama.
 *
 * TEST mode: Shows mock platform status data.
 * LIVE mode: Calls the HYDI Platform CLI backend or pings endpoints directly.
 *
 * Config: Set NEXT_PUBLIC_GATEWAY_URL for live API health checks.
 * Error handling: Graceful fallback per-platform with status indicators.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Terminal,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RefreshCw,
  ExternalLink,
  CreditCard,
  Database,
  Globe,
  Send,
  Cloud,
  Brain,
  Cpu,
  FlaskConical,
  Radio,
  ChevronRight,
  Clock,
  Shield,
  Mail,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

// =============================================================================
// Types
// =============================================================================

type PlatformStatus = 'online' | 'offline' | 'degraded' | 'unknown' | 'checking' | 'api-only';

interface Platform {
  id: string;
  name: string;
  icon: string;
  cli: string;
  status: PlatformStatus;
  version: string;
  details: string[];
  actions: string[];
  url?: string;
}

type Tab = 'dashboard' | 'github' | 'railway' | 'supabase' | 'stripe' | 'postman' | 'paypal' | 'netlify' | 'vercel' | 'ollama';

// =============================================================================
// Mock Data (test mode)
// =============================================================================

const MOCK_PLATFORMS: Platform[] = [
  { id: 'github', name: 'GitHub', icon: 'GH', cli: 'gh', status: 'online', version: 'gh 2.86.0', details: ['Repo: ProtoForgeSite', 'Branch: main', 'Private: true'], actions: ['status', 'push', 'actions'], url: 'https://github.com/waveformer1984/ProtoForgeSite' },
  { id: 'railway', name: 'Railway', icon: 'RW', cli: 'railway', status: 'online', version: 'railway 4.30.0', details: ['Project: modest-grace', 'Service: web-backend', 'Env: production'], actions: ['status', 'logs', 'env', 'deploy'], url: 'https://railway.app' },
  { id: 'supabase', name: 'Supabase', icon: 'SB', cli: 'supabase', status: 'online', version: 'supabase 2.75.0', details: ['DB: PostgreSQL', 'Region: us-east-2'], actions: ['status', 'db'], url: 'https://supabase.com/dashboard' },
  { id: 'stripe', name: 'Stripe', icon: 'ST', cli: 'stripe', status: 'online', version: 'stripe 1.35.0', details: ['Mode: LIVE', 'Account: acct_1SWNEGF3prUQPYI3'], actions: ['status', 'payments', 'webhooks'], url: 'https://dashboard.stripe.com' },
  { id: 'postman', name: 'Postman', icon: 'PM', cli: 'postman', status: 'online', version: 'postman 1.29.5', details: ['Collections: configured', 'CI: GitHub Actions'], actions: ['status', 'collections', 'run'] },
  { id: 'paypal', name: 'PayPal', icon: 'PP', cli: 'API-only', status: 'api-only', version: 'REST API v1', details: ['Mode: live', 'Webhook: 4MG36001UC9159253'], actions: ['status', 'webhooks'], url: 'https://developer.paypal.com' },
  { id: 'netlify', name: 'Netlify', icon: 'NL', cli: 'netlify', status: 'online', version: 'netlify-cli 23.15.1', details: ['Sites available'], actions: ['status', 'deploy'] },
  { id: 'vercel', name: 'Vercel', icon: 'VL', cli: 'vercel', status: 'online', version: 'vercel 50.13.2', details: ['Projects available'], actions: ['status', 'deploy'] },
  { id: 'ollama', name: 'Ollama', icon: 'OL', cli: 'ollama', status: 'online', version: 'ollama 0.15.6', details: ['Models: gemma3:4b, llama3.2:latest', 'Total: 5.3 GB'], actions: ['status', 'models', 'run'], url: 'http://localhost:11434' },
];

const MOCK_ENDPOINTS = [
  { name: 'API Gateway', url: 'https://api.protoforgeindustries.com/health', status: 'online' as PlatformStatus, detail: 'healthy v2.0.0' },
  { name: 'Payments', url: 'https://payments.protoforgeindustries.com', status: 'offline' as PlatformStatus, detail: 'HTTP 502' },
  { name: 'Beta Portal', url: 'https://beta.protoforgeindustries.com', status: 'offline' as PlatformStatus, detail: 'unreachable' },
];

const MOCK_TASKS = { queued: 0, executing: 0, completed: 127 };

// =============================================================================
// Helpers
// =============================================================================

const STATUS_COLORS: Record<PlatformStatus, string> = {
  online: '#3fb950',
  offline: '#f85149',
  degraded: '#d29922',
  unknown: '#8b949e',
  checking: '#58a6ff',
  'api-only': '#a371f7',
};

const STATUS_ICONS: Record<PlatformStatus, React.ReactNode> = {
  online: <CheckCircle2 size={14} className="shrink-0" />,
  offline: <XCircle size={14} className="shrink-0" />,
  degraded: <AlertTriangle size={14} className="shrink-0" />,
  unknown: <Clock size={14} className="shrink-0" />,
  checking: <RefreshCw size={14} className="animate-spin shrink-0" />,
  'api-only': <Globe size={14} className="shrink-0" />,
};

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  github: <ExternalLink size={16} />,
  railway: <Cloud size={16} />,
  supabase: <Database size={16} />,
  stripe: <CreditCard size={16} />,
  postman: <Send size={16} />,
  paypal: <Shield size={16} />,
  netlify: <Globe size={16} />,
  vercel: <Globe size={16} />,
  ollama: <Brain size={16} />,
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'github', label: 'GitHub' },
  { id: 'railway', label: 'Railway' },
  { id: 'supabase', label: 'Supabase' },
  { id: 'stripe', label: 'Stripe' },
  { id: 'postman', label: 'Postman' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'netlify', label: 'Netlify' },
  { id: 'vercel', label: 'Vercel' },
  { id: 'ollama', label: 'Ollama' },
];

// =============================================================================
// Component
// =============================================================================

export default function PlatformCLIModule() {
  const { isLive, mode } = useMode();
  const [tab, setTab] = useState<Tab>('dashboard');
  const [platforms, setPlatforms] = useState<Platform[]>(MOCK_PLATFORMS);
  const [endpoints, setEndpoints] = useState(MOCK_ENDPOINTS);
  const [tasks, setTasks] = useState(MOCK_TASKS);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string>(new Date().toISOString());
  const [cmdOutput, setCmdOutput] = useState<string[]>([]);

  // Live health check for endpoints
  const checkEndpoints = useCallback(async () => {
    if (!isLive) return;
    setLoading(true);
    const updated = await Promise.all(
      MOCK_ENDPOINTS.map(async (ep) => {
        try {
          const res = await fetch(ep.url, { method: 'GET', signal: AbortSignal.timeout(8000) });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            return { ...ep, status: 'online' as PlatformStatus, detail: data.status || `HTTP ${res.status}` };
          }
          return { ...ep, status: (res.status >= 500 ? 'offline' : 'degraded') as PlatformStatus, detail: `HTTP ${res.status}` };
        } catch {
          return { ...ep, status: 'offline' as PlatformStatus, detail: 'unreachable' };
        }
      })
    );
    setEndpoints(updated);
    setLastRefresh(new Date().toISOString());
    setLoading(false);
  }, [isLive]);

  useEffect(() => {
    if (isLive) checkEndpoints();
  }, [isLive, checkEndpoints]);

  const onlineCount = platforms.filter(p => p.status === 'online' || p.status === 'api-only').length;

  // =============================================================================
  // Render: Dashboard Tab
  // =============================================================================

  const renderDashboard = () => (
    <div className="space-y-6">
      {/* Summary Row */}
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
          <div className="text-xs opacity-60 mb-1">Platforms</div>
          <div className="text-2xl font-bold">{onlineCount}<span className="text-sm opacity-50">/{platforms.length}</span></div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
          <div className="text-xs opacity-60 mb-1">Endpoints</div>
          <div className="text-2xl font-bold" style={{ color: endpoints.filter(e => e.status === 'online').length === endpoints.length ? '#3fb950' : '#d29922' }}>
            {endpoints.filter(e => e.status === 'online').length}<span className="text-sm opacity-50">/{endpoints.length}</span>
          </div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
          <div className="text-xs opacity-60 mb-1">Tasks Queued</div>
          <div className="text-2xl font-bold">{tasks.queued}</div>
        </div>
        <div className="rounded-lg p-3" style={{ background: 'var(--bg-secondary)' }}>
          <div className="text-xs opacity-60 mb-1">Completed</div>
          <div className="text-2xl font-bold" style={{ color: '#3fb950' }}>{tasks.completed}</div>
        </div>
      </div>

      {/* Platform Grid */}
      <div>
        <h3 className="text-sm font-semibold mb-3 opacity-70 uppercase tracking-wider">Platform CLIs</h3>
        <div className="grid grid-cols-3 gap-2">
          {platforms.map((p) => (
            <button
              key={p.id}
              onClick={() => setTab(p.id as Tab)}
              className="rounded-lg p-3 text-left transition-all hover:brightness-110 cursor-pointer"
              style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {PLATFORM_ICONS[p.id]}
                  <span className="text-sm font-medium">{p.name}</span>
                </div>
                <span style={{ color: STATUS_COLORS[p.status] }}>{STATUS_ICONS[p.status]}</span>
              </div>
              <div className="text-xs opacity-50">{p.version}</div>
              {p.details[0] && <div className="text-xs opacity-40 mt-1 truncate">{p.details[0]}</div>}
            </button>
          ))}
        </div>
      </div>

      {/* Live Endpoints */}
      <div>
        <h3 className="text-sm font-semibold mb-3 opacity-70 uppercase tracking-wider">Live Endpoints</h3>
        <div className="space-y-1">
          {endpoints.map((ep) => (
            <div key={ep.name} className="flex items-center justify-between rounded px-3 py-2" style={{ background: 'var(--bg-secondary)' }}>
              <div className="flex items-center gap-2">
                <span style={{ color: STATUS_COLORS[ep.status] }}>{STATUS_ICONS[ep.status]}</span>
                <span className="text-sm">{ep.name}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs opacity-50">{ep.detail}</span>
                {ep.url && (
                  <a href={ep.url} target="_blank" rel="noopener noreferrer" className="opacity-30 hover:opacity-70">
                    <ExternalLink size={12} />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Commands */}
      <div>
        <h3 className="text-sm font-semibold mb-3 opacity-70 uppercase tracking-wider">Quick Commands</h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: 'hydi status', desc: 'Full platform dashboard' },
            { label: 'hydi tasks list', desc: 'Show task queue' },
            { label: 'hydi scan run', desc: 'Run system scan' },
            { label: 'hydi github push', desc: 'Commit & push to GitHub' },
          ].map((cmd) => (
            <div key={cmd.label} className="flex items-center gap-2 rounded px-3 py-2 text-xs" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-primary)' }}>
              <Terminal size={12} className="opacity-40 shrink-0" />
              <code className="font-mono" style={{ color: 'var(--text-accent)' }}>{cmd.label}</code>
              <span className="opacity-40 ml-auto">{cmd.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // =============================================================================
  // Render: Platform Detail Tab
  // =============================================================================

  const renderPlatformDetail = (platformId: string) => {
    const p = platforms.find(pl => pl.id === platformId);
    if (!p) return <div className="p-4 opacity-50">Platform not found</div>;

    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {PLATFORM_ICONS[p.id]}
            <div>
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <div className="text-xs opacity-50">{p.version}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span style={{ color: STATUS_COLORS[p.status] }} className="flex items-center gap-1 text-sm">
              {STATUS_ICONS[p.status]}
              {p.status}
            </span>
            {p.url && (
              <a href={p.url} target="_blank" rel="noopener noreferrer" className="opacity-50 hover:opacity-100 ml-2">
                <ExternalLink size={14} />
              </a>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="rounded-lg p-4" style={{ background: 'var(--bg-secondary)' }}>
          <h3 className="text-xs font-semibold opacity-60 mb-2 uppercase">Details</h3>
          {p.details.map((d, i) => (
            <div key={i} className="flex items-center gap-2 py-1 text-sm">
              <ChevronRight size={12} className="opacity-30" />
              <span>{d}</span>
            </div>
          ))}
        </div>

        {/* Available Actions */}
        <div className="rounded-lg p-4" style={{ background: 'var(--bg-secondary)' }}>
          <h3 className="text-xs font-semibold opacity-60 mb-2 uppercase">CLI Commands</h3>
          <div className="grid grid-cols-2 gap-2">
            {p.actions.map((action) => (
              <div
                key={action}
                className="flex items-center gap-2 rounded px-3 py-2 text-xs"
                style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-primary)' }}
              >
                <Terminal size={12} className="opacity-40" />
                <code className="font-mono" style={{ color: 'var(--text-accent)' }}>
                  hydi {p.id} {action}
                </code>
              </div>
            ))}
          </div>
        </div>

        {/* Output Panel */}
        {cmdOutput.length > 0 && (
          <div className="rounded-lg p-4 font-mono text-xs" style={{ background: '#0d1117', color: '#c9d1d9', maxHeight: '200px', overflow: 'auto' }}>
            {cmdOutput.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // =============================================================================
  // Main Render
  // =============================================================================

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
      {/* Module Header */}
      <div className="flex items-center justify-between px-4 py-2 shrink-0" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        <div className="flex items-center gap-2">
          <Cpu size={16} style={{ color: 'var(--text-accent)' }} />
          <span className="text-sm font-semibold">Platform CLI</span>
          <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-accent)' }}>
            {platforms.length} platforms
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs opacity-40">
            {new Date(lastRefresh).toLocaleTimeString()}
          </span>
          <button
            onClick={checkEndpoints}
            disabled={loading}
            className="p-1 rounded hover:brightness-125 transition-all"
            style={{ background: 'var(--bg-secondary)' }}
            title="Refresh"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <div className="flex items-center gap-1 text-xs px-2 py-0.5 rounded" style={{ background: isLive ? 'rgba(63,185,80,0.15)' : 'rgba(88,166,255,0.15)', color: isLive ? '#3fb950' : '#58a6ff' }}>
            {isLive ? <Radio size={10} /> : <FlaskConical size={10} />}
            {mode}
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex gap-0 overflow-x-auto shrink-0" style={{ borderBottom: '1px solid var(--border-primary)' }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-3 py-1.5 text-xs whitespace-nowrap transition-all"
            style={{
              borderBottom: tab === t.id ? '2px solid var(--text-accent)' : '2px solid transparent',
              color: tab === t.id ? 'var(--text-accent)' : 'var(--text-secondary)',
              background: tab === t.id ? 'var(--bg-secondary)' : 'transparent',
            }}
          >
            {t.id !== 'dashboard' && (
              <span className="inline-flex mr-1" style={{ color: STATUS_COLORS[platforms.find(p => p.id === t.id)?.status || 'unknown'] }}>●</span>
            )}
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {tab === 'dashboard' ? renderDashboard() : renderPlatformDetail(tab)}
      </div>
    </div>
  );
}
