/**
 * TaskPipelineModule — HYDI Automation Pipeline Dashboard
 * 
 * Displays the HYDI task queue, webhook health, and provides
 * a UI to trigger new tasks directly from Ursula.
 * 
 * TEST mode: Shows mock task data.
 * LIVE mode: Fetches from beta-portal webhook + Supabase.
 * 
 * Error handling: Gracefully shows error states for unavailable services.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Workflow,
  Plus,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  ArrowUpRight,
  Zap,
  GitPullRequest,
  CircleDot,
  Send,
  FlaskConical,
  Radio,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';
import { checkWebhookHealth, triggerHydiTask, type WebhookHealth } from '@/lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TaskItem {
  id: string;
  title: string;
  priority: string;
  status: string;
  source: string;
  created_at: string;
  github_ref?: string;
}

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_TASKS: TaskItem[] = [
  { id: 'mock-1', title: '[GitHub PR #35] Fix AI Studio integration: lazy Firebase initialization', priority: 'high', status: 'assigned', source: 'github', created_at: '2026-02-14T02:30:00Z', github_ref: 'PR #35' },
  { id: 'mock-2', title: '[GitHub Issue #37] Truth', priority: 'high', status: 'done', source: 'github', created_at: '2026-02-14T02:30:01Z', github_ref: 'Issue #37' },
  { id: 'mock-3', title: '[GitHub PR #43] Optimize AI Studio integration: eliminate N+1 queries', priority: 'high', status: 'assigned', source: 'github', created_at: '2026-02-14T02:30:02Z', github_ref: 'PR #43' },
  { id: 'mock-4', title: 'Deploy subscription-starter to production', priority: 'medium', status: 'done', source: 'webhook', created_at: '2026-02-13T23:22:00Z' },
  { id: 'mock-5', title: '[GitHub PR #42] Implement user dashboard with responsive layout', priority: 'medium', status: 'queued', source: 'github', created_at: '2026-02-14T02:30:05Z', github_ref: 'PR #42' },
  { id: 'mock-6', title: 'Test webhook trigger from CLI', priority: 'medium', status: 'done', source: 'webhook', created_at: '2026-02-14T02:23:00Z' },
  { id: 'mock-7', title: '[GitHub PR #30] Add API documentation for /api directory endpoints', priority: 'low', status: 'queued', source: 'github', created_at: '2026-02-14T02:30:06Z', github_ref: 'PR #30' },
  { id: 'mock-8', title: '[GitHub PR #39] Add session management UI', priority: 'low', status: 'queued', source: 'github', created_at: '2026-02-14T02:30:07Z', github_ref: 'PR #39' },
];

const MOCK_HEALTH: WebhookHealth = {
  status: 'ready',
  supabase_url: 'set',
  service_key: 'set',
  email_secret: 'not set (open)',
  timestamp: new Date().toISOString(),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string, string> = {
  high: '#f85149',
  medium: '#d29922',
  low: '#3fb950',
};

const STATUS_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  queued: { color: '#58a6ff', icon: <Clock size={12} />, label: 'Queued' },
  assigned: { color: '#d29922', icon: <CircleDot size={12} />, label: 'Assigned' },
  running: { color: '#58a6ff', icon: <RefreshCw size={12} className="animate-spin" />, label: 'Running' },
  done: { color: '#3fb950', icon: <CheckCircle2 size={12} />, label: 'Done' },
  completed: { color: '#3fb950', icon: <CheckCircle2 size={12} />, label: 'Done' },
  failed: { color: '#f85149', icon: <XCircle size={12} />, label: 'Failed' },
  error: { color: '#f85149', icon: <AlertTriangle size={12} />, label: 'Error' },
};

function parseTasksJson(raw: Record<string, unknown>): TaskItem[] {
  const queue = (raw.queue || raw.tasks || []) as Record<string, unknown>[];
  if (!Array.isArray(queue)) return [];
  return queue.map((t) => {
    const title = (t.title || t.name || t.task || '') as string;
    const ghMatch = title.match(/\[GitHub (PR|Issue) #(\d+)\]/);
    return {
      id: (t.id || Math.random().toString(36).slice(2)) as string,
      title,
      priority: (t.priority || 'medium') as string,
      status: (t.status || 'queued') as string,
      source: ghMatch ? 'github' : ((t.data as Record<string, unknown>)?.source as string || 'webhook'),
      created_at: (t.created_at || '') as string,
      github_ref: ghMatch ? `${ghMatch[1]} #${ghMatch[2]}` : undefined,
    };
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TaskPipelineModule() {
  const { isLive, isTest } = useMode();
  const [tasks, setTasks] = useState<TaskItem[]>(MOCK_TASKS);
  const [health, setHealth] = useState<WebhookHealth | null>(MOCK_HEALTH);
  const [healthStatus, setHealthStatus] = useState<'online' | 'offline' | 'checking'>('online');
  const [loading, setLoading] = useState(false);
  const [triggerInput, setTriggerInput] = useState('');
  const [triggerStatus, setTriggerStatus] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'queued' | 'assigned' | 'done'>('all');

  // Fetch live data
  const refresh = useCallback(async () => {
    if (!isLive) {
      setTasks(MOCK_TASKS);
      setHealth(MOCK_HEALTH);
      setHealthStatus('online');
      return;
    }

    setLoading(true);
    setHealthStatus('checking');

    // Fetch webhook health
    const hRes = await checkWebhookHealth();
    if (hRes.data) {
      setHealth(hRes.data);
      setHealthStatus(hRes.data.status === 'ready' ? 'online' : 'offline');
    } else {
      setHealthStatus('offline');
    }

    // Fetch tasks.json via local API route (or fallback to mock)
    try {
      const tRes = await fetch('/api/tasks');
      if (tRes.ok) {
        const raw = await tRes.json();
        setTasks(parseTasksJson(raw));
      }
    } catch {
      // Keep existing tasks on failure
    }

    setLoading(false);
  }, [isLive]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Trigger a new task
  const handleTrigger = async () => {
    if (!triggerInput.trim()) return;
    setTriggerStatus('sending...');
    const res = await triggerHydiTask(triggerInput.trim());
    if (res.data) {
      setTriggerStatus(`Queued: ${res.data.id.slice(0, 8)}`);
      setTriggerInput('');
      setTimeout(() => { setTriggerStatus(null); refresh(); }, 2000);
    } else {
      setTriggerStatus(`Error: ${res.error}`);
      setTimeout(() => setTriggerStatus(null), 4000);
    }
  };

  // Stats
  const totalTasks = tasks.length;
  const queuedCount = tasks.filter(t => t.status === 'queued').length;
  const assignedCount = tasks.filter(t => t.status === 'assigned').length;
  const doneCount = tasks.filter(t => t.status === 'done' || t.status === 'completed').length;
  const githubCount = tasks.filter(t => t.source === 'github').length;

  const filteredTasks = filter === 'all'
    ? tasks
    : tasks.filter(t => {
        if (filter === 'done') return t.status === 'done' || t.status === 'completed';
        return t.status === filter;
      });

  // Sort: queued first, then assigned, then done
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    const order: Record<string, number> = { queued: 0, assigned: 1, running: 2, done: 3, completed: 3, failed: 4 };
    const diff = (order[a.status] ?? 5) - (order[b.status] ?? 5);
    if (diff !== 0) return diff;
    const pOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    return (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3);
  });

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Workflow size={20} style={{ color: 'var(--text-accent)' }} />
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-active)' }}>
              HYDI Task Pipeline
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono transition-colors hover:bg-white/5"
              style={{ color: 'var(--text-accent)' }}
            >
              <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <span
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold font-mono uppercase tracking-wider"
              style={{
                background: isLive ? '#3fb95020' : '#007acc20',
                color: isLive ? '#3fb950' : '#007acc',
              }}
            >
              {isLive ? <><Radio size={10} /> Live</> : <><FlaskConical size={10} /> Test</>}
            </span>
          </div>
        </div>
        <p className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
          Webhook → Supabase → Poller → tasks.json → Execute → Auto-close
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Total', value: totalTasks, color: 'var(--text-accent)' },
          { label: 'Queued', value: queuedCount, color: '#58a6ff' },
          { label: 'Assigned', value: assignedCount, color: '#d29922' },
          { label: 'Done', value: doneCount, color: '#3fb950' },
          { label: 'GitHub', value: githubCount, color: '#8b5cf6' },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-md p-3 border text-center"
            style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
          >
            <div className="text-xl font-bold font-mono" style={{ color: s.color }}>
              {s.value}
            </div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* Webhook Health + Trigger */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Health Card */}
        <div
          className="rounded-md p-4 border"
          style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold font-mono" style={{ color: 'var(--text-active)' }}>
              Webhook Endpoint
            </span>
            <span
              className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded"
              style={{
                color: healthStatus === 'online' ? '#3fb950' : healthStatus === 'checking' ? '#58a6ff' : '#f85149',
                background: healthStatus === 'online' ? '#3fb95015' : healthStatus === 'checking' ? '#58a6ff15' : '#f8514915',
              }}
            >
              {healthStatus === 'online' ? <CheckCircle2 size={10} /> : healthStatus === 'checking' ? <RefreshCw size={10} className="animate-spin" /> : <XCircle size={10} />}
              {healthStatus === 'online' ? 'Ready' : healthStatus === 'checking' ? 'Checking' : 'Offline'}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-mono">
              <span style={{ color: 'var(--text-secondary)' }}>Supabase</span>
              <span style={{ color: health?.supabase_url === 'set' ? '#3fb950' : '#f85149' }}>
                {health?.supabase_url || '?'}
              </span>
            </div>
            <div className="flex justify-between text-[11px] font-mono">
              <span style={{ color: 'var(--text-secondary)' }}>Service Key</span>
              <span style={{ color: health?.service_key === 'set' ? '#3fb950' : '#f85149' }}>
                {health?.service_key || '?'}
              </span>
            </div>
          </div>
          <a
            href="https://beta-portal-production.up.railway.app/api/hydi/email-trigger/health"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] font-mono mt-3 hover:underline"
            style={{ color: 'var(--text-accent)' }}
          >
            /api/hydi/email-trigger/health <ArrowUpRight size={9} />
          </a>
        </div>

        {/* Trigger Card */}
        <div
          className="rounded-md p-4 border"
          style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Zap size={14} style={{ color: 'var(--text-accent)' }} />
            <span className="text-xs font-bold font-mono" style={{ color: 'var(--text-active)' }}>
              Trigger New Task
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={triggerInput}
              onChange={(e) => setTriggerInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleTrigger()}
              placeholder="Task subject..."
              className="flex-1 px-3 py-1.5 rounded text-xs font-mono outline-none"
              style={{
                background: 'var(--bg-editor)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
              }}
            />
            <button
              onClick={handleTrigger}
              disabled={!triggerInput.trim()}
              className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-mono font-bold transition-colors disabled:opacity-30"
              style={{
                background: 'var(--text-accent)',
                color: '#fff',
              }}
            >
              <Send size={12} /> Queue
            </button>
          </div>
          {triggerStatus && (
            <div className="mt-2 text-[10px] font-mono" style={{ color: triggerStatus.startsWith('Error') ? '#f85149' : '#3fb950' }}>
              {triggerStatus}
            </div>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 mb-4">
        {(['all', 'queued', 'assigned', 'done'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-3 py-1 rounded text-[11px] font-mono font-bold uppercase tracking-wider transition-colors"
            style={{
              background: filter === f ? 'var(--text-accent)' : 'transparent',
              color: filter === f ? '#fff' : 'var(--text-secondary)',
            }}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
          {filteredTasks.length} task{filteredTasks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Task List */}
      <div className="space-y-2">
        {sortedTasks.length === 0 ? (
          <div
            className="rounded-md p-8 border text-center"
            style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
          >
            <p className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>
              No tasks matching filter.
            </p>
          </div>
        ) : (
          sortedTasks.map((task) => {
            const statusCfg = STATUS_CONFIG[task.status] || STATUS_CONFIG.queued;
            const prioColor = PRIORITY_COLORS[task.priority] || '#858585';
            return (
              <div
                key={task.id}
                className="rounded-md p-3 border flex items-center gap-3 transition-colors hover:border-[var(--text-accent)]"
                style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
              >
                {/* Priority dot */}
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: prioColor }}
                  title={task.priority}
                />

                {/* Source icon */}
                <div className="shrink-0" style={{ color: 'var(--text-secondary)' }}>
                  {task.source === 'github' ? <GitPullRequest size={14} /> : <Send size={14} />}
                </div>

                {/* Title */}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono truncate" style={{ color: 'var(--text-active)' }}>
                    {task.title.replace(/^\[Email\]\s*/, '')}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {task.github_ref && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#8b5cf620', color: '#8b5cf6' }}>
                        {task.github_ref}
                      </span>
                    )}
                    <span className="text-[9px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {task.id.slice(0, 8)}
                    </span>
                  </div>
                </div>

                {/* Status badge */}
                <span
                  className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded shrink-0"
                  style={{ color: statusCfg.color, background: `${statusCfg.color}15` }}
                >
                  {statusCfg.icon}
                  {statusCfg.label}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* Pipeline Diagram */}
      <div className="mt-8 rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
        <div className="text-xs font-bold font-mono mb-3" style={{ color: 'var(--text-active)' }}>
          Automation Cycle (every 5 min)
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono flex-wrap" style={{ color: 'var(--text-secondary)' }}>
          <span className="px-2 py-1 rounded" style={{ background: '#58a6ff15', color: '#58a6ff' }}>1. Pre-flight</span>
          <span style={{ color: 'var(--text-secondary)' }}>→</span>
          <span className="px-2 py-1 rounded" style={{ background: '#d2992215', color: '#d29922' }}>1.5 Email Poller</span>
          <span style={{ color: 'var(--text-secondary)' }}>→</span>
          <span className="px-2 py-1 rounded" style={{ background: '#8b5cf615', color: '#8b5cf6' }}>1.6 GitHub Sync</span>
          <span style={{ color: 'var(--text-secondary)' }}>→</span>
          <span className="px-2 py-1 rounded" style={{ background: '#3fb95015', color: '#3fb950' }}>2. Execute</span>
          <span style={{ color: 'var(--text-secondary)' }}>→</span>
          <span className="px-2 py-1 rounded" style={{ background: '#f8514915', color: '#f85149' }}>3. Diagnostics</span>
          <span style={{ color: 'var(--text-secondary)' }}>→</span>
          <span className="px-2 py-1 rounded" style={{ background: '#3fb95015', color: '#3fb950' }}>3.5 Auto-Close</span>
          <span style={{ color: 'var(--text-secondary)' }}>→</span>
          <span className="px-2 py-1 rounded" style={{ background: '#58a6ff15', color: '#58a6ff' }}>4. Alerts</span>
        </div>
      </div>
    </div>
  );
}
