import React from 'react';

interface AgentStats {
  pending: number;
  completed: number;
  failed: number;
  success_rate: number | null;
  last_active: string | null;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  layer: string;
  capabilities: string[];
  status: 'healthy' | 'active' | 'idle' | 'degraded' | 'error';
  stats: AgentStats;
}

const STATUS_CONFIG = {
  healthy: { dot: 'bg-green-500', badge: 'bg-green-100 text-green-800', label: 'Healthy' },
  active:  { dot: 'bg-blue-500 animate-pulse', badge: 'bg-blue-100 text-blue-800', label: 'Active' },
  idle:    { dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600', label: 'Idle' },
  degraded:{ dot: 'bg-yellow-500', badge: 'bg-yellow-100 text-yellow-800', label: 'Degraded' },
  error:   { dot: 'bg-red-500', badge: 'bg-red-100 text-red-800', label: 'Error' },
};

const LAYER_COLORS: Record<string, string> = {
  CORE:     'border-l-purple-500',
  PIPELINE: 'border-l-blue-500',
  CREATIVE: 'border-l-pink-500',
};

interface Props {
  agent: Agent;
  onDispatch: (agent: Agent) => void;
}

export default function AgentCard({ agent, onDispatch }: Props) {
  const sc = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
  const borderColor = LAYER_COLORS[agent.layer] ?? 'border-l-gray-400';

  const lastActive = agent.stats.last_active
    ? new Date(agent.stats.last_active).toLocaleString()
    : 'Never';

  return (
    <div className={`bg-white border border-gray-200 border-l-4 ${borderColor} rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${sc.dot}`} />
            <h3 className="font-semibold text-gray-900">{agent.name}</h3>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{agent.role}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sc.badge}`}>
          {sc.label}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div className="bg-yellow-50 rounded p-1.5">
          <div className="text-lg font-bold text-yellow-700">{agent.stats.pending}</div>
          <div className="text-xs text-yellow-600">Pending</div>
        </div>
        <div className="bg-green-50 rounded p-1.5">
          <div className="text-lg font-bold text-green-700">{agent.stats.completed}</div>
          <div className="text-xs text-green-600">Done</div>
        </div>
        <div className="bg-red-50 rounded p-1.5">
          <div className="text-lg font-bold text-red-700">{agent.stats.failed}</div>
          <div className="text-xs text-red-600">Failed</div>
        </div>
      </div>

      {agent.stats.success_rate !== null && (
        <div className="mb-3">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>Success rate</span>
            <span className="font-medium text-gray-700">{agent.stats.success_rate}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div
              className="bg-green-500 h-1.5 rounded-full"
              style={{ width: `${agent.stats.success_rate}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1 mb-3">
        {agent.capabilities.slice(0, 3).map((cap) => (
          <span key={cap} className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
            {cap.replace(/_/g, ' ')}
          </span>
        ))}
        {agent.capabilities.length > 3 && (
          <span className="text-xs text-gray-400">+{agent.capabilities.length - 3} more</span>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">Last: {lastActive}</span>
        <button
          onClick={() => onDispatch(agent)}
          className="text-xs px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
        >
          Dispatch
        </button>
      </div>
    </div>
  );
}
