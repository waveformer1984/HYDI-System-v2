/**
 * HumanProxyPanel — Control-Plane Dashboard View
 *
 * Displays the operational state of the human proxy control plane.
 * Shows active goals, interventions, checkpoints, and recent events.
 *
 * Does NOT display internal reasoning, chain-of-thought, or credentials.
 * Updates via polling (every 2 seconds when visible).
 */

import { useState, useEffect, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────

interface OperationalGoalState {
  goalId: string;
  sessionId: string;
  delegatedIdentityId: string;
  goalText: string;
  status: string;
  startedAt: string;
  updatedAt: string;
  elapsedMs: number;
  currentAction?: string;
  currentCapability?: string;
  targetResource?: string;
  resourceType?: string;
  riskLevel?: string;
  authorizationState: string;
  authorizationReason?: string;
  verificationState: string;
  verificationContract?: string;
  interventionRequired: boolean;
  interventionId?: string;
  interventionType?: string;
  interventionReason?: string;
  checkpointId?: string;
  lastCompletedAction?: string;
  nextAction?: string;
  retryCount: number;
  replanCount: number;
  recoveryCount: number;
  actionCount: number;
  completedActionCount: number;
  failedActionCount: number;
  sideEffects: string[];
  warnings: string[];
  blockers: string[];
  finalState?: Record<string, unknown>;
  finalVerification?: string;
  persistenceState: string;
}

interface InterventionDetail {
  interventionId: string;
  goalId: string;
  identityId: string;
  reason: string;
  requiredHumanAction: string;
  createdAt: string;
  expiresAt: string;
  checkpointId?: string;
  resumeCondition: string;
  status: string;
  interventionType: string;
  whyRequired: string;
  expectedResultingState: string;
}

interface OperationalEvent {
  eventId: string;
  goalId: string;
  eventType: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

interface ControlPlaneStatus {
  controlPlane: string;
  activeGoals: number;
  pendingInterventions: number;
  completedGoals: number;
  failedGoals: number;
  totalActions: number;
  totalReplans: number;
  totalRecoveries: number;
  interventions: Array<{
    interventionId: string;
    goalId: string;
    type: string;
    reason: string;
    requiredAction: string;
    status: string;
    createdAt: string;
    expiresAt: string;
  }>;
  recentEvents: Array<{
    eventId: string;
    goalId: string;
    eventType: string;
    timestamp: string;
  }>;
}

// ─── Helper ────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'RUNNING': return 'text-green-400';
    case 'WAITING_FOR_HUMAN': return 'text-yellow-400';
    case 'WAITING_FOR_PROVIDER': return 'text-yellow-400';
    case 'RECOVERING': return 'text-orange-400';
    case 'COMPLETED': return 'text-blue-400';
    case 'FAILED': return 'text-red-400';
    case 'EXPIRED': return 'text-red-400';
    case 'PAUSED': return 'text-gray-400';
    case 'PARTIAL': return 'text-orange-400';
    default: return 'text-gray-400';
  }
}

function authColor(state: string): string {
  switch (state) {
    case 'authorized': return 'text-green-400';
    case 'denied': return 'text-red-400';
    case 'pending': return 'text-yellow-400';
    default: return 'text-gray-400';
  }
}

function verifyColor(state: string): string {
  switch (state) {
    case 'verified': return 'text-green-400';
    case 'failed': return 'text-red-400';
    case 'pending': return 'text-yellow-400';
    default: return 'text-gray-400';
  }
}

// ─── Component ─────────────────────────────────────────────────────────

export function HumanProxyPanel() {
  const [status, setStatus] = useState<ControlPlaneStatus | null>(null);
  const [goals, setGoals] = useState<OperationalGoalState[]>([]);
  const [interventions, setInterventions] = useState<InterventionDetail[]>([]);
  const [events, setEvents] = useState<OperationalEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectedGoal, setSelectedGoal] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      // Add service token if available
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('hydi-service-token');
        if (token) headers['x-hydi-service-token'] = token;
      }

      const [statusRes, goalsRes, interventionsRes] = await Promise.all([
        fetch('/api/operator/status', { headers }),
        fetch('/api/operator/goals', { headers }),
        fetch('/api/operator/interventions', { headers }),
      ]);

      if (statusRes.ok) setStatus(await statusRes.json());
      if (goalsRes.ok) {
        const data = await goalsRes.json();
        setGoals(data.goals ?? []);
      }
      if (interventionsRes.ok) {
        const data = await interventionsRes.json();
        setInterventions(data.interventions ?? []);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    }
  }, []);

  // Poll every 2 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Fetch events for selected goal
  useEffect(() => {
    if (!selectedGoal) return;
    const headers: Record<string, string> = {};
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('hydi-service-token');
      if (token) headers['x-hydi-service-token'] = token;
    }
    fetch(`/api/operator/goals/${selectedGoal}/events`, { headers })
      .then((r) => r.json())
      .then((data) => setEvents(data.events ?? []))
      .catch(() => setEvents([]));
  }, [selectedGoal, status]);

  async function handleAction(interventionId: string, action: 'approve' | 'reject' | 'cancel') {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (typeof window !== 'undefined') {
        const token = localStorage.getItem('hydi-service-token');
        if (token) headers['x-hydi-service-token'] = token;
      }
      const res = await fetch(`/api/operator/interventions/${interventionId}/${action}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      const data = await res.json();
      setActionResult(`${action}: ${data.message ?? data.error ?? 'done'}`);
      setTimeout(() => setActionResult(null), 5000);
      fetchData();
    } catch (err) {
      setActionResult(`Error: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  if (error) {
    return (
      <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
        Control plane error: {error}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-200">HYDI Human Proxy</h2>
          <p className="text-xs text-gray-500">Operational status — control plane</p>
        </div>
        <div className="flex gap-4 text-xs">
          <div className="text-center">
            <div className="text-gray-500">Active</div>
            <div className="text-green-400 font-mono">{status?.activeGoals ?? 0}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500">Interventions</div>
            <div className="text-yellow-400 font-mono">{status?.pendingInterventions ?? 0}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500">Completed</div>
            <div className="text-blue-400 font-mono">{status?.completedGoals ?? 0}</div>
          </div>
          <div className="text-center">
            <div className="text-gray-500">Failed</div>
            <div className="text-red-400 font-mono">{status?.failedGoals ?? 0}</div>
          </div>
        </div>
      </div>

      {/* Active Goals */}
      <div className="bg-[#0f0f17] border border-white/[0.06] rounded-lg p-4">
        <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Active Goals</h3>
        {goals.length === 0 ? (
          <p className="text-xs text-gray-600">No active goals</p>
        ) : (
          <div className="space-y-3">
            {goals.map((goal) => (
              <div
                key={goal.goalId}
                className="border border-white/[0.04] rounded-lg p-3 cursor-pointer hover:border-white/[0.08]"
                onClick={() => setSelectedGoal(goal.goalId === selectedGoal ? null : goal.goalId)}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-200">{goal.goalText}</span>
                  <span className={`text-xs font-mono ${statusColor(goal.status)}`}>{goal.status}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                  <div>Action: <span className="text-gray-300">{goal.currentAction ?? '—'}</span></div>
                  <div>Target: <span className="text-gray-300">{goal.targetResource ?? '—'}</span></div>
                  <div>Risk: <span className="text-gray-300">{goal.riskLevel ?? '—'}</span></div>
                  <div>Verified: <span className={verifyColor(goal.verificationState)}>{goal.verificationState}</span></div>
                  <div>Auth: <span className={authColor(goal.authorizationState)}>{goal.authorizationState}</span></div>
                  <div>Elapsed: <span className="text-gray-300">{formatElapsed(goal.elapsedMs)}</span></div>
                </div>
                {goal.warnings.length > 0 && (
                  <div className="mt-2 text-xs text-orange-400">
                    ⚠ {goal.warnings.join(', ')}
                  </div>
                )}
                {goal.blockers.length > 0 && (
                  <div className="mt-1 text-xs text-red-400">
                    ⊘ {goal.blockers.join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Interventions */}
      {interventions.length > 0 && (
        <div className="bg-[#0f0f17] border border-yellow-500/20 rounded-lg p-4">
          <h3 className="text-xs font-semibold text-yellow-400 uppercase mb-3">Intervention Required</h3>
          <div className="space-y-3">
            {interventions.map((intv) => (
              <div key={intv.interventionId} className="border border-yellow-500/10 rounded-lg p-3">
                <div className="text-sm text-gray-200 mb-1">{intv.reason}</div>
                <div className="text-xs text-gray-500 mb-2">
                  Required human action: <span className="text-gray-300">{intv.requiredHumanAction}</span>
                </div>
                <div className="text-xs text-gray-600 mb-3">
                  Resume condition: {intv.resumeCondition}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAction(intv.interventionId, 'approve')}
                    className="px-3 py-1 text-xs bg-green-600/20 text-green-300 border border-green-500/20 rounded hover:bg-green-600/30"
                  >
                    APPROVE
                  </button>
                  <button
                    onClick={() => handleAction(intv.interventionId, 'reject')}
                    className="px-3 py-1 text-xs bg-red-600/20 text-red-300 border border-red-500/20 rounded hover:bg-red-600/30"
                  >
                    REJECT
                  </button>
                  <button
                    onClick={() => handleAction(intv.interventionId, 'cancel')}
                    className="px-3 py-1 text-xs bg-gray-600/20 text-gray-300 border border-gray-500/20 rounded hover:bg-gray-600/30"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Selected Goal Events */}
      {selectedGoal && (
        <div className="bg-[#0f0f17] border border-white/[0.06] rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">
            Events: {selectedGoal}
          </h3>
          {events.length === 0 ? (
            <p className="text-xs text-gray-600">No events recorded</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {events.map((evt) => (
                <div key={evt.eventId} className="text-xs font-mono flex gap-2">
                  <span className="text-gray-600">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                  <span className="text-violet-300">{evt.eventType}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Recent Events */}
      {status && status.recentEvents.length > 0 && (
        <div className="bg-[#0f0f17] border border-white/[0.06] rounded-lg p-4">
          <h3 className="text-xs font-semibold text-gray-400 uppercase mb-3">Recent Events</h3>
          <div className="space-y-1">
            {status.recentEvents.map((evt) => (
              <div key={evt.eventId} className="text-xs font-mono flex gap-2">
                <span className="text-gray-600">{new Date(evt.timestamp).toLocaleTimeString()}</span>
                <span className="text-violet-300">{evt.eventType}</span>
                <span className="text-gray-600 truncate">{evt.goalId}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Result */}
      {actionResult && (
        <div className="text-xs text-blue-400 bg-blue-400/10 border border-blue-400/20 rounded-lg px-3 py-2">
          {actionResult}
        </div>
      )}
    </div>
  );
}
