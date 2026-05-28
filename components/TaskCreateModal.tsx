import React, { useState, useEffect } from 'react';
import { Agent } from './AgentCard';

const TASK_PRESETS: Record<string, string[]> = {
  heidi:      ['process_message', 'reflect', 'summarize_session', 'switch_model'],
  ursula:     ['health_check', 'generate_report', 'alert_review'],
  cascade:    ['classify_events', 'run_rules', 'replay_validation'],
  kilo:       ['generate_hypotheses', 'suggest_fixes', 'analyze_patterns'],
  protoforge: ['validate_policy', 'approve_suggestion', 'audit_actions'],
  hyve:       ['detect_opportunities', 'synthesize_patterns', 'collective_review'],
  rezonate:   ['stem_analysis', 'mix_analysis', 'audio_export', 'nft_mint', 'rights_verify', 'session_recall', 'hardware_map', 'beat_generate'],
  waveformer: ['artist_onboard', 'calculate_royalties', 'distribution_report', 'rights_audit'],
};

interface Props {
  preselectedAgent?: Agent | null;
  onClose: () => void;
  onCreated: () => void;
}

export default function TaskCreateModal({ preselectedAgent, onClose, onCreated }: Props) {
  const [agentId, setAgentId] = useState(preselectedAgent?.id || 'heidi');
  const [taskName, setTaskName] = useState('');
  const [customTask, setCustomTask] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedAgent) setAgentId(preselectedAgent.id);
  }, [preselectedAgent]);

  // Reset task name when agent changes
  useEffect(() => {
    setTaskName('');
    setUseCustom(false);
  }, [agentId]);

  const presets = TASK_PRESETS[agentId] || [];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalTask = useCustom ? customTask.trim() : taskName;
    if (!finalTask) {
      setError('Select or enter a task name');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/agent-manager/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_name: finalTask,
          agent_id: agentId,
          payload: notes ? { notes } : {},
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Dispatch Task</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Agent selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Agent</label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {Object.keys(TASK_PRESETS).map((id) => (
                <option key={id} value={id}>{id.charAt(0).toUpperCase() + id.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Task name — preset or custom */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Task</label>
              <button
                type="button"
                onClick={() => setUseCustom((v) => !v)}
                className="text-xs text-indigo-600 hover:underline"
              >
                {useCustom ? 'Use preset' : 'Custom task'}
              </button>
            </div>

            {useCustom ? (
              <input
                type="text"
                value={customTask}
                onChange={(e) => setCustomTask(e.target.value)}
                placeholder="e.g. analyze_stems"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {presets.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setTaskName(p)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                      taskName === p
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                    }`}
                  >
                    {p.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Optional notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Additional context for the agent…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Dispatching…' : 'Dispatch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
