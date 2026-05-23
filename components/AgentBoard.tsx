import React, { useEffect, useState, useCallback } from 'react';
import AgentCard, { Agent } from './AgentCard';

interface SystemInfo {
  current_status: string;
  jobs_queued: number;
  jobs_failed: number;
  trend_status: string;
}

interface Props {
  onDispatch: (agent: Agent) => void;
}

export default function AgentBoard({ onDispatch }: Props) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState('ALL');

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-manager/agents');
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setAgents(data.agents);
      setSystem(data.system);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 15000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  const layers = ['ALL', ...Array.from(new Set(agents.map((a) => a.layer)))];
  const visible = layerFilter === 'ALL' ? agents : agents.filter((a) => a.layer === layerFilter);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400">
        Loading agents…
      </div>
    );
  }

  return (
    <div>
      {/* System health bar */}
      {system && (
        <div className={`mb-4 px-4 py-2 rounded-lg text-sm flex items-center gap-3 ${
          system.current_status === 'OK' ? 'bg-green-50 text-green-800' :
          system.current_status === 'WARNING' ? 'bg-yellow-50 text-yellow-800' :
          'bg-red-50 text-red-800'
        }`}>
          <span className="font-semibold">System {system.current_status}</span>
          <span className="text-gray-500">·</span>
          <span>{system.jobs_queued} queued</span>
          <span className="text-gray-500">·</span>
          <span>{system.jobs_failed} failed</span>
          <span className="text-gray-500">·</span>
          <span>Trend: {system.trend_status}</span>
          <button
            onClick={fetchAgents}
            className="ml-auto text-xs underline opacity-70 hover:opacity-100"
          >
            Refresh
          </button>
        </div>
      )}

      {error && (
        <div className="mb-4 px-4 py-2 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* Layer filter tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {layers.map((layer) => (
          <button
            key={layer}
            onClick={() => setLayerFilter(layer)}
            className={`px-3 py-1 text-sm rounded-full border transition-colors ${
              layerFilter === layer
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
            }`}
          >
            {layer}
          </button>
        ))}
      </div>

      {/* Agent grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {visible.map((agent) => (
          <AgentCard key={agent.id} agent={agent} onDispatch={onDispatch} />
        ))}
      </div>
    </div>
  );
}
