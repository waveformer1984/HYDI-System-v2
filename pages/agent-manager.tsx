import { useState, useCallback } from 'react';
import Link from 'next/link';
import AgentBoard from '../components/AgentBoard';
import TaskQueue from '../components/TaskQueue';
import TaskCreateModal from '../components/TaskCreateModal';
import { Agent } from '../components/AgentCard';

type Tab = 'agents' | 'tasks' | 'rezonate';

const REZONATE_TASKS = [
  { id: 'stem_analysis',   label: 'Stem Analysis',   desc: 'Separate and analyze individual track stems' },
  { id: 'mix_analysis',    label: 'Mix Analysis',     desc: 'Evaluate frequency balance, dynamics, and EQ' },
  { id: 'audio_export',    label: 'Audio Export',     desc: 'Export session to specified format and destination' },
  { id: 'beat_generate',   label: 'Beat Generate',    desc: 'AI-assisted beat creation from prompt or reference' },
  { id: 'nft_mint',        label: 'NFT Mint',         desc: 'Tokenize audio asset on-chain with metadata' },
  { id: 'rights_verify',   label: 'Rights Verify',    desc: 'Verify ownership and licensing chain' },
  { id: 'session_recall',  label: 'Session Recall',   desc: 'Restore previous Rezonate session state' },
  { id: 'hardware_map',    label: 'Hardware Map',     desc: 'Map connected hardware controllers (DDJ, MIDI, etc.)' },
];

export default function AgentManager() {
  const [tab, setTab] = useState<Tab>('agents');
  const [modalOpen, setModalOpen] = useState(false);
  const [preselectedAgent, setPreselectedAgent] = useState<Agent | null>(null);
  const [taskRefreshKey, setTaskRefreshKey] = useState(0);
  const [rezonateStatus, setRezonateStatus] = useState<Record<string, string>>({});
  const [rezonateLoading, setRezonateLoading] = useState<string | null>(null);

  const handleDispatch = useCallback((agent: Agent) => {
    setPreselectedAgent(agent);
    setModalOpen(true);
  }, []);

  const handleNewTask = useCallback(() => {
    setPreselectedAgent(null);
    setModalOpen(true);
  }, []);

  const handleCreated = useCallback(() => {
    setTaskRefreshKey((k) => k + 1);
    setTab('tasks');
  }, []);

  const dispatchRezonateTask = async (taskId: string) => {
    setRezonateLoading(taskId);
    try {
      const res = await fetch('/api/agent-manager/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_name: taskId, agent_id: 'rezonate' }),
      });
      const data = await res.json();
      setRezonateStatus((prev) => ({
        ...prev,
        [taskId]: data.ok ? 'dispatched' : 'error',
      }));
      if (data.ok) setTaskRefreshKey((k) => k + 1);
    } catch {
      setRezonateStatus((prev) => ({ ...prev, [taskId]: 'error' }));
    } finally {
      setRezonateLoading(null);
    }
  };

  const tabs: { id: Tab; label: string }[] = [
    { id: 'agents',   label: 'Agents' },
    { id: 'tasks',    label: 'Tasks' },
    { id: 'rezonate', label: 'Rezonate' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top nav */}
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-4">
        <Link href="/" className="text-gray-500 hover:text-gray-800 text-sm">
          ← Heidi
        </Link>
        <span className="text-gray-300">|</span>
        <h1 className="font-semibold text-gray-900">ProtoForge Agent Manager</h1>
        <div className="ml-auto">
          <button
            onClick={handleNewTask}
            className="px-4 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 transition-colors"
          >
            + New Task
          </button>
        </div>
      </nav>

      {/* Tab bar */}
      <div className="bg-white border-b border-gray-200 px-6">
        <div className="flex gap-0">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {tab === 'agents' && (
          <AgentBoard onDispatch={handleDispatch} />
        )}

        {tab === 'tasks' && (
          <div key={taskRefreshKey}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold text-gray-800">Task Queue</h2>
              <button
                onClick={handleNewTask}
                className="text-sm px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                + Dispatch
              </button>
            </div>
            <TaskQueue />
          </div>
        )}

        {tab === 'rezonate' && (
          <div>
            <div className="mb-5">
              <h2 className="text-base font-semibold text-gray-800">Rezonate DAW Node</h2>
              <p className="text-sm text-gray-500 mt-1">
                One-click dispatch for Rezonate audio tasks. Results appear in the Tasks tab.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {REZONATE_TASKS.map((task) => {
                const status = rezonateStatus[task.id];
                return (
                  <div key={task.id} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
                    <h3 className="font-medium text-gray-900 text-sm mb-1">{task.label}</h3>
                    <p className="text-xs text-gray-500 mb-3">{task.desc}</p>
                    <button
                      onClick={() => dispatchRezonateTask(task.id)}
                      disabled={rezonateLoading === task.id}
                      className={`w-full text-xs py-1.5 rounded-lg font-medium transition-colors ${
                        status === 'dispatched'
                          ? 'bg-green-100 text-green-700 cursor-default'
                          : status === 'error'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-pink-600 text-white hover:bg-pink-700 disabled:opacity-50'
                      }`}
                    >
                      {rezonateLoading === task.id ? 'Sending…' :
                       status === 'dispatched' ? '✓ Dispatched' :
                       status === 'error' ? 'Error — Retry' :
                       'Run'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {/* Dispatch modal */}
      {modalOpen && (
        <TaskCreateModal
          preselectedAgent={preselectedAgent}
          onClose={() => setModalOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}
