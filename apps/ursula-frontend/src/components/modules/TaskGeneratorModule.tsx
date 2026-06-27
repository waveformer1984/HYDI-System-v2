/**
 * TaskGeneratorModule — HYDI Multi-Source Task Generation Monitor
 * 
 * Monitors and controls the 4 automated task generation sources that feed
 * into the centralized .hydi/tasks.json queue:
 * 
 * 1. Email Task Poller (Supabase → HYDI tasks)
 * 2. GitHub Backlog Trigger (PRs/Issues → HYDI tasks)
 * 3. Firebase Intake Poller (Approved intakes → HYDI tasks)
 * 4. Manual Task Creation (Direct queue injection)
 * 
 * Architecture based on: .hydi/TASK_FLOW_ANALYSIS.md
 * 
 * TEST mode: Shows mock task generation activity and queue stats.
 * LIVE mode: Monitors real pollers, triggers manual runs, shows live queue state.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  RefreshCw,
  Mail,
  ExternalLink,
  Database,
  PlusCircle,
  Play,
  Clock,
  TrendingUp,
  Radio,
  FlaskConical,
  BarChart3,
  Activity,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TaskSource {
  id: 'email' | 'github' | 'firebase' | 'manual' | 'forgefinder';
  name: string;
  description: string;
  file: string;
  status: 'active' | 'idle' | 'error';
  lastRun?: string;
  nextRun?: string;
  tasksGenerated: number;
  successRate: number;
  icon: React.ReactNode;
  color: string;
}

interface QueueStats {
  queue: number;
  executing: number;
  completed: number;
  totalTasks: number;
  priorityBreakdown: {
    urgent: number;
    high: number;
    medium: number;
    low: number;
  };
  agentBreakdown: Record<string, number>;
  sourceBreakdown: {
    email: number;
    github: number;
    firebase: number;
    manual: number;
    forgefinder: number;
  };
}

interface TaskGenerationActivity {
  timestamp: string;
  source: string;
  tasksCreated: number;
  priority: string;
  assignedTo: string;
}

interface QueueTask {
  task_id: string;
  source: string;
  system?: string;
  title?: string;
  description?: string;
  assigned_to?: string;
  locked_by?: string;
  priority: number;
  status: 'planned' | 'queued' | 'running' | 'waiting_review' | 'completed' | 'failed_retryable' | 'failed_terminal';
  created_at?: string;
  updated_at?: string;
}

interface ForgeFinderIntentForm {
  objective: string;
  jurisdiction: string;
  claimantName: string;
  claimantCompany: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  strategy: string;
  heidiConfidence: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  complexity: 'LOW' | 'MEDIUM' | 'HIGH';
  revenueImpact: number;
}

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_SOURCES: TaskSource[] = [
  {
    id: 'email',
    name: 'Email Task Poller',
    description: 'Polls Supabase email_tasks table for queued emails and converts them to HYDI tasks',
    file: 'HYDI_Personal_Assistant/email_task_poller.py',
    status: 'active',
    lastRun: '2026-02-15T22:30:00Z',
    nextRun: '2026-02-16T04:30:00Z',
    tasksGenerated: 23,
    successRate: 0.96,
    icon: <Mail size={16} />,
    color: '#58a6ff',
  },
  {
    id: 'github',
    name: 'GitHub Backlog Trigger',
    description: 'Fetches open PRs and issues via gh CLI, creates HYDI tasks for unresolved items',
    file: 'HYDI_Personal_Assistant/trigger_github_backlog.py',
    status: 'active',
    lastRun: '2026-02-15T22:30:00Z',
    nextRun: '2026-02-16T04:30:00Z',
    tasksGenerated: 47,
    successRate: 1.0,
    icon: <ExternalLink size={16} />,
    color: '#3fb950',
  },
  {
    id: 'firebase',
    name: 'Firebase Intake Poller',
    description: 'Polls Firebase task_intake collection for approved tasks and injects to queue',
    file: 'HYDI_Personal_Assistant/firebase_intake_poller.py',
    status: 'idle',
    lastRun: '2026-02-15T22:30:00Z',
    nextRun: '2026-02-16T04:30:00Z',
    tasksGenerated: 12,
    successRate: 0.92,
    icon: <Database size={16} />,
    color: '#f0883e',
  },
  {
    id: 'forgefinder',
    name: 'ForgeFinder Vertical Planner',
    description: 'Generates and executes ForgeFinder-specific discovery/recovery tasks through Ursula planner/executor APIs',
    file: '/api/hydi/forgefinder/generate',
    status: 'idle',
    tasksGenerated: 0,
    successRate: 1.0,
    icon: <TrendingUp size={16} />,
    color: '#e3b341',
  },
  {
    id: 'manual',
    name: 'Manual Task Creation',
    description: 'Direct queue injection via JSON editing or webhook POST',
    file: '.hydi/tasks.json',
    status: 'idle',
    tasksGenerated: 8,
    successRate: 1.0,
    icon: <PlusCircle size={16} />,
    color: '#bc8cff',
  },
];

const MOCK_QUEUE_STATS: QueueStats = {
  queue: 0,
  executing: 0,
  completed: 11,
  totalTasks: 90,
  priorityBreakdown: {
    urgent: 2,
    high: 15,
    medium: 48,
    low: 25,
  },
  agentBreakdown: {
    systemsDirector: 34,
    revenueCatalyst: 18,
    workerAgent: 22,
    devopsAgent: 12,
    auditAgent: 4,
  },
  sourceBreakdown: {
    email: 23,
    github: 47,
    firebase: 12,
    manual: 8,
    forgefinder: 0,
  },
};

const MOCK_ACTIVITY: TaskGenerationActivity[] = [
  { timestamp: '2026-02-15T22:45:00Z', source: 'GitHub', tasksCreated: 3, priority: 'high', assignedTo: 'workerAgent' },
  { timestamp: '2026-02-15T22:30:00Z', source: 'Email', tasksCreated: 1, priority: 'urgent', assignedTo: 'systemsDirector' },
  { timestamp: '2026-02-15T22:15:00Z', source: 'Firebase', tasksCreated: 2, priority: 'medium', assignedTo: 'revenueCatalyst' },
  { timestamp: '2026-02-15T21:50:00Z', source: 'GitHub', tasksCreated: 5, priority: 'medium', assignedTo: 'workerAgent' },
  { timestamp: '2026-02-15T21:30:00Z', source: 'Email', tasksCreated: 2, priority: 'high', assignedTo: 'systemsDirector' },
];

const DEFAULT_FORGEFINDER_FORM: ForgeFinderIntentForm = {
  objective: 'Find and recover unclaimed funds leads for ProtoForge.',
  jurisdiction: 'us',
  claimantName: '',
  claimantCompany: '',
  priority: 'high',
  strategy: 'aggressive',
  heidiConfidence: 0.82,
  riskLevel: 'MEDIUM',
  complexity: 'MEDIUM',
  revenueImpact: 60,
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function TaskGeneratorModule() {
  const { isLive } = useMode();
  const effectiveLive = isLive || process.env.NEXT_PUBLIC_PHASE1_FORCE_LIVE === 'true';
  const traceId = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `trace-${Date.now()}`;
  const [sources, setSources] = useState<TaskSource[]>(MOCK_SOURCES);
  const [queueStats, setQueueStats] = useState<QueueStats>(MOCK_QUEUE_STATS);
  const [activity, setActivity] = useState<TaskGenerationActivity[]>(MOCK_ACTIVITY);
  const [loading, setLoading] = useState(false);
  const [activeView, setActiveView] = useState<'sources' | 'queue' | 'activity'>('sources');
  const [lastError, setLastError] = useState<string | null>(null);
  const [forgeFinderForm, setForgeFinderForm] = useState<ForgeFinderIntentForm>(DEFAULT_FORGEFINDER_FORM);

  // Load queue stats
  const loadQueueStats = useCallback(async () => {
    if (!effectiveLive) {
      setQueueStats(MOCK_QUEUE_STATS);
      setLastError(null);
      return;
    }

    setLoading(true);
    setLastError(null);
    try {
      const [tasksRes, statusRes] = await Promise.all([
        fetch('/api/hydi/tasks', { cache: 'no-store' }),
        fetch('/api/hydi/heidi/status', { cache: 'no-store' }),
      ]);

      if (!tasksRes.ok) {
        throw new Error(`Failed to load tasks (${tasksRes.status})`);
      }

      const tasksPayload = await tasksRes.json();
      const tasks: QueueTask[] = (tasksPayload?.tasks ?? []) as QueueTask[];

      const queue = tasks.filter((task) => task.status === 'queued' || task.status === 'planned').length;
      const executing = tasks.filter((task) => task.status === 'running').length;
      const completed = tasks.filter((task) => task.status === 'completed').length;

      const priorityBreakdown = {
        urgent: tasks.filter((task) => (task.priority ?? 0) >= 9).length,
        high: tasks.filter((task) => (task.priority ?? 0) >= 7 && (task.priority ?? 0) < 9).length,
        medium: tasks.filter((task) => (task.priority ?? 0) >= 4 && (task.priority ?? 0) < 7).length,
        low: tasks.filter((task) => (task.priority ?? 0) < 4).length,
      };

      const sourceBreakdown = {
        email: tasks.filter((task) => task.source === 'email').length,
        github: tasks.filter((task) => task.source === 'github').length,
        firebase: tasks.filter((task) => task.source === 'firebase').length,
        forgefinder: tasks.filter((task) => task.system === 'forgefinder').length,
        manual: tasks.filter((task) => (task.source === 'manual' || task.source === 'heidi' || task.source === 'ursula') && task.system !== 'forgefinder').length,
      };

      const agentBreakdown = tasks.reduce<Record<string, number>>((acc, task) => {
        const assigned = task.assigned_to || task.locked_by || 'unassigned';
        acc[assigned] = (acc[assigned] || 0) + 1;
        return acc;
      }, {});

      setQueueStats({
        queue,
        executing,
        completed,
        totalTasks: tasks.length,
        priorityBreakdown,
        sourceBreakdown,
        agentBreakdown,
      });

      const recentActivity: TaskGenerationActivity[] = tasks
        .slice()
        .sort((a, b) => {
          const aTs = Date.parse(a.updated_at || a.created_at || '');
          const bTs = Date.parse(b.updated_at || b.created_at || '');
          return bTs - aTs;
        })
        .slice(0, 10)
        .map((task) => ({
          timestamp: task.updated_at || task.created_at || new Date().toISOString(),
          source: task.source || 'unknown',
          tasksCreated: 1,
          priority: (task.priority ?? 0) >= 9 ? 'urgent' : (task.priority ?? 0) >= 7 ? 'high' : (task.priority ?? 0) >= 4 ? 'medium' : 'low',
          assignedTo: task.assigned_to || task.locked_by || 'unassigned',
        }));

      setActivity(recentActivity.length > 0 ? recentActivity : MOCK_ACTIVITY);

      if (statusRes.ok) {
        const statusPayload = await statusRes.json();
        const status = statusPayload?.heidi_status;
        const recommendations = statusPayload?.strategy_performance as Array<{ strategy: string; success_rate: number }> | undefined;
        setSources((previous) =>
          previous.map((source) => {
            if (source.id === 'manual') {
              return {
                ...source,
                status: status?.phase === 'blocked' ? 'error' : 'active',
                lastRun: status?.last_updated ?? source.lastRun,
                tasksGenerated: sourceBreakdown.manual,
                successRate: status?.failure_count && status?.intent_count
                  ? Math.max(0, (status.intent_count - status.failure_count) / Math.max(status.intent_count, 1))
                  : source.successRate,
              };
            }
            if (source.id === 'github') {
              const strategy = recommendations?.find((item) => item.strategy?.toLowerCase() === 'aggressive');
              return {
                ...source,
                tasksGenerated: sourceBreakdown.github,
                successRate: strategy?.success_rate ?? source.successRate,
              };
            }
            if (source.id === 'email') {
              return {
                ...source,
                tasksGenerated: sourceBreakdown.email,
              };
            }
            if (source.id === 'firebase') {
              return {
                ...source,
                tasksGenerated: sourceBreakdown.firebase,
              };
            }
            if (source.id === 'forgefinder') {
              return {
                ...source,
                tasksGenerated: sourceBreakdown.forgefinder,
                status: sourceBreakdown.forgefinder > 0 ? 'active' : source.status,
              };
            }
            return source;
          })
        );
      }
    } catch (error) {
      console.error('[TaskGenerator] Failed to load queue stats', error);
      setLastError(error instanceof Error ? error.message : 'Failed to load queue stats');
    } finally {
      setLoading(false);
    }
  }, [effectiveLive]);

  // Trigger manual poller run
  const triggerPoller = useCallback(async (pollerId: string, intent?: ForgeFinderIntentForm) => {
    setLoading(true);

    if (!effectiveLive) {
      // TEST mode: simulate poller run
      await new Promise(resolve => setTimeout(resolve, 2000));
      setSources(prev => prev.map(s =>
        s.id === pollerId
          ? { ...s, status: 'active' as const, lastRun: new Date().toISOString() }
          : s
      ));
      setLoading(false);
      return;
    }

    // LIVE mode: Trigger actual poller script
    try {
      if (pollerId === 'manual') {
        await loadQueueStats();
      } else if (pollerId === 'forgefinder') {
        const form = intent ?? forgeFinderForm;
        const objective = form.objective.trim();
        if (!objective) {
          throw new Error('ForgeFinder objective is required');
        }
        const generateRes = await fetch('/api/hydi/forgefinder/generate', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-trace-id': traceId,
          },
          body: JSON.stringify({
            objective,
            strategy: form.strategy,
            heidi_confidence: Math.min(0.99, Math.max(0.1, form.heidiConfidence)),
            jurisdiction: form.jurisdiction.trim() || 'us',
            claimant_name: form.claimantName.trim() || null,
            claimant_company: form.claimantCompany.trim() || null,
            risk_level: form.riskLevel,
            complexity: form.complexity,
            task: {
              priority: form.priority,
              type: 'research',
              outputs_expected: {
                candidate_claims: 5,
                validation_packets: true,
              },
            },
            revenue_impact: { value: Math.max(0, form.revenueImpact) },
            context: {},
          }),
        });

        if (!generateRes.ok) {
          throw new Error(`ForgeFinder generation failed (${generateRes.status})`);
        }

        const generatePayload = await generateRes.json();
        if (!generatePayload?.allowed) {
          throw new Error(generatePayload?.decision_reason || 'ForgeFinder planner rejected intent');
        }

        await fetch('/api/hydi/tasks/execute-next?system=forgefinder', {
          method: 'POST',
          headers: {
            'x-worker-id': 'task-generator-forgefinder',
            'x-trace-id': traceId,
          },
        });
        await loadQueueStats();
      } else if (pollerId === 'github' || pollerId === 'email' || pollerId === 'firebase') {
        await fetch('/api/hydi/tasks/execute-next', {
          method: 'POST',
          headers: {
            'x-worker-id': `task-generator-${pollerId}`,
            'x-trace-id': traceId,
          },
        });
        await loadQueueStats();
      }
      setSources((previous) =>
        previous.map((source) =>
          source.id === pollerId
            ? { ...source, status: 'active', lastRun: new Date().toISOString() }
            : source
        )
      );
    } catch (error) {
      setLastError(error instanceof Error ? error.message : `Failed to trigger ${pollerId}`);
      setSources((previous) =>
        previous.map((source) =>
          source.id === pollerId
            ? { ...source, status: 'error' }
            : source
        )
      );
    }

    setLoading(false);
  }, [effectiveLive, forgeFinderForm, loadQueueStats]);

  useEffect(() => {
    loadQueueStats();
    const interval = setInterval(loadQueueStats, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [loadQueueStats]);

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Sparkles size={20} style={{ color: '#bc8cff' }} />
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-active)' }}>
            Task Generation Monitor
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold font-mono uppercase tracking-wider"
            style={{ background: effectiveLive ? '#3fb95020' : '#007acc20', color: effectiveLive ? '#3fb950' : '#007acc' }}
          >
            {effectiveLive ? <><Radio size={10} /> Live</> : <><FlaskConical size={10} /> Test</>}
          </span>
          <button
            onClick={loadQueueStats}
            className="p-2 rounded hover:opacity-80 transition-opacity"
            style={{ background: 'var(--bg-subtle)', color: 'var(--fg-default)' }}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {lastError && (
        <div className="mb-4 px-3 py-2 rounded border text-xs" style={{ borderColor: '#f85149', background: '#f8514920', color: '#f85149' }}>
          {lastError}
        </div>
      )}

      {/* Queue Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="p-4 rounded border" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}>
          <div className="text-xs text-gray-400 mb-1">Queue</div>
          <div className="text-2xl font-bold" style={{ color: '#d29922' }}>{queueStats.queue}</div>
        </div>
        <div className="p-4 rounded border" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}>
          <div className="text-xs text-gray-400 mb-1">Executing</div>
          <div className="text-2xl font-bold" style={{ color: '#58a6ff' }}>{queueStats.executing}</div>
        </div>
        <div className="p-4 rounded border" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}>
          <div className="text-xs text-gray-400 mb-1">Completed</div>
          <div className="text-2xl font-bold" style={{ color: '#3fb950' }}>{queueStats.completed}</div>
        </div>
        <div className="p-4 rounded border" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}>
          <div className="text-xs text-gray-400 mb-1">Total Tasks</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--fg-default)' }}>{queueStats.totalTasks}</div>
        </div>
      </div>

      {/* View Tabs */}
      <div className="flex items-center gap-1 mb-6 p-1 rounded-md bg-gray-800/30">
        {[
          { id: 'sources', label: 'Task Sources', icon: <Activity size={14} /> },
          { id: 'queue', label: 'Queue Analytics', icon: <BarChart3 size={14} /> },
          { id: 'activity', label: 'Recent Activity', icon: <Clock size={14} /> },
        ].map(view => (
          <button
            key={view.id}
            onClick={() => setActiveView(view.id as typeof activeView)}
            className={`flex items-center gap-2 px-3 py-2 rounded text-xs font-mono transition-colors ${activeView === view.id ? 'bg-purple-900/50 text-purple-400' : 'text-gray-400 hover:bg-gray-700/20 hover:text-gray-300'
              }`}
          >
            {view.icon} {view.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeView === 'sources' && (
        <SourcesView
          sources={sources}
          onTrigger={triggerPoller}
          loading={loading}
          forgeFinderForm={forgeFinderForm}
          onForgeFinderFormChange={setForgeFinderForm}
        />
      )}
      {activeView === 'queue' && (
        <QueueAnalyticsView stats={queueStats} />
      )}
      {activeView === 'activity' && (
        <ActivityView activity={activity} />
      )}
    </div>
  );
}

// ─── Sub Views ───────────────────────────────────────────────────────────────

function SourcesView({ sources, onTrigger, loading, forgeFinderForm, onForgeFinderFormChange }: {
  sources: TaskSource[];
  onTrigger: (id: string, intent?: ForgeFinderIntentForm) => void;
  loading: boolean;
  forgeFinderForm: ForgeFinderIntentForm;
  onForgeFinderFormChange: React.Dispatch<React.SetStateAction<ForgeFinderIntentForm>>;
}) {
  const updateForgeFinderField = <K extends keyof ForgeFinderIntentForm>(
    key: K,
    value: ForgeFinderIntentForm[K]
  ) => {
    onForgeFinderFormChange((previous) => ({
      ...previous,
      [key]: value,
    }));
  };

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--fg-default)' }}>
        Task Generation Sources
      </h2>
      <div className="grid grid-cols-2 gap-4">
        {sources.map(source => (
          <div
            key={source.id}
            className="p-4 rounded border"
            style={{ background: 'var(--bg-subtle)', borderColor: source.color }}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span style={{ color: source.color }}>{source.icon}</span>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--fg-default)' }}>
                  {source.name}
                </h3>
              </div>
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  background: source.status === 'active' ? '#3fb95020' : '#8b949e20',
                  color: source.status === 'active' ? '#3fb950' : '#8b949e',
                }}
              >
                {source.status}
              </span>
            </div>

            <p className="text-xs text-gray-400 mb-3">{source.description}</p>

            <div className="space-y-2 mb-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">File:</span>
                <span className="font-mono text-gray-300">{source.file}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Tasks Generated:</span>
                <span className="font-bold" style={{ color: source.color }}>{source.tasksGenerated}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-400">Success Rate:</span>
                <span className="font-bold text-green-400">{(source.successRate * 100).toFixed(0)}%</span>
              </div>
              {source.lastRun && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Last Run:</span>
                  <span className="text-gray-300">{new Date(source.lastRun).toLocaleTimeString()}</span>
                </div>
              )}
              {source.nextRun && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-400">Next Run:</span>
                  <span className="text-gray-300">{new Date(source.nextRun).toLocaleTimeString()}</span>
                </div>
              )}
            </div>

            {source.id === 'forgefinder' && (
              <div className="mb-3 p-3 rounded border space-y-2" style={{ borderColor: '#e3b34155', background: '#e3b34110' }}>
                <label className="text-[11px] text-gray-300 font-semibold block">Objective</label>
                <textarea
                  value={forgeFinderForm.objective}
                  onChange={(event) => updateForgeFinderField('objective', event.target.value)}
                  rows={2}
                  className="w-full rounded px-2 py-1 text-xs border outline-none focus:ring-1 focus:ring-yellow-400"
                  style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--fg-default)' }}
                  placeholder="Describe the unclaimed funds discovery intent"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-gray-300 font-semibold block mb-1">Jurisdiction</label>
                    <input
                      value={forgeFinderForm.jurisdiction}
                      onChange={(event) => updateForgeFinderField('jurisdiction', event.target.value)}
                      className="w-full rounded px-2 py-1 text-xs border"
                      style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--fg-default)' }}
                      placeholder="us"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-300 font-semibold block mb-1">Priority</label>
                    <select
                      value={forgeFinderForm.priority}
                      onChange={(event) => updateForgeFinderField('priority', event.target.value as ForgeFinderIntentForm['priority'])}
                      className="w-full rounded px-2 py-1 text-xs border"
                      style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--fg-default)' }}
                    >
                      <option value="low">low</option>
                      <option value="medium">medium</option>
                      <option value="high">high</option>
                      <option value="urgent">urgent</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-300 font-semibold block mb-1">Claimant Name</label>
                    <input
                      value={forgeFinderForm.claimantName}
                      onChange={(event) => updateForgeFinderField('claimantName', event.target.value)}
                      className="w-full rounded px-2 py-1 text-xs border"
                      style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--fg-default)' }}
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-300 font-semibold block mb-1">Claimant Company</label>
                    <input
                      value={forgeFinderForm.claimantCompany}
                      onChange={(event) => updateForgeFinderField('claimantCompany', event.target.value)}
                      className="w-full rounded px-2 py-1 text-xs border"
                      style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--fg-default)' }}
                      placeholder="Optional"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-300 font-semibold block mb-1">Strategy</label>
                    <input
                      value={forgeFinderForm.strategy}
                      onChange={(event) => updateForgeFinderField('strategy', event.target.value)}
                      className="w-full rounded px-2 py-1 text-xs border"
                      style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--fg-default)' }}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-300 font-semibold block mb-1">Heidi Confidence</label>
                <input
                      type="number"
                      min={0.1}
                      max={0.99}
                      step={0.01}
                      value={forgeFinderForm.heidiConfidence}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) {
                      updateForgeFinderField('heidiConfidence', next);
                    }
                  }}
                      className="w-full rounded px-2 py-1 text-xs border"
                      style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--fg-default)' }}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-300 font-semibold block mb-1">Risk</label>
                    <select
                      value={forgeFinderForm.riskLevel}
                      onChange={(event) => updateForgeFinderField('riskLevel', event.target.value as ForgeFinderIntentForm['riskLevel'])}
                      className="w-full rounded px-2 py-1 text-xs border"
                      style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--fg-default)' }}
                    >
                      <option value="LOW">LOW</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="HIGH">HIGH</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-300 font-semibold block mb-1">Complexity</label>
                    <select
                      value={forgeFinderForm.complexity}
                      onChange={(event) => updateForgeFinderField('complexity', event.target.value as ForgeFinderIntentForm['complexity'])}
                      className="w-full rounded px-2 py-1 text-xs border"
                      style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--fg-default)' }}
                    >
                      <option value="LOW">LOW</option>
                      <option value="MEDIUM">MEDIUM</option>
                      <option value="HIGH">HIGH</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-300 font-semibold block mb-1">Revenue Impact ($)</label>
                <input
                      type="number"
                      min={0}
                      step={1}
                      value={forgeFinderForm.revenueImpact}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    if (Number.isFinite(next)) {
                      updateForgeFinderField('revenueImpact', next);
                    }
                  }}
                      className="w-full rounded px-2 py-1 text-xs border"
                      style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)', color: 'var(--fg-default)' }}
                    />
                  </div>
                </div>
              </div>
            )}

            {source.id !== 'manual' && (
              <button
                onClick={() => onTrigger(source.id, source.id === 'forgefinder' ? forgeFinderForm : undefined)}
                disabled={loading}
                className="w-full px-3 py-2 rounded text-xs font-mono flex items-center justify-center gap-2 hover:opacity-80 transition-opacity disabled:opacity-50"
                style={{ background: `${source.color}20`, color: source.color }}
              >
                <Play size={12} />
                {source.id === 'forgefinder' ? 'Generate + Execute ForgeFinder' : 'Trigger Now'}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="p-4 rounded border bg-blue-900/10 border-blue-800/50 mt-6">
        <div className="flex items-center gap-2 mb-2">
          <Clock size={14} style={{ color: '#58a6ff' }} />
          <span className="text-xs font-mono font-bold text-blue-400 uppercase tracking-wider">
            GitHub Actions Automation
          </span>
        </div>
        <p className="text-xs text-gray-400">
          All pollers run automatically every 6 hours via GitHub Actions workflow:{' '}
          <code className="text-purple-400">.github/workflows/automated-tasks.yml</code>
        </p>
      </div>
    </div>
  );
}

function QueueAnalyticsView({ stats }: { stats: QueueStats }) {
  return (
    <div className="space-y-6">
      <h2 className="text-sm font-semibold" style={{ color: 'var(--fg-default)' }}>
        Queue Analytics
      </h2>

      {/* Priority Breakdown */}
      <div>
        <h3 className="text-xs font-semibold mb-3 text-gray-400">Priority Distribution</h3>
        <div className="grid grid-cols-4 gap-3">
          {Object.entries(stats.priorityBreakdown).map(([priority, count]) => (
            <div key={priority} className="p-3 rounded border" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}>
              <div className="text-xs text-gray-400 mb-1 capitalize">{priority}</div>
              <div className="text-xl font-bold" style={{
                color: priority === 'urgent' ? '#f85149' : priority === 'high' ? '#f0883e' : priority === 'medium' ? '#d29922' : '#58a6ff'
              }}>
                {count}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Agent Breakdown */}
      <div>
        <h3 className="text-xs font-semibold mb-3 text-gray-400">Tasks by Agent</h3>
        <div className="space-y-2">
          {Object.entries(stats.agentBreakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([agent, count]) => (
              <div key={agent} className="flex items-center gap-3">
                <div className="flex-1 flex items-center justify-between p-2 rounded" style={{ background: 'var(--bg-subtle)' }}>
                  <span className="text-xs font-mono" style={{ color: 'var(--fg-default)' }}>{agent}</span>
                  <span className="text-xs font-bold" style={{ color: '#bc8cff' }}>{count}</span>
                </div>
                <div className="w-32 h-2 rounded-full bg-gray-800">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(count / stats.totalTasks) * 100}%`,
                      background: '#bc8cff',
                    }}
                  />
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Source Breakdown */}
      <div>
        <h3 className="text-xs font-semibold mb-3 text-gray-400">Tasks by Source</h3>
        <div className="grid grid-cols-4 gap-3">
          {Object.entries(stats.sourceBreakdown).map(([source, count]) => (
            <div key={source} className="p-3 rounded border" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}>
              <div className="text-xs text-gray-400 mb-1 capitalize">{source}</div>
              <div className="text-xl font-bold" style={{ color: '#3fb950' }}>{count}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ActivityView({ activity }: { activity: TaskGenerationActivity[] }) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--fg-default)' }}>
        Recent Task Generation Activity
      </h2>
      <div className="space-y-2">
        {activity.map((item, idx) => (
          <div
            key={idx}
            className="p-3 rounded border flex items-center justify-between"
            style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-gray-400">
                {new Date(item.timestamp).toLocaleTimeString()}
              </span>
              <span className="text-xs font-semibold" style={{ color: 'var(--fg-default)' }}>
                {item.source}
              </span>
              <span className="text-xs px-2 py-0.5 rounded bg-purple-900/20 text-purple-400">
                {item.tasksCreated} {item.tasksCreated === 1 ? 'task' : 'tasks'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">→</span>
              <span className="text-xs font-mono" style={{ color: '#bc8cff' }}>
                {item.assignedTo}
              </span>
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  background: item.priority === 'urgent' ? '#f8514920' : item.priority === 'high' ? '#f0883e20' : '#d2992220',
                  color: item.priority === 'urgent' ? '#f85149' : item.priority === 'high' ? '#f0883e' : '#d29922',
                }}
              >
                {item.priority}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
