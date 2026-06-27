/**
 * NodeMeshModule — HYDRA Distributed Compute Mesh
 *
 * Shows connected worker nodes, coordinator status, heartbeats,
 * and task distribution across the mesh.
 *
 * TEST mode: Shows mock node data.
 * LIVE mode: Pings coordinator API at :8002/nodes for real status.
 *
 * Config: Set NEXT_PUBLIC_COORDINATOR_URL for live data.
 * Error handling: Shows offline state when coordinator unreachable.
 */
'use client';

import { useState, useEffect } from 'react';
import {
  Server,
  Wifi,
  Activity,
  Cpu,
  HardDrive,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Zap,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';

interface NodeInfo {
  id: string;
  hostname: string;
  ip: string;
  cores: number;
  ram_gb: number;
  status: 'online' | 'offline' | 'stale';
  last_heartbeat: string;
  role: string;
}

const MOCK_NODES: NodeInfo[] = [
  {
    id: 'node-main',
    hostname: 'DESKTOP-I719OIN',
    ip: '192.168.86.36',
    cores: 12,
    ram_gb: 16,
    status: 'online',
    last_heartbeat: new Date().toISOString(),
    role: 'coordinator',
  },
  {
    id: 'node-frank',
    hostname: 'jordan-pc',
    ip: '192.168.86.33',
    cores: 4,
    ram_gb: 8,
    status: 'online',
    last_heartbeat: new Date().toISOString(),
    role: 'worker',
  },
];

export default function NodeMeshModule() {
  const { isLive } = useMode();
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coordinatorUrl = process.env.NEXT_PUBLIC_COORDINATOR_URL || 'http://localhost:8002';

  const fetchNodes = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${coordinatorUrl}/nodes`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNodes(data.nodes || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reach coordinator');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isLive) fetchNodes();
  }, [isLive]);

  const display = isLive ? nodes : MOCK_NODES;
  const onlineCount = display.filter(n => n.status === 'online').length;
  const totalCores = display.reduce((s, n) => s + n.cores, 0);
  const totalRam = display.reduce((s, n) => s + n.ram_gb, 0);

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Server size={20} style={{ color: '#bc8cff' }} />
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
            HYDRA Node Mesh
          </h1>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: '#bc8cff15', color: '#bc8cff' }}>
            {display.length} nodes
          </span>
        </div>
        {isLive && (
          <button
            onClick={fetchNodes}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-mono hover:bg-white/5"
            style={{ color: 'var(--text-accent)' }}
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      </div>

      <p className="text-sm mb-6" style={{ color: 'var(--text-secondary)' }}>
        Distributed compute mesh — coordinator + worker nodes across LAN.
      </p>

      {/* Cluster Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { icon: <Server size={14} />, label: 'Nodes', value: display.length, color: '#bc8cff' },
          { icon: <Wifi size={14} />, label: 'Online', value: onlineCount, color: '#3fb950' },
          { icon: <Cpu size={14} />, label: 'Total Cores', value: totalCores, color: '#58a6ff' },
          { icon: <HardDrive size={14} />, label: 'Total RAM', value: `${totalRam}GB`, color: '#d29922' },
        ].map(s => (
          <div key={s.label} className="p-3 rounded-md border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <div className="text-lg font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Node Cards */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold" style={{ color: 'var(--text-active)' }}>Connected Nodes</h2>
        {display.length === 0 ? (
          <div className="rounded-md p-8 border text-center" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
            <Server size={32} className="mx-auto mb-3" style={{ color: 'var(--text-secondary)' }} />
            <p className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>No nodes connected</p>
          </div>
        ) : (
          display.map(node => (
            <div
              key={node.id}
              className="rounded-md p-4 border"
              style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {node.role === 'coordinator' ? (
                    <Zap size={14} style={{ color: '#d29922' }} />
                  ) : (
                    <Server size={14} style={{ color: '#bc8cff' }} />
                  )}
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>
                    {node.hostname}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{
                    background: node.role === 'coordinator' ? '#d2992215' : '#bc8cff15',
                    color: node.role === 'coordinator' ? '#d29922' : '#bc8cff',
                  }}>
                    {node.role}
                  </span>
                </div>
                <span className="flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded" style={{
                  color: node.status === 'online' ? '#3fb950' : '#f85149',
                  background: node.status === 'online' ? '#3fb95015' : '#f8514915',
                }}>
                  {node.status === 'online' ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                  {node.status}
                </span>
              </div>
              <div className="flex items-center gap-4 text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <span>{node.ip}</span>
                <span>{node.cores} cores</span>
                <span>{node.ram_gb}GB RAM</span>
                <span className="flex items-center gap-1">
                  <Clock size={9} />
                  {new Date(node.last_heartbeat).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-md border text-[11px] font-mono" style={{ background: '#f8514915', borderColor: '#f8514930', color: '#f85149' }}>
          Coordinator unreachable: {error}
        </div>
      )}
    </div>
  );
}
