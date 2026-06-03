import { NextResponse } from 'next/server';
import { AgentPersona, SystemTopology } from '@/lib/portrays/types';

export async function GET(): Promise<NextResponse> {
  const now = new Date().toISOString();

  // Hardcoded canonical cluster snapshot — swap for dynamic PM2/health polling when ready
  const agents: AgentPersona[] = [
    {
      id: 'ursula-frontend',
      name: 'Ursula',
      codename: 'NODE_01',
      role: 'Frontend Gateway',
      status: 'online',
      port: 3001,
      health: { cpu: 0.3, memory: 66, uptime: 3600000, lastCheck: now },
      capabilities: ['Next.js SSR', 'Stripe Checkout', 'Resonate Audio', 'Blame Games', 'ProtoI Wizard'],
      motto: 'I see all threads. I weave them together.',
      color: 'from-violet-400 to-indigo-500',
    },
    {
      id: 'ursula-agent',
      name: 'Ursula Agent',
      codename: 'AGENT_05',
      role: 'Execution Bridge',
      status: 'online',
      port: 3005,
      health: { cpu: 0.1, memory: 43, uptime: 3600000, lastCheck: now },
      capabilities: ['Task Dispatch', 'SSE Streams', 'Heartbeat Monitor', 'Service Bundle'],
      motto: 'The hand that moves when the mind is elsewhere.',
      color: 'from-cyan-400 to-teal-500',
    },
    {
      id: 'heidi',
      name: 'Heidi',
      codename: 'EXEC_00',
      role: 'Executive Orchestrator',
      status: 'online',
      port: 3456,
      health: { cpu: 0.5, memory: 58, uptime: 3600000, lastCheck: now },
      capabilities: ['4-layer Self-awareness', 'SQLite Memory', 'LLM Brain', 'Intent Parsing'],
      motto: 'I reflect, therefore I route.',
      color: 'from-rose-400 to-orange-500',
    },
    {
      id: 'hydi-processor',
      name: 'Hydi Processor',
      codename: 'PIPE_02',
      role: 'Task Pipeline',
      status: 'online',
      port: 0,
      health: { cpu: 0.2, memory: 71, uptime: 3600000, lastCheck: now },
      capabilities: ['Queue Consumer', 'Auto-repair', 'Safety Constraints', 'Task Lifecycle'],
      motto: 'No task left behind. No error unlogged.',
      color: 'from-amber-400 to-yellow-500',
    },
    {
      id: 'hydi-protoforge',
      name: 'ProtoForge HQ',
      codename: 'FORGE_03',
      role: 'Autonomous Construction',
      status: 'online',
      port: 3002,
      health: { cpu: 0.1, memory: 58, uptime: 1800000, lastCheck: now },
      capabilities: ['15 Agent Swarm', 'Financial Engine', 'Autonomy System', 'Demo Scenario'],
      motto: 'We build the future, one container at a time.',
      color: 'from-emerald-400 to-green-500',
    },
  ];

  const topology: SystemTopology = {
    nodes: [
      { id: 'user', label: 'User', group: 'frontend', status: 'online' },
      { id: 'ursula-frontend', label: 'Ursula (3001)', group: 'frontend', status: 'online' },
      { id: 'ursula-agent', label: 'Agent (3005)', group: 'agent', status: 'online' },
      { id: 'heidi', label: 'Heidi (3456)', group: 'orchestrator', status: 'online' },
      { id: 'hydi-processor', label: 'Processor', group: 'processor', status: 'online' },
      { id: 'hydi-protoforge', label: 'ProtoForge (3002)', group: 'integration', status: 'online' },
      { id: 'ollama', label: 'Ollama', group: 'orchestrator', status: 'online' },
    ],
    edges: [
      { from: 'user', to: 'ursula-frontend', label: 'HTTP' },
      { from: 'ursula-frontend', to: 'ursula-agent', label: 'API' },
      { from: 'ursula-frontend', to: 'heidi', label: 'Health' },
      { from: 'ursula-agent', to: 'hydi-processor', label: 'Tasks' },
      { from: 'heidi', to: 'ollama', label: 'LLM' },
      { from: 'hydi-processor', to: 'hydi-protoforge', label: 'Dispatch' },
      { from: 'hydi-protoforge', to: 'ursula-frontend', label: 'Events' },
    ],
  };

  return NextResponse.json({ success: true, agents, topology, timestamp: now });
}
