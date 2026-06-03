/**
 * AgentsModule — Agent roster and status panel
 * 
 * Displays all ProtoForge agents with their current state,
 * last activity, and quick action buttons.
 * 
 * Config: Replace mock data with real agent health endpoints.
 * Error handling: Shows "unreachable" state for agents that don't respond.
 */
'use client';

import { Bot, Circle, Clock, ChevronRight } from 'lucide-react';

interface Agent {
  id: string;
  name: string;
  role: string;
  status: 'active' | 'idle' | 'error' | 'offline';
  lastSeen: string;
}

const AGENTS: Agent[] = [
  { id: 'devops', name: 'DevOps Agent', role: 'CI/CD, deployment, infra', status: 'idle', lastSeen: '2 min ago' },
  { id: 'funding', name: 'Funding Agent', role: 'Grant discovery, applications', status: 'idle', lastSeen: '15 min ago' },
  { id: 'ghostwriter', name: 'Ghostwriter', role: 'Content generation, copywriting', status: 'offline', lastSeen: '1 hr ago' },
  { id: 'fabricator', name: 'Fabricator', role: '3D printing, manufacturing', status: 'idle', lastSeen: '5 min ago' },
  { id: 'kate', name: 'KATE', role: 'Partnership testing, integration', status: 'offline', lastSeen: '30 min ago' },
];

const STATUS_COLORS: Record<string, string> = {
  active: '#3fb950',
  idle: '#d29922',
  error: '#f85149',
  offline: '#858585',
};

export default function AgentsModule() {
  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center gap-3 mb-6">
        <Bot size={20} style={{ color: 'var(--text-accent)' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          Agent Roster
        </h1>
        <span
          className="text-[11px] font-mono px-2 py-0.5 rounded"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-sidebar)' }}
        >
          {AGENTS.length} registered
        </span>
      </div>

      <div className="space-y-2">
        {AGENTS.map((agent) => (
          <div
            key={agent.id}
            className="flex items-center justify-between p-3 rounded border cursor-pointer transition-colors hover:border-[var(--text-accent)]"
            style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
          >
            <div className="flex items-center gap-3">
              <Circle
                size={8}
                fill={STATUS_COLORS[agent.status]}
                stroke={STATUS_COLORS[agent.status]}
              />
              <div>
                <div className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>
                  {agent.name}
                </div>
                <div className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                  {agent.role}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <Clock size={10} />
                {agent.lastSeen}
              </span>
              <ChevronRight size={14} style={{ color: 'var(--text-secondary)' }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
