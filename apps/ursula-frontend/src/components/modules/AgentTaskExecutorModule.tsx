/**
 * AgentTaskExecutorModule — Ollama AI Task Executor Monitor
 * 
 * Monitors and controls the Ollama-based task executor that processes tasks
 * from .hydi/tasks.json using local LLM models.
 * 
 * Architecture based on: HYDI_Personal_Assistant/hydi_task_execution.py
 * 
 * Executor Features:
 * - Loads tasks from Ursula HYDI APIs (queued → running → completed)
 * - Executes via Ollama at http://localhost:11434
 * - Models: llama3.2:latest (default), gemma3:4b
 * - Timeout: 600 seconds per task
 * - Retry logic: max 3 retries for failed_retryable tasks
 * - Closed-loop follow-up: generates new tasks based on LLM responses
 * - Post-completion hooks: Railway redeploy for incident tasks
 * - Crash-safe: atomic writes, recovery of stuck tasks
 * 
 * TEST mode: Shows mock execution with simulated Ollama responses.
 * LIVE mode: Monitors real executor, triggers runs, shows live task states.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Play,
  RefreshCw,
  RotateCcw,
  Trash2,
  AlertCircle,
  CheckCircle,
  Clock,
  Zap,
  Radio,
  FlaskConical,
} from 'lucide-react';
import { ollamaGenerate, ollamaListModels, ollamaHealth, type OllamaModel } from '@/lib/api';
import { useMode } from '@/lib/mode-context';
import { type AgentItem } from '@/lib/api';
import { toCanonicalTaskStatus } from '@/lib/task-status';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AgentTask {
  id: string;
  title: string;
  description: string;
  priority: 'urgent' | 'high' | 'medium' | 'low';
  status: 'planned' | 'queued' | 'running' | 'waiting_review' | 'completed' | 'failed_retryable' | 'failed_terminal';
  outcome?: 'done' | 'failed_retryable' | 'failed_terminal';
  assignedTo: string;
  created_at: string;
  assigned_at?: string;
  started_at?: string;
  completed_at?: string;
  subtasks: string[];
  data?: Record<string, unknown>;
  executionLog: ExecutionLogEntry[];
  result?: string;
  error?: string;
  retry_count: number;
  max_retries: number;
}

interface ExecutionLogEntry {
  timestamp: string;
  message: string;
  level: 'info' | 'warning' | 'error' | 'success';
}

interface ExecutionStats {
  totalTasks: number;
  queue: number;
  executing: number;
  completed: number;
  done: number;
  failed_retryable: number;
  failed_terminal: number;
  successRate: number;
  avgExecutionTime: number;
}

// ─── Mock Data ───────────────────────────────────────────────────────────────

const MOCK_AGENTS: AgentItem[] = [
  { id: 'devopsAgent', name: 'DevOps Agent', type: 'ai', capabilities: ['deployment', 'infrastructure', 'security'], status: 'online' },
  { id: 'workerAgent', name: 'Worker Agent', type: 'ai', capabilities: ['testing', 'documentation', 'refactoring'], status: 'online' },
  { id: 'systemsDirector', name: 'Systems Director', type: 'ai', capabilities: ['orchestration', 'planning', 'coordination'], status: 'online' },
];

const MOCK_TASKS: AgentTask[] = [
  {
    id: 'task-1',
    title: '[Security] Add RESEND_API_KEY to production services',
    description: 'Set RESEND_API_KEY environment variable in Railway dashboard for beta-portal, payment-auto, and web-backend services.',
    priority: 'urgent',
    status: 'queued',
    assignedTo: 'devopsAgent',
    created_at: new Date().toISOString(),
    subtasks: [
      'Get fresh Resend API key from dashboard',
      'Set RESEND_API_KEY in beta-portal (Railway)',
      'Set RESEND_API_KEY in payment-auto (Railway)',
      'Verify RESEND_API_KEY in web-backend',
      'Test email sending on all 3 services',
      'Document in deployment checklist',
    ],
    executionLog: [],
    retry_count: 0,
    max_retries: 3,
  },
  {
    id: 'task-2',
    title: '[Testing] Add test scaffolding to 12 untested projects',
    description: 'Create test directories, add vitest/jest config, and write initial smoke tests for critical payment and API gateway modules.',
    priority: 'high',
    status: 'queued',
    assignedTo: 'workerAgent',
    created_at: new Date().toISOString(),
    subtasks: [
      'Add tests/ directory to HydiPay with pytest config',
      'Add vitest.config.ts to api-gateway',
      'Write smoke tests for payment endpoints',
      'Write smoke tests for webhook handlers',
      'Add GitHub Actions test workflow',
      'Document test requirements in CONTRIBUTING.md',
    ],
    executionLog: [],
    retry_count: 0,
    max_retries: 3,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  planned: { color: '#8b949e', bg: '#8b949e20', icon: Clock, label: 'Planned' },
  queued: { color: '#d29922', bg: '#d2992220', icon: Clock, label: 'Queued' },
  running: { color: '#58a6ff', bg: '#58a6ff20', icon: RotateCcw, label: 'Running' },
  waiting_review: { color: '#bc8cff', bg: '#bc8cff20', icon: AlertCircle, label: 'Review' },
  completed: { color: '#3fb950', bg: '#3fb95020', icon: CheckCircle, label: 'Completed' },
  failed_retryable: { color: '#f0883e', bg: '#f0883e20', icon: AlertCircle, label: 'Retryable Failed' },
  failed_terminal: { color: '#f85149', bg: '#f8514920', icon: AlertCircle, label: 'Terminal Failed' },
};

function calculateStats(tasks: AgentTask[]): ExecutionStats {
  const total = tasks.length;
  const queue = tasks.filter(t => t.status === 'queued' || t.status === 'planned').length;
  const executing = tasks.filter(t => t.status === 'running').length;
  const completed = tasks.filter(t => t.status === 'completed' || t.status === 'failed_retryable' || t.status === 'failed_terminal').length;
  const done = tasks.filter(t => t.status === 'completed').length;
  const failed_retryable = tasks.filter(t => t.status === 'failed_retryable').length;
  const failed_terminal = tasks.filter(t => t.status === 'failed_terminal').length;
  const successRate = completed > 0 ? (done / completed) : 0;
  const avgExecutionTime = 1250;

  return { totalTasks: total, queue, executing, completed, done, failed_retryable, failed_terminal, successRate, avgExecutionTime };
}

// ─── Component ───────────────────────────────────────────────────────────────

const HYDI_API_URL = '/api/hydi';

function mapPriority(priority: unknown): AgentTask['priority'] {
  if (priority === 'urgent' || priority === 'high' || priority === 'medium' || priority === 'low') {
    return priority;
  }
  if (typeof priority === 'number') {
    if (priority >= 9) return 'urgent';
    if (priority >= 7) return 'high';
    if (priority >= 4) return 'medium';
  }
  return 'low';
}

export default function AgentTaskExecutorModule() {
  const { isLive } = useMode();
  const effectiveLive = isLive || process.env.NEXT_PUBLIC_PHASE1_FORCE_LIVE === 'true';
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>(MOCK_AGENTS);
  const [isExecuting, setIsExecuting] = useState(false);
  const [selectedTask, setSelectedTask] = useState<AgentTask | null>(null);
  const [filter, setFilter] = useState<'all' | 'queued' | 'running' | 'completed' | 'failed_retryable' | 'failed_terminal'>('all');
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('llama3.2');
  const [ollamaStatus, setOllamaStatus] = useState<'unknown' | 'healthy' | 'unhealthy'>('unknown');
  const [loading, setLoading] = useState(false);
  const [forgeFinderOnly, setForgeFinderOnly] = useState(false);

  // Load tasks from HYDI API
  const loadTasks = useCallback(async () => {
    if (!effectiveLive) {
      setTasks(MOCK_TASKS);
      setSelectedTask(MOCK_TASKS[0]);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${HYDI_API_URL}/tasks`);
      if (!res.ok) {
        console.error('Failed to load HYDI tasks:', res.statusText);
        setLoading(false);
        return;
      }

      const data = await res.json();
      const hydiTasks = (data.tasks ?? []) as any[];

      const mapped: AgentTask[] = hydiTasks.map((t) => ({
        id: t.task_id || t.id,
        title: t.title,
        description: t.description || '',
        priority: mapPriority(t.priority),
        status: toCanonicalTaskStatus(t.status),
        assignedTo: t.assigned_to || 'systemsDirector',
        created_at: t.created_at || new Date().toISOString(),
        subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
        data: {
          ...(t.data || {}),
          system: t.system,
          source: t.source,
        },
        executionLog: [],
        retry_count: t.retry_count ?? 0,
        max_retries: t.max_retries ?? 3,
        result: t.result ? JSON.stringify(t.result, null, 2) : undefined,
        error: t.error,
      }));

      setTasks(mapped);
      if (mapped.length > 0 && !selectedTask) {
        setSelectedTask(mapped[0]);
      }
    } catch (error) {
      console.error('Failed to load HYDI tasks:', error);
    }
    setLoading(false);
  }, [effectiveLive, selectedTask]);

  // Load agents and Ollama models on mount
  useEffect(() => {
    setAgents(MOCK_AGENTS);

    if (effectiveLive) {
      (async () => {
        const healthRes = await ollamaHealth();
        if (healthRes.data) {
          setOllamaStatus('healthy');
          const modelsRes = await ollamaListModels();
          if (modelsRes.data?.models) {
            setOllamaModels(modelsRes.data.models);
            if (modelsRes.data.models.length > 0 && !selectedModel) {
              setSelectedModel(modelsRes.data.models[0].name);
            }
          }
        } else {
          setOllamaStatus('unhealthy');
        }
      })();
    }
  }, [effectiveLive, selectedModel]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Execute single task
  const executeTask = useCallback(async (task: AgentTask) => {
    const taskId = task.id;

    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? {
          ...t,
          status: 'running',
          started_at: new Date().toISOString(),
          executionLog: [
            ...t.executionLog,
            { timestamp: new Date().toISOString(), message: 'Task execution started', level: 'info' as const },
          ],
        }
        : t
    ));

    if (!effectiveLive) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const mockOutput = `Task "${task.title}" completed successfully.\n\nActions taken:\n${task.subtasks.map((s, i) => `${i + 1}. ${s} ✓`).join('\n')}`;

      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? {
            ...t,
            status: 'completed',
            outcome: 'done' as const,
            completed_at: new Date().toISOString(),
            executionLog: [
              ...t.executionLog,
              { timestamp: new Date().toISOString(), message: 'Task completed successfully', level: 'success' as const },
            ],
            result: mockOutput,
          }
          : t
      ));
      return;
    }

    try {
      const systemHint =
        ((task.data?.system as string | undefined) ?? '').toLowerCase() === 'forgefinder'
          ? '?system=forgefinder'
          : '';
      const traceId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const response = await fetch(`${HYDI_API_URL}/tasks/${encodeURIComponent(task.id)}/execute${systemHint}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': 'ursula-ui',
          'x-trace-id': traceId,
        },
        body: JSON.stringify({
          model: selectedModel,
          mode: 'live-ui',
        }),
      });

      if (!response.ok) {
        const failurePayload = await response.json().catch(() => ({}));
        throw new Error(failurePayload?.error || 'Task execution request failed');
      }

      const executionPayload = await response.json();
      const status = toCanonicalTaskStatus(executionPayload?.task?.status ?? executionPayload?.result_status ?? 'completed');
      const resultBody = executionPayload?.task?.result ?? executionPayload?.execution ?? executionPayload;
      const resultText = typeof resultBody === 'string' ? resultBody : JSON.stringify(resultBody, null, 2);

      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? {
            ...t,
            status,
            outcome:
              status === 'completed'
                ? 'done'
                : status === 'failed_retryable'
                  ? 'failed_retryable'
                  : status === 'failed_terminal'
                    ? 'failed_terminal'
                    : undefined,
            completed_at: new Date().toISOString(),
            executionLog: [
              ...t.executionLog,
              {
                timestamp: new Date().toISOString(),
                message:
                  status === 'completed'
                    ? 'Task execution completed'
                    : `Task execution finished with status ${status}`,
                level: status === 'completed' ? 'success' : 'warning',
              },
            ],
            result: resultText,
            error: executionPayload?.task?.error,
          }
          : t
      ));
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setTasks(prev => prev.map(t =>
        t.id === taskId
          ? {
            ...t,
            status: 'failed_retryable',
            outcome: 'failed_retryable' as const,
            completed_at: new Date().toISOString(),
            executionLog: [
              ...t.executionLog,
              { timestamp: new Date().toISOString(), message: `Execution failed: ${errorMsg}`, level: 'error' as const },
            ],
            error: errorMsg,
          }
          : t
      ));
    }
  }, [effectiveLive, selectedModel]);

  // Execute all queued/planned tasks
  const executeAll = useCallback(async () => {
    setIsExecuting(true);
    const assignedTasks = tasks.filter(t => t.status === 'queued' || t.status === 'planned');

    for (const task of assignedTasks) {
      await executeTask(task);
    }

    setIsExecuting(false);
  }, [tasks, executeTask]);

  // Retry failed tasks
  const retryFailed = useCallback(() => {
    setTasks(prev => prev.map(t =>
      t.status === 'failed_retryable' && t.retry_count < t.max_retries
        ? { ...t, status: 'queued', outcome: undefined, error: undefined, retry_count: t.retry_count + 1 }
        : t
    ));
  }, []);

  // Clear completed tasks
  const clearCompleted = useCallback(() => {
    setTasks(prev => prev.filter(t => !['completed', 'failed_retryable', 'failed_terminal'].includes(t.status)));
    if (selectedTask && ['completed', 'failed_retryable', 'failed_terminal'].includes(selectedTask.status)) {
      setSelectedTask(null);
    }
  }, [selectedTask]);

  const stats = calculateStats(tasks);

  const filteredTasks = tasks.filter(t => {
    if (forgeFinderOnly) {
      const system = ((t.data?.system as string | undefined) ?? '').toLowerCase();
      if (system !== 'forgefinder') {
        return false;
      }
    }
    if (filter === 'all') return true;
    return t.status === filter;
  });

  return (
    <div className="h-full flex flex-col" style={{ background: 'var(--bg-default)', color: 'var(--fg-default)' }}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-3">
          <Zap size={18} style={{ color: 'var(--text-accent)' }} />
          <h1 className="text-sm font-semibold">Agent Task Executor</h1>
          <span
            className="px-2 py-0.5 rounded text-[10px] font-mono font-bold flex items-center gap-1"
            style={{ background: effectiveLive ? '#3fb95020' : '#58a6ff20', color: effectiveLive ? '#3fb950' : '#58a6ff' }}
          >
            {effectiveLive ? <><Radio size={10} /> Live</> : <><FlaskConical size={10} /> Test</>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setForgeFinderOnly((previous) => !previous)}
            className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-mono transition-colors"
            style={{
              background: forgeFinderOnly ? '#e3b34120' : 'transparent',
              color: forgeFinderOnly ? '#e3b341' : 'var(--text-accent)',
            }}
          >
            ForgeFinder
          </button>
          <button
            onClick={executeAll}
            disabled={isExecuting || stats.queue === 0}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-xs font-mono font-bold transition-colors disabled:opacity-30"
            style={{ background: '#3fb95020', color: '#3fb950' }}
          >
            <Play size={12} />
            Execute All ({stats.queue})
          </button>
          <button
            onClick={retryFailed}
            disabled={stats.failed_retryable === 0}
            className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-mono transition-colors disabled:opacity-30"
            style={{ color: 'var(--text-accent)' }}
          >
            <RotateCcw size={12} />
            Retry Failed
          </button>
          <button
            onClick={clearCompleted}
            disabled={stats.completed === 0}
            className="flex items-center gap-1 px-2 py-1.5 rounded text-xs font-mono transition-colors disabled:opacity-30"
            style={{ color: 'var(--text-accent)' }}
          >
            <Trash2 size={12} />
            Clear Completed
          </button>
          <button
            onClick={loadTasks}
            disabled={loading}
            className="p-2 rounded hover:opacity-80 transition-opacity"
            style={{ background: 'var(--bg-subtle)', color: 'var(--fg-default)' }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-5 gap-4 p-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="text-center">
          <div className="text-xs text-gray-400 mb-1">Total</div>
          <div className="text-2xl font-bold" style={{ color: 'var(--fg-default)' }}>{stats.totalTasks}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-400 mb-1">Queue</div>
          <div className="text-2xl font-bold" style={{ color: '#8b949e' }}>{stats.queue}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-400 mb-1">Executing</div>
          <div className="text-2xl font-bold" style={{ color: '#58a6ff' }}>{stats.executing}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-400 mb-1">Done</div>
          <div className="text-2xl font-bold" style={{ color: '#3fb950' }}>{stats.done}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-400 mb-1">Success Rate</div>
          <div className="text-2xl font-bold" style={{ color: '#3fb950' }}>{(stats.successRate * 100).toFixed(0)}%</div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
        {(['all', 'queued', 'running', 'completed', 'failed_retryable', 'failed_terminal'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="px-2 py-1 rounded text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
            style={{
              background: filter === f ? 'var(--text-accent)' : 'transparent',
              color: filter === f ? 'var(--bg-default)' : 'var(--fg-muted)',
            }}
          >
            {f.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Task List */}
        <div className="w-1/2 border-r overflow-y-auto" style={{ borderColor: 'var(--border-color)' }}>
          <div className="p-4 space-y-2">
            {filteredTasks.map((task) => {
              const isSelected = selectedTask?.id === task.id;
              const config = STATUS_CONFIG[task.status];
              const Icon = config.icon;

              return (
                <button
                  key={task.id}
                  onClick={() => setSelectedTask(task)}
                  className="w-full text-left rounded-md p-3 border transition-colors"
                  style={{
                    background: isSelected ? '#bc8cff10' : 'var(--bg-sidebar)',
                    borderColor: isSelected ? '#bc8cff' : 'var(--border-color)',
                  }}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1">
                      <div className="text-xs font-semibold mb-1" style={{ color: 'var(--fg-default)' }}>
                        {task.title}
                      </div>
                      <div className="text-[10px] text-gray-400 line-clamp-2">{task.description}</div>
                    </div>
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono" style={{ background: config.bg, color: config.color }}>
                      <Icon size={10} />
                      {config.label}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-gray-400">{task.subtasks.length} subtasks</span>
                    <span className="font-mono" style={{ color: '#bc8cff' }}>{task.assignedTo}</span>
                  </div>
                  {(task.status === 'queued' || task.status === 'planned') && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        executeTask(task);
                      }}
                      className="w-full mt-2 px-2 py-1 rounded text-[10px] font-mono font-bold flex items-center justify-center gap-1"
                      style={{ background: '#3fb95020', color: '#3fb950' }}
                    >
                      <Play size={10} />
                      Execute Now
                    </button>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Task Details */}
        <div className="w-1/2 overflow-y-auto">
          {selectedTask ? (
            <div className="p-4">
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--fg-default)' }}>{selectedTask.title}</h2>
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono" style={{ background: STATUS_CONFIG[selectedTask.status].bg, color: STATUS_CONFIG[selectedTask.status].color }}>
                    {STATUS_CONFIG[selectedTask.status].label}
                  </div>
                </div>
                <p className="text-xs text-gray-400">{selectedTask.description}</p>
              </div>

              <div className="mb-4">
                <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--fg-default)' }}>Subtasks</h3>
                <div className="space-y-1">
                  {selectedTask.subtasks.map((subtask, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs">
                      <span className="text-gray-400">{idx + 1}.</span>
                      <span style={{ color: 'var(--fg-default)' }}>{subtask}</span>
                    </div>
                  ))}
                </div>
              </div>

              {selectedTask.result && (
                <div className="mb-4">
                  <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--fg-default)' }}>Result</h3>
                  <pre className="text-[10px] p-2 rounded whitespace-pre-wrap" style={{ background: 'var(--bg-subtle)', color: 'var(--fg-default)' }}>
                    {selectedTask.result}
                  </pre>
                </div>
              )}

              {selectedTask.error && (
                <div className="mb-4">
                  <h3 className="text-xs font-semibold mb-2 flex items-center gap-1" style={{ color: '#f85149' }}>
                    <AlertCircle size={12} />
                    Error
                  </h3>
                  <pre className="text-[10px] p-2 rounded" style={{ background: '#f8514920', color: '#f85149' }}>
                    {selectedTask.error}
                  </pre>
                </div>
              )}

              {(selectedTask.status === 'queued' || selectedTask.status === 'planned') && (
                <button
                  onClick={() => executeTask(selectedTask)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded text-sm font-mono font-bold transition-colors"
                  style={{ background: '#3fb95020', color: '#3fb950' }}
                >
                  <Play size={14} />
                  Execute Task
                </button>
              )}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              Select a task to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
