import { useState, useEffect } from 'react';
import Head from 'next/head';

/**
 * HEIDI Operational Console
 *
 * This is the owner control surface — not a marketing dashboard.
 * It shows the real operational state of HEIDI and allows the owner
 * to approve/deny authorization requests.
 */

interface HeidiStatus {
  heidi: string;
  autonomy: string;
  cycle: number;
  lastCycle: string | null;
  lastDecision: string | null;
  lastVerification: string | null;
  daemon: { online: boolean; pid?: number; startedAt?: string };
  capabilities: Record<string, string>;
  capabilitySummary: { total: number; ready: number; blocked: number; policyBlocked: number; failed: number };
  activeRecovery: any[] | null;
  pendingAuthorization: number;
  pendingRequests: any[];
  persistence: { healthy: boolean; stores: string[] };
  timestamp: string;
}

interface AuthRequest {
  id: string;
  provider: string;
  capabilityId: string;
  requestedCommitments: string[];
  estimatedFinancialExposureCents?: number;
  currency?: string;
  requiresLegalAcceptance: boolean;
  requiresIdentityVerification: boolean;
  reason: string;
  status: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
}

export default function HeidiConsole() {
  const [status, setStatus] = useState<HeidiStatus | null>(null);
  const [authRequests, setAuthRequests] = useState<AuthRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const [statusRes, authRes] = await Promise.all([
          fetch('/api/heidi-status'),
          fetch('/api/authorization?status=pending'),
        ]);
        if (statusRes.ok) {
          const s = await statusRes.json();
          setStatus(s);
        }
        if (authRes.ok) {
          const a = await authRes.json();
          setAuthRequests(a.requests || []);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Fetch failed');
      } finally {
        setLoading(false);
      }
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  const approveRequest = async (id: string) => {
    await fetch(`/api/authorization?action=approve&id=${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decidedBy: 'owner' }),
    });
  };

  const denyRequest = async (id: string) => {
    await fetch(`/api/authorization?action=deny&id=${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decidedBy: 'owner', reason: 'Denied via console' }),
    });
  };

  if (loading) {
    return (
      <div style={{ padding: '40px', fontFamily: 'monospace', fontSize: '14px' }}>
        Loading HEIDI status...
      </div>
    );
  }

  const stateColor = (state: string) => {
    if (state === 'READY') return '#4ade80';
    if (state === 'BLOCKED') return '#fbbf24';
    if (state === 'POLICY_BLOCKED') return '#f87171';
    if (state.includes('FAILED')) return '#ef4444';
    return '#94a3b8';
  };

  return (
    <>
      <Head>
        <title>HEIDI Operational Console</title>
      </Head>
      <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '13px', maxWidth: '1200px', margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h1 style={{ margin: 0, fontSize: '20px' }}>HEIDI Operational Console</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: '12px', height: '12px', borderRadius: '50%',
              backgroundColor: status?.heidi === 'ONLINE' ? '#4ade80' : '#ef4444',
            }} />
            <span style={{ fontWeight: 'bold' }}>{status?.heidi || 'UNKNOWN'}</span>
          </div>
        </div>

        {error && (
          <div style={{ padding: '10px', backgroundColor: '#fef2f2', border: '1px solid #ef4444', borderRadius: '4px', marginBottom: '16px' }}>
            Error: {error}
          </div>
        )}

        {/* Daemon Status */}
        <Section title="Daemon">
          <Row label="Status" value={status?.daemon?.online ? 'HEALTHY' : 'NOT RUNNING'} color={status?.daemon?.online ? '#4ade80' : '#ef4444'} />
          <Row label="PID" value={status?.daemon?.pid?.toString() || '—'} />
          <Row label="Started" value={status?.daemon?.startedAt || '—'} />
          <Row label="Cycle" value={status?.cycle?.toString() || '0'} />
          <Row label="Last Cycle" value={status?.lastCycle || '—'} />
          <Row label="Autonomy" value={status?.autonomy || 'INACTIVE'} />
        </Section>

        {/* Capabilities */}
        <Section title={`Capabilities (${status?.capabilitySummary.ready || 0}/${status?.capabilitySummary.total || 0} ready)`}>
          {status && Object.entries(status.capabilities).map(([provider, state]) => (
            <Row key={provider} label={provider} value={state} color={stateColor(state)} />
          ))}
        </Section>

        {/* Pending Authorizations */}
        <Section title={`Pending Authorizations (${authRequests.length})`}>
          {authRequests.length === 0 ? (
            <div style={{ color: '#94a3b8', padding: '8px' }}>No pending authorization requests</div>
          ) : (
            authRequests.map((req) => (
              <div key={req.id} style={{ padding: '12px', border: '1px solid #e2e8f0', borderRadius: '4px', marginBottom: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong>{req.provider}</strong>
                  <span style={{ color: '#fbbf24' }}>PENDING</span>
                </div>
                <div style={{ color: '#64748b', marginBottom: '4px' }}>{req.reason}</div>
                <div style={{ color: '#64748b', marginBottom: '4px', fontSize: '11px' }}>
                  Commitments: {req.requestedCommitments.join(', ')}
                </div>
                {req.requiresLegalAcceptance && <div style={{ color: '#f87171', fontSize: '11px' }}>Requires legal acceptance</div>}
                {req.requiresIdentityVerification && <div style={{ color: '#f87171', fontSize: '11px' }}>Requires identity verification</div>}
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button
                    onClick={() => approveRequest(req.id)}
                    style={{ padding: '4px 12px', backgroundColor: '#4ade80', border: 'none', borderRadius: '3px', cursor: 'pointer', fontFamily: 'monospace' }}
                  >Approve</button>
                  <button
                    onClick={() => denyRequest(req.id)}
                    style={{ padding: '4px 12px', backgroundColor: '#f87171', border: 'none', borderRadius: '3px', cursor: 'pointer', fontFamily: 'monospace' }}
                  >Deny</button>
                </div>
              </div>
            ))
          )}
        </Section>

        {/* Active Recovery */}
        <Section title="Active Recovery">
          {status?.activeRecovery ? (
            status.activeRecovery.map((r: any, i: number) => (
              <div key={i} style={{ padding: '8px', border: '1px solid #e2e8f0', borderRadius: '4px', marginBottom: '4px' }}>
                <strong>{r.capabilityId}</strong> — {r.state} (retry: {r.retryCount})
                {r.lastError && <div style={{ color: '#ef4444', fontSize: '11px' }}>{r.lastError}</div>}
              </div>
            ))
          ) : (
            <div style={{ color: '#94a3b8', padding: '8px' }}>No active recovery operations</div>
          )}
        </Section>

        {/* Recent Decisions */}
        <Section title="Recent Activity">
          <Row label="Last Decision" value={status?.lastDecision || '—'} />
          <Row label="Last Verification" value={status?.lastVerification || '—'} />
        </Section>

        {/* Persistence */}
        <Section title="Persistence">
          <Row label="State" value={status?.persistence?.healthy ? 'HEALTHY' : 'DEGRADED'} color={status?.persistence?.healthy ? '#4ade80' : '#fbbf24'} />
          <Row label="Stores" value={status?.persistence?.stores?.join(', ') || '—'} />
        </Section>

        <div style={{ marginTop: '20px', color: '#94a3b8', fontSize: '11px' }}>
          Last updated: {status?.timestamp || '—'} · Auto-refresh every 5s
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '20px' }}>
      <h2 style={{ fontSize: '14px', margin: '0 0 8px 0', borderBottom: '1px solid #e2e8f0', paddingBottom: '4px' }}>{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ color: color || '#1e293b', fontWeight: color ? 'bold' : 'normal' }}>{value}</span>
    </div>
  );
}
