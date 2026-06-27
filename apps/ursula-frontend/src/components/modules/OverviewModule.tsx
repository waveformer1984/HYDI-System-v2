/**
 * OverviewModule — ProtoForge system overview
 * 
 * Central dashboard showing service status cards, revenue summary,
 * and quick-access links to all ProtoForge subsystems.
 * 
 * TEST mode: Shows static mock status for all services.
 * LIVE mode: Pings real service URLs and shows actual health.
 * 
 * Error handling: Gracefully shows "No data" states for unavailable services.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  CreditCard,
  Bot,
  Globe,
  Server,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ArrowUpRight,
  Zap,
  RefreshCw,
  FlaskConical,
  Radio,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';
import { pingService } from '@/lib/api';

type ServiceStatus = 'online' | 'degraded' | 'offline' | 'unknown' | 'checking';

interface ServiceCard {
  id: string;
  name: string;
  mockStatus: ServiceStatus;
  url?: string;
  healthUrl?: string;
  description: string;
  icon: React.ReactNode;
}

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://payment-api-six-nu.vercel.app';
const RELAY_URL = 'https://hydi-webhook-relay.vercel.app';

const SERVICES: ServiceCard[] = [
  {
    id: 'gateway',
    name: 'Payment API',
    mockStatus: 'online',
    url: GATEWAY_URL,
    healthUrl: `${GATEWAY_URL}/api/health`,
    description: 'Stripe + PayPal checkout, live mode',
    icon: <CreditCard size={18} />,
  },
  {
    id: 'relay',
    name: 'Webhook Relay',
    mockStatus: 'online',
    url: RELAY_URL,
    healthUrl: `${RELAY_URL}/api/health`,
    description: 'PayPal & Square webhook relay + poller',
    icon: <Activity size={18} />,
  },
  {
    id: 'agents',
    name: 'Agent Network',
    mockStatus: 'unknown',
    description: 'DevOps, Funding, Ghostwriter agents',
    icon: <Bot size={18} />,
  },
  {
    id: 'sitegrade',
    name: 'SiteGrade AI',
    mockStatus: 'unknown',
    description: 'AI-powered website auditor',
    icon: <Globe size={18} />,
  },
  {
    id: 'supabase',
    name: 'Supabase',
    mockStatus: 'online',
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    healthUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/` : undefined,
    description: 'Database, auth, realtime',
    icon: <Server size={18} />,
  },
];

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  online: { color: '#3fb950', icon: <CheckCircle2 size={14} />, label: 'Online' },
  degraded: { color: '#d29922', icon: <AlertTriangle size={14} />, label: 'Degraded' },
  offline: { color: '#f85149', icon: <XCircle size={14} />, label: 'Offline' },
  unknown: { color: '#858585', icon: <Activity size={14} />, label: 'Unknown' },
  checking: { color: '#58a6ff', icon: <RefreshCw size={14} className="animate-spin" />, label: 'Checking...' },
};

export default function OverviewModule() {
  const { isLive, isTest } = useMode();
  const [liveStatuses, setLiveStatuses] = useState<Record<string, { status: ServiceStatus; ms?: number }>>({});
  const [lastCheck, setLastCheck] = useState<Date | null>(null);

  const runHealthChecks = useCallback(async () => {
    // Mark all as checking
    const checking: Record<string, { status: ServiceStatus }> = {};
    SERVICES.forEach(s => { checking[s.id] = { status: 'checking' }; });
    setLiveStatuses(checking);

    // Ping each service that has a healthUrl
    const results: Record<string, { status: ServiceStatus; ms?: number }> = {};
    await Promise.all(
      SERVICES.map(async (svc) => {
        if (svc.healthUrl) {
          const ping = await pingService(svc.healthUrl);
          results[svc.id] = {
            status: ping.ok ? 'online' : 'offline',
            ms: ping.ms,
          };
        } else {
          results[svc.id] = { status: 'unknown' };
        }
      })
    );
    setLiveStatuses(results);
    setLastCheck(new Date());
  }, []);

  useEffect(() => {
    if (isLive) {
      runHealthChecks();
    }
  }, [isLive, runHealthChecks]);

  const getStatus = (svc: ServiceCard): ServiceStatus => {
    if (isTest) return svc.mockStatus;
    return liveStatuses[svc.id]?.status ?? 'unknown';
  };

  const getLatency = (svc: ServiceCard): number | undefined => {
    if (isTest) return undefined;
    return liveStatuses[svc.id]?.ms;
  };

  const allStatuses = SERVICES.map(s => getStatus(s));
  const onlineCount = allStatuses.filter(s => s === 'online').length;

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Zap size={20} style={{ color: 'var(--text-accent)' }} />
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-active)' }}>
              ProtoForge Command Center
            </h1>
          </div>
          {/* Mode Badge */}
          <div className="flex items-center gap-2">
            {isLive && (
              <button
                onClick={runHealthChecks}
                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors hover:bg-white/5"
                style={{ color: 'var(--text-accent)' }}
                title="Re-check all services"
              >
                <RefreshCw size={10} /> Refresh
              </button>
            )}
            <span
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold font-mono uppercase tracking-wider"
              style={{
                background: isLive ? '#3fb95020' : '#007acc20',
                color: isLive ? '#3fb950' : '#007acc',
              }}
            >
              {isLive ? <><Radio size={10} /> Live Data</> : <><FlaskConical size={10} /> Test Data</>}
            </span>
          </div>
        </div>
        <p className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
          {isLive
            ? `Ursula — Live Mode // Pinging real services${lastCheck ? ` // Last check: ${lastCheck.toLocaleTimeString()}` : ''}`
            : 'Ursula — Test Mode // Mock data active'
          }
        </p>
      </div>

      {/* Service Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {SERVICES.map((svc) => {
          const status = getStatus(svc);
          const latency = getLatency(svc);
          const statusCfg = STATUS_CONFIG[status];
          return (
            <div
              key={svc.id}
              className="rounded-md p-4 border transition-colors hover:border-[var(--text-accent)]"
              style={{
                background: 'var(--bg-sidebar)',
                borderColor: 'var(--border-color)',
              }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span style={{ color: 'var(--text-accent)' }}>{svc.icon}</span>
                  <span className="font-semibold text-sm" style={{ color: 'var(--text-active)' }}>
                    {svc.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {latency !== undefined && (
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {latency}ms
                    </span>
                  )}
                  <span
                    className="flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded"
                    style={{ color: statusCfg.color, background: `${statusCfg.color}15` }}
                  >
                    {statusCfg.icon}
                    {statusCfg.label}
                  </span>
                </div>
              </div>
              <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                {svc.description}
              </p>
              {svc.url && (
                <a
                  href={svc.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-mono hover:underline"
                  style={{ color: 'var(--text-accent)' }}
                >
                  {svc.url} <ArrowUpRight size={10} />
                </a>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Services', value: SERVICES.length.toString(), sub: 'registered' },
          { label: 'Online', value: onlineCount.toString(), sub: 'healthy' },
          { label: 'Modules', value: '22', sub: 'loaded' },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-md p-4 border text-center"
            style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
          >
            <div className="text-2xl font-bold font-mono" style={{ color: 'var(--text-active)' }}>
              {stat.value}
            </div>
            <div className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              {stat.label} — {stat.sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
