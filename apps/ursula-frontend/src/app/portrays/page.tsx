'use client';

import React, { useEffect, useState } from 'react';

interface AgentPersona {
  id: string;
  name: string;
  codename: string;
  role: string;
  status: 'online' | 'degraded' | 'offline';
  port: number;
  health: {
    cpu: number;
    memory: number;
    uptime: number;
    lastCheck: string;
  };
  capabilities: string[];
  motto: string;
  color: string;
}

interface TopologyNode {
  id: string;
  label: string;
  group: string;
  status: string;
}

interface TopologyEdge {
  from: string;
  to: string;
  label?: string;
}

interface TopologyData {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
}

interface DashboardData {
  agents: AgentPersona[];
  topology: TopologyData;
  timestamp: string;
}

export default function PortraysDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/portrays/status')
      .then(r => r.json())
      .then(d => {
        if (d.agents) setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const statusDot = (status: string) => {
    switch (status) {
      case 'online': return 'bg-emerald-500 shadow-emerald-500/50';
      case 'degraded': return 'bg-amber-500 shadow-amber-500/50';
      case 'offline': return 'bg-rose-500 shadow-rose-500/50';
      default: return 'bg-neutral-500';
    }
  };

  const groupColor = (group: string) => {
    switch (group) {
      case 'frontend': return 'border-violet-500/30 text-violet-400';
      case 'agent': return 'border-cyan-500/30 text-cyan-400';
      case 'orchestrator': return 'border-rose-500/30 text-rose-400';
      case 'processor': return 'border-amber-500/30 text-amber-400';
      case 'integration': return 'border-emerald-500/30 text-emerald-400';
      default: return 'border-neutral-700 text-neutral-400';
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 p-8">
      <header className="border-b border-neutral-800 pb-6 mb-8">
        <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-fuchsia-400 to-pink-500">
          PORTRAYS // AGENT PERSONA SHOWCASE
        </h1>
        <p className="text-sm text-neutral-400 mt-1">Live system topology and agent identity visualization</p>
      </header>

      {loading ? (
        <div className="text-neutral-500 text-center py-20">Loading agent matrix...</div>
      ) : !data ? (
        <div className="text-neutral-500 text-center py-20">Visualization offline.</div>
      ) : (
        <div className="space-y-10">
          {/* Agent Persona Cards */}
          <div>
            <h2 className="text-lg font-bold text-neutral-200 mb-4">Active Agents</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {data.agents.map(agent => (
                <div key={agent.id} className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 hover:border-neutral-700 transition-colors">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full shadow-lg ${statusDot(agent.status)}`} />
                      <div>
                        <div className="text-sm font-bold text-neutral-100">{agent.name}</div>
                        <div className="text-[10px] text-neutral-500 font-mono">{agent.codename}</div>
                      </div>
                    </div>
                    {agent.port > 0 && (
                      <div className="text-[10px] font-mono text-neutral-500 border border-neutral-800 rounded px-2 py-0.5">
                        :{agent.port}
                      </div>
                    )}
                  </div>

                  <div className={`text-xs font-medium bg-gradient-to-r ${agent.color} bg-clip-text text-transparent mb-3`}>
                    {agent.role.toUpperCase()}
                  </div>

                  <p className="text-xs text-neutral-400 italic mb-4 border-l-2 border-neutral-700 pl-3">
                    &ldquo;{agent.motto}&rdquo;
                  </p>

                  <div className="grid grid-cols-3 gap-2 mb-4">
                    <div className="bg-neutral-950 rounded-lg p-2 text-center border border-neutral-800">
                      <div className="text-xs font-bold text-neutral-200">{agent.health.cpu}%</div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wider">CPU</div>
                    </div>
                    <div className="bg-neutral-950 rounded-lg p-2 text-center border border-neutral-800">
                      <div className="text-xs font-bold text-neutral-200">{agent.health.memory}MB</div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wider">RAM</div>
                    </div>
                    <div className="bg-neutral-950 rounded-lg p-2 text-center border border-neutral-800">
                      <div className="text-xs font-bold text-neutral-200">{Math.floor(agent.health.uptime / 60000)}m</div>
                      <div className="text-[9px] text-neutral-500 uppercase tracking-wider">UP</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {agent.capabilities.map(cap => (
                      <span key={cap} className="text-[10px] bg-neutral-950 text-neutral-400 border border-neutral-800 rounded px-2 py-0.5">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Topology Diagram */}
          <div>
            <h2 className="text-lg font-bold text-neutral-200 mb-4">System Topology</h2>
            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 items-center justify-items-center">
                {data.topology.nodes.map(node => (
                  <div key={node.id} className={`flex flex-col items-center gap-2 p-3 rounded-lg border ${groupColor(node.group)} bg-neutral-950/50`}>
                    <div className={`w-3 h-3 rounded-full ${statusDot(node.status)}`} />
                    <div className="text-xs font-medium text-center">{node.label}</div>
                  </div>
                ))}
              </div>

              <div className="mt-6 border-t border-neutral-800 pt-4">
                <h3 className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-3">Communication Links</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {data.topology.edges.map((edge, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-neutral-400 bg-neutral-950 rounded-lg px-3 py-2 border border-neutral-800">
                      <span className="text-neutral-300 font-medium">{edge.from}</span>
                      <span className="text-neutral-600">→</span>
                      <span className="text-neutral-300 font-medium">{edge.to}</span>
                      {edge.label && <span className="text-[10px] text-neutral-500 ml-auto border border-neutral-800 rounded px-1.5">{edge.label}</span>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="text-[10px] text-neutral-600 text-right">
            Last synced {new Date(data.timestamp).toLocaleTimeString()}
          </div>
        </div>
      )}
    </div>
  );
}
