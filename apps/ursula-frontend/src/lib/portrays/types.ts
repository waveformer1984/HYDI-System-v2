export interface AgentPersona {
  id: string;
  name: string;
  codename: string;
  role: string;
  status: 'online' | 'degraded' | 'offline';
  port: number;
  health: {
    cpu: number;
    memory: number; // MB
    uptime: number; // ms
    lastCheck: string;
  };
  capabilities: string[];
  motto: string;
  color: string; // tailwind gradient slug
}

export interface SystemTopology {
  nodes: Array<{
    id: string;
    label: string;
    group: 'frontend' | 'agent' | 'orchestrator' | 'processor' | 'integration';
    status: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label?: string;
  }>;
}

export interface PortraysDashboard {
  agents: AgentPersona[];
  topology: SystemTopology;
  timestamp: string;
}
