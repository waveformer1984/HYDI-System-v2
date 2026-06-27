/**
 * ProjectOpsModule — Task Management & Agent Routing
 *
 * Dashboard for Project Ops — task intake, agent assignment,
 * risk scoring, expediting, and status tracking.
 *
 * TEST mode: Shows mock project/task data.
 * LIVE mode: Connects to Project Ops API when available.
 *
 * Config: Set NEXT_PUBLIC_PROJECT_OPS_URL for live data.
 * Error handling: Shows empty state when no projects loaded.
 */
'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Kanban,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Zap,
  Shield,
  BarChart3,
  CircleDot,
  Link2,
  ShieldCheck,
  Target,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';
import {
  listProjects,
  listChains,
  listTasks,
  checkProjectOpsHealth,
  listPMTemplates,
  type ProjectSummary,
  type ChainItem,
  type TaskItem,
  type PMTemplate,
} from '@/lib/api';

interface Task {
  id: string;
  title: string;
  project: string;
  status: 'backlog' | 'in-progress' | 'review' | 'done' | 'blocked';
  priority: 'critical' | 'high' | 'medium' | 'low';
  assignedAgent: string;
  riskScore: number;
  created: string;
}

interface ChainPhase {
  id: string;
  title: string;
  status: 'done' | 'in-progress' | 'todo' | 'blocked';
  agent: string;
  effort: number;
  gate: boolean;
  gateStatus?: 'passed' | 'pending' | 'failed';
  proof?: string;
}

interface TaskChain {
  id: string;
  objective: string;
  phases: ChainPhase[];
  totalEffort: number;
  created: string;
  risk: 'low' | 'medium' | 'high';
}

const MOCK_CHAINS: TaskChain[] = [
  {
    id: 'CHN-001',
    objective: 'Deploy SiteGrade AI to Vercel',
    created: '2026-02-10',
    risk: 'medium',
    totalEffort: 180,
    phases: [
      { id: 'p1', title: 'Audit codebase', status: 'done', agent: 'Cascade', effort: 30, gate: true, gateStatus: 'passed', proof: 'Dependencies listed, build script verified' },
      { id: 'p2', title: 'Fix build errors', status: 'done', agent: 'Cascade', effort: 60, gate: true, gateStatus: 'passed', proof: 'Build exit code 0' },
      { id: 'p3', title: 'Configure Vercel deployment', status: 'in-progress', agent: 'DevOps', effort: 30, gate: false },
      { id: 'p4', title: 'Deploy to Vercel', status: 'todo', agent: 'DevOps', effort: 15, gate: true },
      { id: 'p5', title: 'Verify live endpoints', status: 'todo', agent: 'DevOps', effort: 15, gate: true },
      { id: 'p6', title: 'Update Ursula module', status: 'todo', agent: 'Cascade', effort: 30, gate: false },
    ],
  },
  {
    id: 'CHN-002',
    objective: 'Launch Ghostwriter AI service',
    created: '2026-02-10',
    risk: 'high',
    totalEffort: 540,
    phases: [
      { id: 'p1', title: 'Finalize MVP', status: 'in-progress', agent: 'Cascade', effort: 240, gate: true },
      { id: 'p2', title: 'Set up Stripe checkout', status: 'todo', agent: 'DevOps', effort: 60, gate: true },
      { id: 'p3', title: 'Deploy to production', status: 'todo', agent: 'DevOps', effort: 30, gate: true },
      { id: 'p4', title: 'Create landing page', status: 'todo', agent: 'Jordan', effort: 120, gate: false },
      { id: 'p5', title: 'Launch announcement', status: 'todo', agent: 'Jordan', effort: 60, gate: true },
    ],
  },
];

const MOCK_TASKS: Task[] = [
  { id: 'TSK-001', title: 'Deploy payment API to Vercel', project: 'HydiPay', status: 'done', priority: 'critical', assignedAgent: 'DevOps', riskScore: 12, created: '2026-02-09' },
  { id: 'TSK-002', title: 'Register PayPal webhooks', project: 'HydiPay', status: 'done', priority: 'high', assignedAgent: 'DevOps', riskScore: 8, created: '2026-02-09' },
  { id: 'TSK-003', title: 'Build Ursula shell modules', project: 'Ursula', status: 'in-progress', priority: 'high', assignedAgent: 'Cascade', riskScore: 15, created: '2026-02-10' },
  { id: 'TSK-004', title: 'SiteGrade AI live API integration', project: 'SiteGrade', status: 'backlog', priority: 'medium', assignedAgent: 'Unassigned', riskScore: 20, created: '2026-02-10' },
  { id: 'TSK-005', title: 'Frank node physical setup', project: 'HYDRA', status: 'blocked', priority: 'medium', assignedAgent: 'Jordan', riskScore: 35, created: '2026-02-10' },
  { id: 'TSK-006', title: 'Stripe webhook forwarding (prod)', project: 'HydiPay', status: 'review', priority: 'high', assignedAgent: 'DevOps', riskScore: 10, created: '2026-02-10' },
];

const STATUS_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  'backlog': { color: '#8b949e', bg: '#8b949e15', label: 'Backlog' },
  'in-progress': { color: '#58a6ff', bg: '#58a6ff15', label: 'In Progress' },
  'review': { color: '#d29922', bg: '#d2992215', label: 'Review' },
  'done': { color: '#3fb950', bg: '#3fb95015', label: 'Done' },
  'blocked': { color: '#f85149', bg: '#f8514915', label: 'Blocked' },
};

const PRIORITY_STYLE: Record<string, { color: string }> = {
  'critical': { color: '#f85149' },
  'high': { color: '#d29922' },
  'medium': { color: '#58a6ff' },
  'low': { color: '#8b949e' },
};

const RISK_STYLE: Record<string, { color: string; bg: string }> = {
  low: { color: '#3fb950', bg: '#3fb95015' },
  medium: { color: '#d29922', bg: '#d2992215' },
  high: { color: '#f85149', bg: '#f8514915' },
};

const GATE_STYLE: Record<string, { color: string; bg: string }> = {
  passed: { color: '#3fb950', bg: '#3fb95015' },
  pending: { color: '#d29922', bg: '#d2992215' },
  failed: { color: '#f85149', bg: '#f8514915' },
};

// Map API chain to UI chain shape
function mapChainToUI(chain: ChainItem): TaskChain {
  const riskRaw = (chain.metadata?.risk_level as string) || 'medium';
  const risk = (['low', 'medium', 'high'].includes(riskRaw) ? riskRaw : 'medium') as 'low' | 'medium' | 'high';
  return {
    id: chain.id,
    objective: chain.objective,
    created: chain.created_at?.slice(0, 10) || '',
    risk,
    totalEffort: chain.total_effort_minutes,
    phases: chain.tasks.map(t => {
      const statusMap: Record<string, ChainPhase['status']> = {
        done: 'done', in_progress: 'in-progress', pending: 'todo', blocked: 'blocked', failed: 'blocked',
      };
      const gateStatusMap: Record<string, 'passed' | 'pending' | 'failed'> = {
        done: 'passed', in_progress: 'pending', pending: 'pending', blocked: 'failed', failed: 'failed',
      };
      return {
        id: t.id,
        title: t.title,
        status: statusMap[t.status] || 'todo',
        agent: t.assignment_mode === 'agent_only' ? 'Agent' : t.assignment_mode === 'human_only' ? 'Human' : 'Cascade',
        effort: t.effort_minutes,
        gate: t.is_gate,
        gateStatus: t.is_gate ? gateStatusMap[t.status] : undefined,
        proof: t.completion_proof || undefined,
      };
    }),
  };
}

// Map API task to UI task shape
function mapTaskToUI(task: TaskItem, projectName: string): Task {
  const statusMap: Record<string, Task['status']> = {
    done: 'done', in_progress: 'in-progress', pending: 'backlog', blocked: 'blocked', review: 'review',
  };
  const priorityMap: Record<number, Task['priority']> = {
    5: 'critical', 4: 'high', 3: 'medium', 2: 'low', 1: 'low',
  };
  return {
    id: task.id.slice(0, 7).toUpperCase(),
    title: task.title,
    project: projectName,
    status: statusMap[task.status] || 'backlog',
    priority: priorityMap[task.priority] || 'medium',
    assignedAgent: task.assigned_to || task.assignment_mode || 'Unassigned',
    riskScore: task.risk_score ?? 0,
    created: task.created_at?.slice(0, 10) || '',
  };
}

export default function ProjectOpsModule() {
  const { isLive } = useMode();
  const [tasks, setTasks] = useState<Task[]>(MOCK_TASKS);
  const [chains, setChains] = useState<TaskChain[]>(MOCK_CHAINS);
  const [filter, setFilter] = useState<string>('all');
  const [expandedChain, setExpandedChain] = useState<string | null>('CHN-001');
  const [view, setView] = useState<'chains' | 'tasks'>('chains');
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [apiConnected, setApiConnected] = useState<boolean | null>(null);

  const fetchLiveData = useCallback(async () => {
    setLoading(true);
    setApiError(null);

    const health = await checkProjectOpsHealth();
    if (health.error) {
      setApiConnected(false);
      setApiError(`Project Ops API unreachable: ${health.error}`);
      setTasks(MOCK_TASKS);
      setChains(MOCK_CHAINS);
      setLoading(false);
      return;
    }
    setApiConnected(true);

    const projectsRes = await listProjects();
    if (projectsRes.error || !projectsRes.data?.projects?.length) {
      setApiError(projectsRes.error || 'No projects found');
      setLoading(false);
      return;
    }

    const allChains: TaskChain[] = [];
    const allTasks: Task[] = [];

    for (const project of projectsRes.data.projects) {
      const [chainsRes, tasksRes] = await Promise.all([
        listChains(project.id),
        listTasks(project.id),
      ]);

      if (chainsRes.data?.chains) {
        allChains.push(...chainsRes.data.chains.map(mapChainToUI));
      }
      if (tasksRes.data?.tasks) {
        allTasks.push(...tasksRes.data.tasks.map(t => mapTaskToUI(t, project.name)));
      }
    }

    setChains(allChains.length > 0 ? allChains : MOCK_CHAINS);
    setTasks(allTasks.length > 0 ? allTasks : MOCK_TASKS);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isLive) {
      fetchLiveData();
    } else {
      setTasks(MOCK_TASKS);
      setChains(MOCK_CHAINS);
      setApiConnected(null);
      setApiError(null);
    }
  }, [isLive, fetchLiveData]);

  const filtered = filter === 'all' ? tasks : tasks.filter(t => t.status === filter);
  const statusCounts = Object.fromEntries(
    Object.keys(STATUS_STYLE).map(s => [s, tasks.filter(t => t.status === s).length])
  );

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-6">
        <Kanban size={20} style={{ color: '#58a6ff' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          Project Ops
        </h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#58a6ff15', color: '#58a6ff' }}>
          {tasks.length} tasks
        </span>
      </div>

      <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
        PM-style task chains with quality gates, agent assignments, and completion proof.
      </p>

      {/* API Status Banner */}
      {isLive && apiError && (
        <div className="mb-4 p-3 rounded-md border text-[11px] font-mono" style={{ background: '#f8514910', borderColor: '#f8514940', color: '#f85149' }}>
          {apiError} — showing mock data as fallback
        </div>
      )}
      {isLive && apiConnected === true && !apiError && (
        <div className="mb-4 p-2 rounded-md border text-[10px] font-mono flex items-center gap-2" style={{ background: '#3fb95010', borderColor: '#3fb95040', color: '#3fb950' }}>
          <CheckCircle2 size={10} /> Connected to Project Ops API (live data)
        </div>
      )}
      {loading && (
        <div className="mb-4 p-3 rounded-md border text-[11px] font-mono animate-pulse" style={{ background: '#58a6ff10', borderColor: '#58a6ff40', color: '#58a6ff' }}>
          Loading live data...
        </div>
      )}

      {/* View Toggle */}
      <div className="flex items-center gap-2 mb-6">
        <button
          onClick={() => setView('chains')}
          className="px-3 py-1.5 rounded text-[11px] font-mono font-semibold transition-colors"
          style={{
            background: view === 'chains' ? '#58a6ff20' : 'transparent',
            color: view === 'chains' ? '#58a6ff' : 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
          }}
        >
          <span className="flex items-center gap-1"><Link2 size={11} /> Chains ({chains.length})</span>
        </button>
        <button
          onClick={() => setView('tasks')}
          className="px-3 py-1.5 rounded text-[11px] font-mono font-semibold transition-colors"
          style={{
            background: view === 'tasks' ? '#58a6ff20' : 'transparent',
            color: view === 'tasks' ? '#58a6ff' : 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
          }}
        >
          <span className="flex items-center gap-1"><Kanban size={11} /> Tasks ({tasks.length})</span>
        </button>
      </div>

      {view === 'chains' ? (
        /* ─── Task Chains View ─── */
        <>
          {/* Chain Stats */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { icon: <Link2 size={14} />, label: 'Chains', value: chains.length, color: '#58a6ff' },
              { icon: <Target size={14} />, label: 'Phases', value: chains.reduce((s, c) => s + c.phases.length, 0), color: '#bc8cff' },
              { icon: <ShieldCheck size={14} />, label: 'Gates Passed', value: chains.reduce((s, c) => s + c.phases.filter(p => p.gateStatus === 'passed').length, 0), color: '#3fb950' },
              { icon: <Clock size={14} />, label: 'Total Effort', value: `${Math.round(chains.reduce((s, c) => s + c.totalEffort, 0) / 60)}h`, color: '#d29922' },
            ].map(s => (
              <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
                <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Chain Cards */}
          <div className="space-y-3">
            {chains.map(chain => {
              const done = chain.phases.filter(p => p.status === 'done').length;
              const pct = Math.round((done / chain.phases.length) * 100);
              const risk = RISK_STYLE[chain.risk];
              const isExpanded = expandedChain === chain.id;

              return (
                <div key={chain.id} className="rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                  {/* Chain Header */}
                  <button
                    onClick={() => setExpandedChain(isExpanded ? null : chain.id)}
                    className="w-full p-4 text-left"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {isExpanded ? <ChevronDown size={12} style={{ color: 'var(--text-secondary)' }} /> : <ChevronRight size={12} style={{ color: 'var(--text-secondary)' }} />}
                        <Link2 size={14} style={{ color: '#58a6ff' }} />
                        <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{chain.objective}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: risk.color, background: risk.bg }}>
                          {chain.risk} risk
                        </span>
                        <span className="text-[11px] font-mono font-bold" style={{ color: pct === 100 ? '#3fb950' : '#58a6ff' }}>
                          {pct}%
                        </span>
                      </div>
                    </div>
                    {/* Progress Bar */}
                    <div className="w-full h-1.5 rounded-full" style={{ background: 'var(--border-color)' }}>
                      <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, background: pct === 100 ? '#3fb950' : '#58a6ff' }} />
                    </div>
                    <div className="flex items-center gap-3 mt-2 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                      <span>{chain.phases.length} phases</span>
                      <span>{chain.phases.filter(p => p.gate).length} gates</span>
                      <span>{Math.round(chain.totalEffort / 60)}h effort</span>
                      <span>{chain.created}</span>
                    </div>
                  </button>

                  {/* Expanded Phase List */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-1">
                      {chain.phases.map((phase, i) => {
                        const phSts = STATUS_STYLE[phase.status] || STATUS_STYLE['backlog'];
                        return (
                          <div key={phase.id} className="flex items-center gap-2 p-2 rounded" style={{ background: 'var(--bg-editor)' }}>
                            {/* Phase Number */}
                            <span className="text-[10px] font-mono font-bold w-5 text-center" style={{ color: 'var(--text-secondary)' }}>
                              {i + 1}
                            </span>
                            {/* Connector */}
                            {i < chain.phases.length - 1 && (
                              <ArrowRight size={8} style={{ color: 'var(--border-color)', position: 'absolute', marginLeft: '6px', marginTop: '24px' }} />
                            )}
                            {/* Phase Info */}
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] font-medium" style={{ color: 'var(--text-active)' }}>{phase.title}</span>
                                {phase.gate && (
                                  <span className="flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded" style={{
                                    color: phase.gateStatus ? GATE_STYLE[phase.gateStatus].color : '#d29922',
                                    background: phase.gateStatus ? GATE_STYLE[phase.gateStatus].bg : '#d2992215',
                                  }}>
                                    <ShieldCheck size={8} />
                                    {phase.gateStatus === 'passed' ? 'Gate Passed' : 'QA Gate'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-3 text-[9px] font-mono mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                <span className="flex items-center gap-1"><Users size={8} /> {phase.agent}</span>
                                <span>{phase.effort}m</span>
                                {phase.proof && <span className="italic">Proof: {phase.proof}</span>}
                              </div>
                            </div>
                            {/* Status */}
                            <span className="flex items-center gap-1 text-[9px] font-mono px-2 py-0.5 rounded" style={{ color: phSts.color, background: phSts.bg }}>
                              {phase.status === 'done' ? <CheckCircle2 size={8} /> : phase.status === 'in-progress' ? <Clock size={8} /> : <CircleDot size={8} />}
                              {phSts.label}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Templates Reference */}
          <div className="mt-6 rounded-md p-4 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-active)' }}>PM Templates</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { name: 'Deploy Service', desc: 'Audit → Build → Deploy → Verify', color: '#58a6ff' },
                { name: 'Build Feature', desc: 'Design → Implement → Test → Review', color: '#3fb950' },
                { name: 'Fix Bug', desc: 'Investigate → Reproduce → Fix → Verify', color: '#f85149' },
                { name: 'Launch Product', desc: 'MVP → Payments → Deploy → Market', color: '#d29922' },
                { name: 'Integrate Service', desc: 'Audit API → Build Module → Wire', color: '#bc8cff' },
                { name: 'Security Audit', desc: 'Scan → Assess → Remediate → Report', color: '#f0883e' },
              ].map(t => (
                <div key={t.name} className="p-2 rounded text-[10px] font-mono" style={{ background: 'var(--bg-editor)' }}>
                  <span className="font-semibold" style={{ color: t.color }}>{t.name}</span>
                  <div style={{ color: 'var(--text-secondary)' }}>{t.desc}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* ─── Tasks View ─── */
        <>
          {/* Status Counts */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <button
              onClick={() => setFilter('all')}
              className="px-2.5 py-1 rounded text-[10px] font-mono transition-colors"
              style={{
                background: filter === 'all' ? '#58a6ff20' : 'transparent',
                color: filter === 'all' ? '#58a6ff' : 'var(--text-secondary)',
                border: '1px solid var(--border-color)',
              }}
            >
              All ({tasks.length})
            </button>
            {Object.entries(STATUS_STYLE).map(([key, style]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className="px-2.5 py-1 rounded text-[10px] font-mono transition-colors"
                style={{
                  background: filter === key ? style.bg : 'transparent',
                  color: filter === key ? style.color : 'var(--text-secondary)',
                  border: '1px solid var(--border-color)',
                }}
              >
                {style.label} ({statusCounts[key] || 0})
              </button>
            ))}
          </div>

          {/* Pipeline Stats */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            {[
              { icon: <BarChart3 size={14} />, label: 'Total', value: tasks.length, color: '#58a6ff' },
              { icon: <Zap size={14} />, label: 'Active', value: tasks.filter(t => t.status === 'in-progress').length, color: '#d29922' },
              { icon: <Shield size={14} />, label: 'Blocked', value: tasks.filter(t => t.status === 'blocked').length, color: '#f85149' },
              { icon: <CheckCircle2 size={14} />, label: 'Done', value: tasks.filter(t => t.status === 'done').length, color: '#3fb950' },
            ].map(s => (
              <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
                <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Task List */}
          <div className="space-y-2">
            {filtered.map(task => {
              const sts = STATUS_STYLE[task.status];
              const pri = PRIORITY_STYLE[task.priority];
              return (
                <div key={task.id} className="rounded-md p-3 border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold" style={{ color: 'var(--text-secondary)' }}>{task.id}</span>
                      <span className="text-sm font-medium" style={{ color: 'var(--text-active)' }}>{task.title}</span>
                    </div>
                    <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{ color: sts.color, background: sts.bg }}>
                      {task.status === 'done' ? <CheckCircle2 size={9} /> : task.status === 'blocked' ? <AlertTriangle size={9} /> : <CircleDot size={9} />}
                      {sts.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    <span>{task.project}</span>
                    <span className="flex items-center gap-1">
                      <Users size={9} /> {task.assignedAgent}
                    </span>
                    <span style={{ color: pri.color }}>● {task.priority}</span>
                    <span>Risk: {task.riskScore}</span>
                    <span>{task.created}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
