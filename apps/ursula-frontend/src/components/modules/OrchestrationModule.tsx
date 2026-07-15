/**
 * Orchestration Module — Ursula approval gate for Heidi actions.
 *
 * TEST mode: uses local mock queue and logs.
 * LIVE mode: calls Project Ops orchestration endpoints.
 *
 * Config: NEXT_PUBLIC_PROJECT_OPS_URL
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  Clock,
  Play,
  RefreshCw,
  Shield,
  XCircle,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';
import {
  approveOrchestrationAction,
  executeOrchestrationAction,
  getOrchestrationActionLogs,
  listOrchestrationActions,
  rejectOrchestrationAction,
  requestOrchestrationAction,
  type OrchestrationAction,
  type OrchestrationActionRisk,
  type OrchestrationActionStatus,
  type OrchestrationExecutionLogEntry,
} from '@/lib/api';

const STATUS_STYLE: Record<OrchestrationActionStatus, { color: string; bg: string; label: string }> = {
  pending_approval: { color: '#d29922', bg: '#d2992215', label: 'Pending Approval' },
  approved: { color: '#58a6ff', bg: '#58a6ff15', label: 'Approved' },
  rejected: { color: '#f85149', bg: '#f8514915', label: 'Rejected' },
  running: { color: '#bc8cff', bg: '#bc8cff15', label: 'Running' },
  completed: { color: '#3fb950', bg: '#3fb95015', label: 'Completed' },
  failed: { color: '#f85149', bg: '#f8514915', label: 'Failed' },
};

const RISK_STYLE: Record<OrchestrationActionRisk, { color: string; bg: string }> = {
  low: { color: '#3fb950', bg: '#3fb95015' },
  medium: { color: '#d29922', bg: '#d2992215' },
  high: { color: '#f0883e', bg: '#f0883e15' },
  critical: { color: '#f85149', bg: '#f8514915' },
};

const MOCK_ACTIONS: OrchestrationAction[] = [
  {
    id: 'orch-101',
    title: 'Run status sweep via HYDI CLI',
    adapter: 'cli_command',
    payload: {
      command: 'python',
      args: ['HYDI_Personal_Assistant/hydi_platform_cli.py', 'status'],
      runbook_uri: '.hydi/incidents/inc-payments.md',
      dry_run: true,
    },
    status: 'pending_approval',
    risk_level: 'medium',
    requested_by: 'heidi',
    approved_by: null,
    approval_note: null,
    created_at: '2026-02-13T12:00:00.000Z',
    updated_at: '2026-02-13T12:00:00.000Z',
    executed_at: null,
    result: null,
    execution_log: [{ timestamp: '2026-02-13T12:00:00.000Z', message: 'Action requested by heidi' }],
  },
  {
    id: 'orch-102',
    title: 'Generate incident response draft',
    adapter: 'ollama_generate',
    payload: {
      model: 'gemma3:4b',
      prompt: 'Draft runbook steps for handling a 502 from payments endpoint.',
      runbook_uri: '.hydi/incidents/inc-payments.md',
      dry_run: true,
    },
    status: 'completed',
    risk_level: 'low',
    requested_by: 'heidi',
    approved_by: 'ursula-owner',
    approval_note: 'Safe draft-only generation.',
    created_at: '2026-02-13T11:20:00.000Z',
    updated_at: '2026-02-13T11:21:00.000Z',
    executed_at: '2026-02-13T11:21:00.000Z',
    result: { success: true, output: 'Drafted 6-step remediation plan.' },
    execution_log: [
      { timestamp: '2026-02-13T11:20:00.000Z', message: 'Action requested by heidi' },
      { timestamp: '2026-02-13T11:20:20.000Z', message: 'Action approved by ursula-owner' },
      { timestamp: '2026-02-13T11:21:00.000Z', message: 'Execution completed successfully' },
    ],
  },
];

function buildCliPayload(command: string, argsRaw: string, runbookUri: string, dryRun: boolean): Record<string, unknown> {
  return {
    command: command.trim(),
    args: argsRaw
      .split(' ')
      .map((v) => v.trim())
      .filter(Boolean),
    runbook_uri: runbookUri.trim() || null,
    dry_run: dryRun,
  };
}

function buildOllamaPayload(prompt: string, model: string, runbookUri: string, dryRun: boolean): Record<string, unknown> {
  return {
    prompt: prompt.trim(),
    model: model.trim() || null,
    runbook_uri: runbookUri.trim() || null,
    dry_run: dryRun,
  };
}

export default function OrchestrationModule() {
  const { isLive } = useMode();
  const effectiveLive = isLive || process.env.NEXT_PUBLIC_PHASE1_FORCE_LIVE === 'true';
  const [actions, setActions] = useState<OrchestrationAction[]>(MOCK_ACTIONS);
  const [selectedId, setSelectedId] = useState<string>(MOCK_ACTIONS[0]?.id ?? '');
  const [logs, setLogs] = useState<OrchestrationExecutionLogEntry[]>(MOCK_ACTIONS[0]?.execution_log ?? []);
  const [result, setResult] = useState<Record<string, unknown> | null>(MOCK_ACTIONS[0]?.result ?? null);
  const [maxExecutionRisk, setMaxExecutionRisk] = useState<OrchestrationActionRisk>('high');
  const [filter, setFilter] = useState<OrchestrationActionStatus | 'all'>('all');
  const [apiError, setApiError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [title, setTitle] = useState('');
  const [adapter, setAdapter] = useState<'cli_command' | 'ollama_generate'>('cli_command');
  const [risk, setRisk] = useState<OrchestrationActionRisk>('medium');
  const [requestedBy, setRequestedBy] = useState('ursula');
  const [approvalActor, setApprovalActor] = useState('ursula-owner');
  const [approvalNote, setApprovalNote] = useState('');
  const [command, setCommand] = useState('python');
  const [argsRaw, setArgsRaw] = useState('HYDI_Personal_Assistant/hydi_platform_cli.py status');
  const [prompt, setPrompt] = useState('Summarize the latest endpoint failures and next runbook steps.');
  const [model, setModel] = useState('gemma3:4b');
  const [runbookUri, setRunbookUri] = useState('.hydi/incidents/');
  const [dryRun, setDryRun] = useState(true);

  const selectedAction = useMemo(
    () => actions.find((a) => a.id === selectedId) ?? null,
    [actions, selectedId],
  );

  const loadActions = useCallback(async () => {
    setLoading(true);
    setApiError(null);

    if (!effectiveLive) {
      setActions(MOCK_ACTIONS);
      setMaxExecutionRisk('high');
      setSelectedId((prev) => prev || MOCK_ACTIONS[0]?.id || '');
      setLoading(false);
      return;
    }

    const res = await listOrchestrationActions(filter === 'all' ? undefined : filter);
    if (res.error || !res.data) {
      setApiError(res.error || 'Failed to load orchestration actions');
      setLoading(false);
      return;
    }

    setActions(res.data.actions);
    setMaxExecutionRisk(res.data.max_execution_risk);
    setSelectedId((prev) => {
      const stillExists = res.data?.actions.some((a) => a.id === prev);
      if (stillExists) return prev;
      return res.data?.actions[0]?.id ?? '';
    });
    setLoading(false);
  }, [effectiveLive, filter]);

  const loadLogs = useCallback(
    async (actionId: string) => {
      if (!actionId) return;

      if (!effectiveLive) {
        const action = actions.find((a) => a.id === actionId);
        setLogs(action?.execution_log ?? []);
        setResult(action?.result ?? null);
        return;
      }

      const res = await getOrchestrationActionLogs(actionId);
      if (res.error || !res.data) {
        setApiError(res.error || 'Failed to load action logs');
        return;
      }

      setLogs(res.data.logs);
      setResult(res.data.result);
    },
    [actions, effectiveLive],
  );

  useEffect(() => {
    loadActions();
  }, [loadActions]);

  useEffect(() => {
    if (selectedId) {
      loadLogs(selectedId);
    }
  }, [loadLogs, selectedId]);

  const handleRequestAction = async () => {
    if (!title.trim()) {
      setApiError('Title is required.');
      return;
    }

    setApiError(null);

    if (!effectiveLive) {
      const now = new Date().toISOString();
      const mockPayload = adapter === 'cli_command'
        ? buildCliPayload(command, argsRaw, runbookUri, dryRun)
        : buildOllamaPayload(prompt, model, runbookUri, dryRun);
      const mockAction: OrchestrationAction = {
        id: `orch-${Date.now()}`,
        title: title.trim(),
        adapter,
        payload: mockPayload,
        status: 'pending_approval',
        risk_level: risk,
        requested_by: requestedBy.trim() || 'ursula',
        approved_by: null,
        approval_note: null,
        created_at: now,
        updated_at: now,
        executed_at: null,
        result: null,
        execution_log: [{ timestamp: now, message: `Action requested by ${requestedBy.trim() || 'ursula'}` }],
      };
      setActions((prev) => [mockAction, ...prev]);
      setSelectedId(mockAction.id);
      return;
    }

    const payload = adapter === 'cli_command'
      ? buildCliPayload(command, argsRaw, runbookUri, dryRun)
      : buildOllamaPayload(prompt, model, runbookUri, dryRun);

    const res = await requestOrchestrationAction({
      title: title.trim(),
      adapter,
      risk_level: risk,
      requested_by: requestedBy.trim() || 'ursula',
      payload,
    });

    if (res.error || !res.data?.action) {
      setApiError(res.error || 'Failed to request action');
      return;
    }

    await loadActions();
    setSelectedId(res.data.action.id);
  };

  const handleApprove = async (actionId: string) => {
    if (!effectiveLive) {
      setActions((prev) => prev.map((a) => (a.id === actionId ? {
        ...a,
        status: 'approved',
        approved_by: approvalActor,
        approval_note: approvalNote || null,
      } : a)));
      return;
    }

    const res = await approveOrchestrationAction(actionId, approvalActor, approvalNote || undefined);
    if (res.error) {
      setApiError(res.error);
      return;
    }
    await loadActions();
    await loadLogs(actionId);
  };

  const handleReject = async (actionId: string) => {
    if (!effectiveLive) {
      setActions((prev) => prev.map((a) => (a.id === actionId ? {
        ...a,
        status: 'rejected',
        approval_note: approvalNote || null,
      } : a)));
      return;
    }

    const res = await rejectOrchestrationAction(actionId, approvalActor, approvalNote || undefined);
    if (res.error) {
      setApiError(res.error);
      return;
    }
    await loadActions();
    await loadLogs(actionId);
  };

  const handleExecute = async (actionId: string) => {
    if (!effectiveLive) {
      setActions((prev) => prev.map((a) => (a.id === actionId ? {
        ...a,
        status: 'completed',
        executed_at: new Date().toISOString(),
        result: { success: true, note: 'TEST mode execution.' },
      } : a)));
      return;
    }

    const res = await executeOrchestrationAction(actionId);
    if (res.error || !res.data?.action) {
      setApiError(res.error || 'Failed to execute action');
      return;
    }
    await loadActions();
    await loadLogs(actionId);
  };

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-4">
        <Bot size={20} style={{ color: '#58a6ff' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          Heidi Orchestration
        </h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: effectiveLive ? '#3fb95015' : '#8b949e20', color: effectiveLive ? '#3fb950' : '#8b949e' }}>
          {effectiveLive ? 'LIVE' : 'TEST'}
        </span>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded ml-auto" style={{ background: '#58a6ff15', color: '#58a6ff' }}>
          max risk: {maxExecutionRisk}
        </span>
      </div>

      <p className="text-[12px] mb-4" style={{ color: 'var(--text-secondary)' }}>
        Approval-gated action queue with runbook context hooks, policy-aware execution, and audit-friendly logs.
      </p>

      {apiError && (
        <div className="mb-4 p-3 rounded-md border text-[11px] font-mono" style={{ background: '#f8514910', borderColor: '#f8514940', color: '#f85149' }}>
          {apiError}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-1 rounded-md border p-4" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-active)' }}>Request Action</h2>
          <div className="space-y-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Action title" className="w-full px-2 py-1.5 rounded text-[11px] font-mono" style={{ background: 'var(--bg-editor)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }} />
            <div className="grid grid-cols-2 gap-2">
              <select value={adapter} onChange={(e) => setAdapter(e.target.value as 'cli_command' | 'ollama_generate')} className="px-2 py-1.5 rounded text-[11px] font-mono" style={{ background: 'var(--bg-editor)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }}>
                <option value="cli_command">cli_command</option>
                <option value="ollama_generate">ollama_generate</option>
              </select>
              <select value={risk} onChange={(e) => setRisk(e.target.value as OrchestrationActionRisk)} className="px-2 py-1.5 rounded text-[11px] font-mono" style={{ background: 'var(--bg-editor)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }}>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="critical">critical</option>
              </select>
            </div>
            <input value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} placeholder="Requested by" className="w-full px-2 py-1.5 rounded text-[11px] font-mono" style={{ background: 'var(--bg-editor)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }} />
            <input value={runbookUri} onChange={(e) => setRunbookUri(e.target.value)} placeholder="Runbook URI (context hook)" className="w-full px-2 py-1.5 rounded text-[11px] font-mono" style={{ background: 'var(--bg-editor)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }} />

            {adapter === 'cli_command' ? (
              <>
                <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="Command" className="w-full px-2 py-1.5 rounded text-[11px] font-mono" style={{ background: 'var(--bg-editor)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }} />
                <input value={argsRaw} onChange={(e) => setArgsRaw(e.target.value)} placeholder="Args (space-separated)" className="w-full px-2 py-1.5 rounded text-[11px] font-mono" style={{ background: 'var(--bg-editor)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }} />
              </>
            ) : (
              <>
                <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" className="w-full px-2 py-1.5 rounded text-[11px] font-mono" style={{ background: 'var(--bg-editor)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }} />
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} placeholder="Prompt" className="w-full px-2 py-1.5 rounded text-[11px] font-mono" style={{ background: 'var(--bg-editor)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }} />
              </>
            )}

            <label className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> dry_run
            </label>

            <button onClick={handleRequestAction} className="w-full px-3 py-2 rounded text-[11px] font-mono" style={{ background: '#58a6ff20', color: '#58a6ff' }}>
              Request for Approval
            </button>
          </div>
        </div>

        <div className="xl:col-span-2 rounded-md border p-4" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>Action Queue</h2>
            <select value={filter} onChange={(e) => setFilter(e.target.value as OrchestrationActionStatus | 'all')} className="ml-2 px-2 py-1 rounded text-[10px] font-mono" style={{ background: 'var(--bg-editor)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }}>
              <option value="all">all</option>
              <option value="pending_approval">pending_approval</option>
              <option value="approved">approved</option>
              <option value="rejected">rejected</option>
              <option value="running">running</option>
              <option value="completed">completed</option>
              <option value="failed">failed</option>
            </select>
            <button onClick={loadActions} className="ml-auto px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1" style={{ background: '#58a6ff15', color: '#58a6ff' }}>
              <RefreshCw size={10} /> Refresh
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {loading && <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Loading actions...</div>}
              {actions.map((action) => {
                const status = STATUS_STYLE[action.status];
                const riskStyle = RISK_STYLE[action.risk_level];
                const isSelected = selectedId === action.id;
                return (
                  <button
                    key={action.id}
                    onClick={() => setSelectedId(action.id)}
                    className="w-full text-left rounded border p-2"
                    style={{
                      background: isSelected ? '#58a6ff10' : 'var(--bg-editor)',
                      borderColor: isSelected ? '#58a6ff60' : 'var(--border-color)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-active)' }}>{action.title}</span>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap text-[9px] font-mono">
                      <span className="px-1.5 py-0.5 rounded" style={{ color: status.color, background: status.bg }}>{status.label}</span>
                      <span className="px-1.5 py-0.5 rounded" style={{ color: riskStyle.color, background: riskStyle.bg }}>{action.risk_level}</span>
                      <span style={{ color: 'var(--text-secondary)' }}>{action.adapter}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="rounded border p-3" style={{ background: 'var(--bg-editor)', borderColor: 'var(--border-color)' }}>
              {selectedAction ? (
                <>
                  <div className="mb-2">
                    <div className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{selectedAction.title}</div>
                    <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{selectedAction.id}</div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mb-3">
                    <input value={approvalActor} onChange={(e) => setApprovalActor(e.target.value)} className="px-2 py-1.5 rounded text-[10px] font-mono" style={{ background: 'var(--bg-sidebar)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }} placeholder="Approver" />
                    <input value={approvalNote} onChange={(e) => setApprovalNote(e.target.value)} className="px-2 py-1.5 rounded text-[10px] font-mono" style={{ background: 'var(--bg-sidebar)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }} placeholder="Approval note" />
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <button
                      onClick={() => handleApprove(selectedAction.id)}
                      disabled={selectedAction.status !== 'pending_approval'}
                      className="px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1 disabled:opacity-40"
                      style={{ background: '#3fb95020', color: '#3fb950' }}
                    >
                      <CheckCircle2 size={10} /> Approve
                    </button>
                    <button
                      onClick={() => handleReject(selectedAction.id)}
                      disabled={selectedAction.status !== 'pending_approval'}
                      className="px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1 disabled:opacity-40"
                      style={{ background: '#f8514920', color: '#f85149' }}
                    >
                      <XCircle size={10} /> Reject
                    </button>
                    <button
                      onClick={() => handleExecute(selectedAction.id)}
                      disabled={selectedAction.status !== 'approved'}
                      className="px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1 disabled:opacity-40"
                      style={{ background: '#58a6ff20', color: '#58a6ff' }}
                    >
                      <Play size={10} /> Execute
                    </button>
                    <button
                      onClick={() => loadLogs(selectedAction.id)}
                      className="ml-auto px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1"
                      style={{ background: '#d2992215', color: '#d29922' }}
                    >
                      <Clock size={10} /> Logs
                    </button>
                  </div>

                  <div className="mb-2 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    <span className="inline-flex items-center gap-1 mr-3"><Shield size={10} /> runbook: {String((selectedAction.payload.runbook_uri as string | null) || 'none')}</span>
                    <span>requested_by: {selectedAction.requested_by}</span>
                  </div>

                  <pre className="text-[10px] font-mono p-2 rounded mb-2 overflow-auto max-h-[120px]" style={{ background: 'var(--bg-sidebar)', color: 'var(--text-active)' }}>
                    {JSON.stringify(selectedAction.payload, null, 2)}
                  </pre>

                  <div className="space-y-1 max-h-[150px] overflow-y-auto pr-1">
                    {logs.map((entry) => (
                      <div key={`${entry.timestamp}-${entry.message}`} className="text-[10px] font-mono p-1.5 rounded" style={{ background: 'var(--bg-sidebar)', color: 'var(--text-secondary)' }}>
                        {entry.timestamp} — {entry.message}
                      </div>
                    ))}
                    {logs.length === 0 && (
                      <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>No logs yet.</div>
                    )}
                  </div>

                  {result && (
                    <pre className="text-[10px] font-mono p-2 rounded mt-2 overflow-auto max-h-[120px]" style={{ background: '#3fb95010', color: 'var(--text-active)', border: '1px solid #3fb95030' }}>
                      {JSON.stringify(result, null, 2)}
                    </pre>
                  )}
                </>
              ) : (
                <div className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>Select an action to view details and logs.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
