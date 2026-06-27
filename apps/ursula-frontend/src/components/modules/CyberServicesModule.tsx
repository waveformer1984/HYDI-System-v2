/**
 * CyberServicesModule — Main FastAPI Backend Status
 *
 * Shows the local HYDI Cyber Services API status — endpoints,
 * health checks, webhook listeners, and service metrics.
 *
 * TEST mode: Shows mock API status.
 * LIVE mode: Pings localhost:8002 for real health data.
 *
 * Config: Set NEXT_PUBLIC_COORDINATOR_URL for live data.
 * Error handling: Shows offline state when API unreachable.
 */
'use client';

import { useState, useEffect } from 'react';
import {
  Shield,
  Activity,
  Server,
  Wifi,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Terminal,
  Globe,
  Zap,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

interface EndpointStatus {
  path: string;
  method: string;
  label: string;
  status: 'ok' | 'error' | 'unknown';
}

const MOCK_ENDPOINTS: EndpointStatus[] = [
  { path: '/health', method: 'GET', label: 'Health Check', status: 'ok' },
  { path: '/payments/stripe/health', method: 'GET', label: 'Stripe Health', status: 'ok' },
  { path: '/payments/paypal/health', method: 'GET', label: 'PayPal Health', status: 'ok' },
  { path: '/payments/square/health', method: 'GET', label: 'Square Health', status: 'ok' },
  { path: '/webhooks/stripe', method: 'POST', label: 'Stripe Webhooks', status: 'ok' },
  { path: '/nodes', method: 'GET', label: 'Node Registry', status: 'ok' },
  { path: '/checkout/status', method: 'GET', label: 'Checkout Status', status: 'ok' },
];

export default function CyberServicesModule() {
  const { isLive } = useMode();
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [latency, setLatency] = useState<number | null>(null);

  const apiUrl = process.env.NEXT_PUBLIC_COORDINATOR_URL || 'http://localhost:8002';

  const checkHealth = async () => {
    setLoading(true);
    const start = Date.now();
    try {
      const res = await fetch(`${apiUrl}/health`, { mode: 'no-cors' });
      setLatency(Date.now() - start);
      setApiOnline(true);
    } catch {
      setLatency(Date.now() - start);
      setApiOnline(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isLive) checkHealth();
  }, [isLive]);

  const endpoints = MOCK_ENDPOINTS;

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Shield size={20} style={{ color: '#3fb950' }} />
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
            Cyber Services API
          </h1>
          {isLive && apiOnline !== null && (
            <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{
              color: apiOnline ? '#3fb950' : '#f85149',
              background: apiOnline ? '#3fb95015' : '#f8514915',
            }}>
              {apiOnline ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
              {apiOnline ? 'Online' : 'Offline'}
              {latency !== null && ` (${latency}ms)`}
            </span>
          )}
        </div>
        {isLive && (
          <button
            onClick={checkHealth}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono hover:bg-white/5"
            style={{ color: 'var(--text-accent)' }}
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Ping
          </button>
        )}
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Main FastAPI backend — payment processing, webhook handling, node coordination, and system health.
      </p>

      {/* Server Info */}
      <div className="rounded-md p-4 border mb-6" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
        <div className="grid grid-cols-3 gap-4">
          {[
            { icon: <Server size={14} />, label: 'Host', value: 'localhost:8002' },
            { icon: <Zap size={14} />, label: 'Runtime', value: 'FastAPI / Uvicorn' },
            { icon: <Globe size={14} />, label: 'Public Relay', value: 'Vercel (webhook)' },
          ].map(s => (
            <div key={s.label}>
              <div className="flex items-center gap-1 mb-1" style={{ color: 'var(--text-accent)' }}>
                {s.icon}
                <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>{s.label}</span>
              </div>
              <div className="text-sm font-mono" style={{ color: 'var(--text-active)' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Service Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { icon: <Activity size={14} />, label: 'Endpoints', value: endpoints.length, color: '#58a6ff' },
          { icon: <CheckCircle2 size={14} />, label: 'Healthy', value: endpoints.filter(e => e.status === 'ok').length, color: '#3fb950' },
          { icon: <Wifi size={14} />, label: 'Webhooks', value: '3 active', color: '#bc8cff' },
          { icon: <Terminal size={14} />, label: 'Poller', value: 'Running', color: '#d29922' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <div className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Endpoint Table */}
      <h2 className="text-sm font-bold mb-3" style={{ color: 'var(--text-active)' }}>Registered Endpoints</h2>
      <div className="space-y-1">
        {endpoints.map(ep => (
          <div key={ep.path} className="flex items-center justify-between p-2 rounded-md" style={{ background: 'var(--bg-sidebar)' }}>
            <div className="flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold font-mono" style={{
                background: ep.method === 'POST' ? '#d2992215' : '#3fb95015',
                color: ep.method === 'POST' ? '#d29922' : '#3fb950',
              }}>
                {ep.method}
              </span>
              <span className="text-[11px] font-mono" style={{ color: 'var(--text-active)' }}>{ep.path}</span>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>— {ep.label}</span>
            </div>
            <span className="flex items-center gap-1 text-[10px] font-mono" style={{
              color: ep.status === 'ok' ? '#3fb950' : '#f85149',
            }}>
              {ep.status === 'ok' ? <CheckCircle2 size={9} /> : <XCircle size={9} />}
              {ep.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
