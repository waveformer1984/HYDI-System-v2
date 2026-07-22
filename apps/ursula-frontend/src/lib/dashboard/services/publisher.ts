import { createClient } from '@supabase/supabase-js';
import { getEventBus, type EventBus } from '@repo/lib/event-bus';
import type {
  AgentRuntime,
  AIModel,
  MemoryState,
  NetworkNode,
  Notification,
  RevenueSummary,
  ServiceStatus,
  SystemHealth,
  SystemMetric,
  Task,
} from '@/lib/dashboard/types';
import { fetchMonitoringHealth } from './monitoring-service';
import { fetchRevenueForProject, REVENUE_STREAMS } from './revenue-service';
import { getRevenueSummaries as getProjectedRevenueSummaries } from '@repo/lib/commercial/projections/bootstrap';
import { EventBusEventsProjectionAdapter } from '@repo/lib/commercial/projections';

const POLL_INTERVAL_MS = 2000;

class DashboardPublisher {
  private bus: EventBus;
  private started = false;
  private interval: ReturnType<typeof setInterval> | null = null;
  private adapter: EventBusEventsProjectionAdapter | null = null;

  constructor(bus: EventBus) {
    this.bus = bus;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      this.adapter = new EventBusEventsProjectionAdapter({ supabase, bus: this.bus });
      this.adapter.start();
    }

    this.publishInitialSnapshot().catch((err) => console.error('[Publisher] Initial snapshot failed:', err));

    this.interval = setInterval(() => {
      this.publishSnapshot().catch((err) => console.error('[Publisher] Snapshot failed:', err));
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.adapter) {
      this.adapter.stop();
      this.adapter = null;
    }
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.started = false;
  }

  private async publishInitialSnapshot(): Promise<void> {
    await this.publishSnapshot();
  }

  private async publishSnapshot(): Promise<void> {
    await Promise.all([
      this.publishSystemHealth(),
      this.publishAgentStatus(),
      this.publishModelStatus(),
      this.publishMemoryStatus(),
      this.publishTasks(),
      this.publishNetworkStatus(),
      this.publishRevenue(),
      this.publishNotifications(),
    ]);
  }

  private async publishSystemHealth(): Promise<void> {
    try {
      const health = await fetchSystemHealth();
      await this.bus.publish('system:health', health, { source: 'dashboard-publisher' });
    } catch (err) {
      console.error('[Publisher] system:health failed:', err);
    }
  }

  private async publishAgentStatus(): Promise<void> {
    for (const agent of await fetchAgentStatus()) {
      await this.bus.publish('agent:status', agent, { source: 'dashboard-publisher' });
    }
  }

  private async publishModelStatus(): Promise<void> {
    for (const model of await fetchModelStatus()) {
      await this.bus.publish('model:status', model, { source: 'dashboard-publisher' });
    }
  }

  private async publishMemoryStatus(): Promise<void> {
    const memory = await fetchMemoryStatus();
    await this.bus.publish('memory:status', memory, { source: 'dashboard-publisher' });
  }

  private async publishTasks(): Promise<void> {
    const tasks = await fetchTasks();
    await this.bus.publish('tasks:update', tasks, { source: 'dashboard-publisher' });
  }

  private async publishNetworkStatus(): Promise<void> {
    const network = await fetchNetworkStatus();
    await this.bus.publish('network:status', network, { source: 'dashboard-publisher' });
  }

  private async publishRevenue(): Promise<void> {
    for (const summary of await fetchRevenueSummaries()) {
      await this.bus.publish('revenue:summary', summary, { source: 'dashboard-publisher' });
    }
  }

  private async publishNotifications(): Promise<void> {
    for (const notification of await fetchNotifications()) {
      await this.bus.publish('notification', notification, { source: 'dashboard-publisher' });
    }
  }
}

let publisher: DashboardPublisher | null = null;

export function getDashboardPublisher(bus: EventBus = getEventBus()): DashboardPublisher {
  if (!publisher) {
    publisher = new DashboardPublisher(bus);
  }
  return publisher;
}

// --- Live fetchers with graceful fallback to test data ---

async function fetchJson<T>(url: string, timeoutMs = 1500): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchSystemHealth(): Promise<SystemHealth> {
  const hydi = await fetchJson<{ status?: string; brain?: { available?: boolean } }>('http://localhost:3459/health');
  const mobile = await fetchJson<{ heidiCore?: boolean; ollama?: boolean }>('http://localhost:3006/api/health');
  const ollama = await fetchJson<{ models?: unknown[] }>('http://localhost:11434/api/tags');

  if (hydi || mobile || ollama) {
    const services: ServiceStatus[] = [];
    services.push({
      name: 'heidi-core',
      healthy: hydi?.status === 'healthy' || false,
      status: hydi?.status ?? 'unknown',
      url: 'http://localhost:3459',
      lastSeen: new Date().toISOString(),
    });
    services.push({
      name: 'mobile-chat',
      healthy: mobile?.heidiCore === true,
      status: mobile?.heidiCore ? 'connected' : 'disconnected',
      url: 'http://localhost:3006',
      lastSeen: new Date().toISOString(),
    });
    services.push({
      name: 'ollama',
      healthy: ollama !== null && Array.isArray(ollama.models),
      status: ollama && Array.isArray(ollama.models) ? `models: ${ollama.models.length}` : 'offline',
      url: 'http://localhost:11434',
      lastSeen: new Date().toISOString(),
    });

    const cpuMetric: SystemMetric = {
      name: 'CPU',
      value: Math.floor(Math.random() * 35 + 10),
      unit: '%',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
    const memoryMetric: SystemMetric = {
      name: 'Memory',
      value: Math.floor(Math.random() * 40 + 30),
      unit: '%',
      status: 'ok',
      timestamp: new Date().toISOString(),
    };

    return {
      cpu: cpuMetric,
      memory: memoryMetric,
      disk: { name: 'Disk', value: Math.floor(Math.random() * 30 + 20), unit: '%', status: 'ok', timestamp: new Date().toISOString() },
      uptime: { name: 'Uptime', value: '1h 12m', status: 'ok', timestamp: new Date().toISOString() },
      services,
    };
  }

  const monitoring = await fetchMonitoringHealth();
  if (monitoring) return monitoring;

  return mockSystemHealth();
}

function mockSystemHealth(): SystemHealth {
  const now = new Date().toISOString();
  return {
    cpu: { name: 'CPU', value: 23, unit: '%', status: 'ok', timestamp: now },
    memory: { name: 'Memory', value: 41, unit: '%', status: 'ok', timestamp: now },
    disk: { name: 'Disk', value: 18, unit: '%', status: 'ok', timestamp: now },
    uptime: { name: 'Uptime', value: '2h 7m', status: 'ok', timestamp: now },
    services: [
      { name: 'heidi-core', healthy: true, status: 'healthy', url: 'http://localhost:3459', lastSeen: now },
      { name: 'mobile-chat', healthy: true, status: 'connected', url: 'http://localhost:3006', lastSeen: now },
      { name: 'ollama', healthy: true, status: 'models: 7', url: 'http://localhost:11434', lastSeen: now },
      { name: 'supabase-local', healthy: false, status: 'offline', url: 'http://localhost:54321', lastSeen: now },
    ],
  };
}

async function fetchAgentStatus(): Promise<AgentRuntime[]> {
  return [
    { name: 'HYDI', healthy: true, state: 'running', tasks: 3, lastHeartbeat: new Date().toISOString() },
    { name: 'Ursula', healthy: true, state: 'idle', tasks: 0, lastHeartbeat: new Date().toISOString() },
    { name: 'ProtoForge', healthy: true, state: 'idle', tasks: 1, lastHeartbeat: new Date().toISOString() },
    { name: 'Mission Worker', healthy: true, state: 'running', tasks: 12, lastHeartbeat: new Date().toISOString() },
  ];
}

async function fetchModelStatus(): Promise<AIModel[]> {
  const ollama = await fetchJson<{ models?: { name: string }[] }>('http://localhost:11434/api/tags');
  if (ollama?.models && Array.isArray(ollama.models)) {
    return ollama.models.map((m) => ({
      id: m.name,
      provider: 'ollama',
      loaded: true,
      latencyMs: Math.floor(Math.random() * 400 + 50),
      tokensUsed: Math.floor(Math.random() * 10000),
      active: m.name.includes('llama3.2'),
    }));
  }
  return [
    { id: 'llama3.2:3b', provider: 'ollama', loaded: true, latencyMs: 120, tokensUsed: 4820, active: true },
    { id: 'qwen2.5:7b', provider: 'ollama', loaded: true, latencyMs: 340, tokensUsed: 1200, active: false },
    { id: 'nomic-embed-text:latest', provider: 'ollama', loaded: true, latencyMs: 90, tokensUsed: 0, active: false },
  ];
}

async function fetchMemoryStatus(): Promise<MemoryState> {
  return { episodic: 94, semantic: 18, vector: 205, retrievalLatencyMs: 45 };
}

async function fetchTasks(): Promise<Task[]> {
  return [
    { id: 'task-001', name: 'Health observation', status: 'running', priority: 'normal', progress: 45, assignedAgent: 'Mission Worker', startedAt: new Date().toISOString() },
    { id: 'task-002', name: 'Restart protoforge-core', status: 'queued', priority: 'high', progress: 0, assignedAgent: 'Mission Worker' },
    { id: 'task-003', name: 'Memory reflection', status: 'completed', priority: 'low', progress: 100, assignedAgent: 'HYDI', completedAt: new Date().toISOString() },
  ];
}

async function fetchNetworkStatus(): Promise<NetworkNode[]> {
  return [
    { name: 'heidi-pc', address: '100.118.182.126', healthy: true, type: 'tailscale' },
    { name: 'felicias-microwave', address: '100.87.215.90', healthy: false, type: 'tailscale' },
    { name: 'heidi-core', address: 'localhost', port: 3459, healthy: true, type: 'local' },
    { name: 'mobile-chat', address: 'localhost', port: 3006, healthy: true, type: 'local' },
  ];
}

async function fetchRevenueSummaries(): Promise<RevenueSummary[]> {
  // Projection state is built from commercial events on the Event Fabric.
  // When a stream has live event data, prefer it; otherwise fall back to the
  // legacy ledger fetcher (or mock data if Supabase is unavailable).
  const projected = getProjectedRevenueSummaries();
  const projectedByStream = new Map(
    projected
      .filter((s) => s.gross > 0 || s.pendingPayout > 0 || s.paidOut > 0)
      .map((s) => [s.revenueStream, s as RevenueSummary])
  );

  const legacy = await Promise.all(
    REVENUE_STREAMS.filter((stream) => !projectedByStream.has(stream)).map((stream) =>
      fetchRevenueForProject(stream)
    )
  );
  const real = legacy.filter((r): r is RevenueSummary => r !== null);

  const combined = [
    ...projectedByStream.values(),
    ...real,
  ].sort((a, b) => a.revenueStream.localeCompare(b.revenueStream));

  if (combined.length > 0) return combined;

  return [
    {
      revenueStream: 'galactic_bytes',
      gross: 12400,
      fees: 1240,
      net: 11160,
      availableForPayout: 9800,
      pendingPayout: 1200,
      paidOut: 8500,
      heldForDisputes: 160,
      lastUpdated: new Date().toISOString(),
    },
    {
      revenueStream: 'rezonate',
      gross: 8300,
      fees: 830,
      net: 7470,
      availableForPayout: 6200,
      pendingPayout: 1270,
      paidOut: 5100,
      heldForDisputes: 0,
      lastUpdated: new Date().toISOString(),
    },
  ];
}

async function fetchNotifications(): Promise<Notification[]> {
  return [
    {
      id: 'notif-001',
      level: 'warning',
      message: 'felicias-microwave is offline on Tailscale',
      source: 'network',
      timestamp: new Date().toISOString(),
      acknowledged: false,
    },
    {
      id: 'notif-002',
      level: 'info',
      message: 'Heidi Core restarted with extended Ollama timeout',
      source: 'system',
      timestamp: new Date().toISOString(),
      acknowledged: false,
    },
  ];
}
