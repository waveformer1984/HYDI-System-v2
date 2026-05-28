import React, { useEffect, useState, useCallback } from 'react';

interface Task {
  id: string;
  session_id: string;
  task_name: string;
  status: 'pending' | 'completed' | 'failed';
  payload: Record<string, any>;
  created_at: string;
}

const STATUS_STYLES = {
  pending:   'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  failed:    'bg-red-100 text-red-800',
};

export default function TaskQueue() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const PAGE_SIZE = 20;

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(page * PAGE_SIZE),
        status: statusFilter,
        agent_id: agentFilter,
      });
      const res = await fetch(`/api/agent-manager/tasks?${params}`);
      const data = await res.json();
      if (data.ok) {
        setTasks(data.tasks || []);
        setTotal(data.total || 0);
      }
    } finally {
      setLoading(false);
    }
  }, [statusFilter, agentFilter, page]);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Reset to page 0 when filters change
  useEffect(() => { setPage(0); }, [statusFilter, agentFilter]);

  const handleAction = async (id: string, action: 'cancel' | 'retry') => {
    setActionLoading(id);
    try {
      await fetch('/api/agent-manager/tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      await fetchTasks();
    } finally {
      setActionLoading(null);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <div>
          <label className="text-xs text-gray-500 mr-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-gray-500 mr-1">Agent</label>
          <select
            value={agentFilter}
            onChange={(e) => setAgentFilter(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            <option value="all">All</option>
            {['heidi','ursula','cascade','kilo','protoforge','hyve','rezonate','waveformer'].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <span className="text-xs text-gray-400 ml-auto">{total} total</span>
        <button
          onClick={fetchTasks}
          className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Task</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Agent</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Status</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Created</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-gray-400">Loading…</td>
              </tr>
            )}
            {!loading && tasks.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-gray-400">No tasks found</td>
              </tr>
            )}
            {!loading && tasks.map((task) => (
              <tr key={task.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">
                  <div className="font-medium text-gray-900">{task.task_name}</div>
                  <div className="text-xs text-gray-400 font-mono">{task.id.slice(0, 8)}…</div>
                </td>
                <td className="px-4 py-2">
                  <span className="text-gray-700">{task.payload?.agent_id || '—'}</span>
                </td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[task.status]}`}>
                    {task.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-gray-500 text-xs">
                  {new Date(task.created_at).toLocaleString()}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    {task.status === 'pending' && (
                      <button
                        onClick={() => handleAction(task.id, 'cancel')}
                        disabled={actionLoading === task.id}
                        className="text-xs text-red-600 hover:underline disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    )}
                    {task.status === 'failed' && (
                      <button
                        onClick={() => handleAction(task.id, 'retry')}
                        disabled={actionLoading === task.id}
                        className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
          >
            Prev
          </button>
          <span className="text-gray-500">Page {page + 1} / {totalPages}</span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
