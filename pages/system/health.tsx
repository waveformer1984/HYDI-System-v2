import React, { useEffect, useState } from 'react';
import type { HealthSnapshot, HealthStatus } from '../../lib/health';

const statusColor: Record<HealthStatus, string> = {
  healthy: 'text-green-600 bg-green-50 border-green-200',
  degraded: 'text-yellow-600 bg-yellow-50 border-yellow-200',
  unavailable: 'text-red-600 bg-red-50 border-red-200',
  unknown: 'text-gray-600 bg-gray-50 border-gray-200',
};

function StatusBadge({ status }: { status: HealthStatus }) {
  return (
    <span className={`px-2 py-1 rounded border text-sm font-medium ${statusColor[status]}`}>
      {status}
    </span>
  );
}

function Section({ title, status, children }: { title: string; status?: HealthStatus; children: React.ReactNode }) {
  return (
    <section className="border rounded-lg p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
        {status && <StatusBadge status={status} />}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between py-1 border-b last:border-0 border-gray-100">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-mono text-gray-900">{value}</span>
    </div>
  );
}

function formatBytes(bytes: number | null | undefined) {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

function formatPercent(value: number | null | undefined) {
  if (value == null) return '—';
  return `${value.toFixed(2)}%`;
}

export default function HealthDashboard() {
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchHealth() {
      try {
        const res = await fetch('/api/system/health');
        const data = (await res.json()) as HealthSnapshot;
        if (!cancelled) {
          setSnapshot(data);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load health');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchHealth();
    const interval = setInterval(fetchHealth, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">Loading health data...</p>
      </div>
    );
  }

  if (error || !snapshot) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-red-600">{error || 'No health data available'}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">HYDI System Health</h1>
            <p className="text-sm text-gray-500">
              Last updated: {new Date(snapshot.timestamp).toLocaleString()}
            </p>
          </div>
          <StatusBadge status={snapshot.status} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Section title="System" status={snapshot.status}>
            <Metric label="CPU usage" value={formatPercent(snapshot.system.cpu.usagePercent)} />
            <Metric label="Cores" value={snapshot.system.cpu.cores} />
            <Metric label="Memory usage" value={formatPercent(snapshot.system.memory.usagePercent)} />
            <Metric label="Memory used" value={formatBytes(snapshot.system.memory.usedBytes)} />
            <Metric label="Memory total" value={formatBytes(snapshot.system.memory.totalBytes)} />
            <Metric label="Uptime" value={`${Math.floor(snapshot.system.uptimeSeconds / 60)}m`} />
            <Metric label="Node" value={snapshot.system.nodeVersion} />
            <Metric label="Git commit" value={snapshot.system.gitCommit} />
            <Metric label="Build" value={snapshot.system.buildVersion} />
            <Metric label="Platform" value={snapshot.system.platform} />
          </Section>

          <Section title="Ollama" status={snapshot.ollama.status}>
            <Metric label="Reachable" value={snapshot.ollama.reachable ? 'Yes' : 'No'} />
            <Metric label="Base URL" value={snapshot.ollama.baseURL} />
            <Metric label="Loaded models" value={snapshot.ollama.loadedModels.length} />
            <Metric label="Model load time" value={snapshot.ollama.modelLoadTimeMs ?? '—'} />
            <Metric label="Avg inference" value={snapshot.ollama.averageInferenceLatencyMs ?? '—'} />
            {snapshot.ollama.error && <p className="text-sm text-red-600 mt-2">{snapshot.ollama.error}</p>}
          </Section>

          <Section title="Database" status={snapshot.database.status}>
            <Metric label="Supabase" value={snapshot.database.supabase.status} />
            <Metric label="DB latency" value={`${snapshot.database.supabase.latencyMs ?? '—'}ms`} />
            <Metric label="Active conversations" value={snapshot.database.activeConversations ?? '—'} />
            <Metric label="Queue depth" value={snapshot.database.queueDepth ?? '—'} />
            <Metric label="Memory engine" value={snapshot.database.memoryEngine.status} />
            <Metric label="Scheduler" value={snapshot.database.scheduler.status} />
            <Metric label="Agent runtime" value={snapshot.database.agentRuntime.status} />
            <Metric label="Revenue engine" value={snapshot.database.revenueEngine.status} />
          </Section>

          <Section title="External" status={snapshot.external.network.status}>
            <Metric label="Network" value={snapshot.external.network.status} />
            <Metric label="Network latency" value={`${snapshot.external.network.latencyMs ?? '—'}ms`} />
            <Metric label="Firebase" value={snapshot.external.firebase.status} />
            <Metric label="Stripe" value={snapshot.external.stripe.status} />
          </Section>

          <Section title="Workers" status={snapshot.workers.status}>
            <Metric label="Total" value={snapshot.workers.total ?? '—'} />
            <Metric label="Healthy" value={snapshot.workers.healthy ?? '—'} />
            <Metric label="Busy" value={snapshot.workers.busy ?? '—'} />
            <Metric label="Errors" value={snapshot.workers.error ?? '—'} />
          </Section>

          <Section title="GPU" status={snapshot.gpu.status}>
            {snapshot.gpu.devices.length === 0 ? (
              <p className="text-sm text-gray-500">No GPU detected</p>
            ) : (
              snapshot.gpu.devices.map((device, i) => (
                <div key={i} className="mb-2">
                  <Metric label="Name" value={device.name} />
                  <Metric label="VRAM" value={formatBytes(device.vramBytes)} />
                  <Metric label="Utilization" value={formatPercent(device.utilizationPercent)} />
                </div>
              ))
            )}
            {snapshot.gpu.error && <p className="text-sm text-red-600 mt-2">{snapshot.gpu.error}</p>}
          </Section>

          <Section title="Disk">
            {snapshot.system.disks.length === 0 ? (
              <p className="text-sm text-gray-500">No disk data</p>
            ) : (
              snapshot.system.disks.map((disk, i) => (
                <div key={i} className="mb-2">
                  <Metric label="Path" value={disk.path} />
                  <Metric label="Usage" value={formatPercent(disk.usagePercent)} />
                  <Metric label="Free" value={formatBytes(disk.freeBytes)} />
                </div>
              ))
            )}
          </Section>
        </div>

        <details className="bg-white rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium text-gray-700">Raw JSON</summary>
          <pre className="mt-3 text-xs overflow-auto bg-gray-900 text-green-400 p-4 rounded">
            {JSON.stringify(snapshot, null, 2)}
          </pre>
        </details>
      </div>
    </div>
  );
}
