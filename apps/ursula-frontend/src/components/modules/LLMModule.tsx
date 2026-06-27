/**
 * LLM Module — Local Model Gateway
 *
 * Chat with your own models (Ollama), generate completions, decompose objectives,
 * and monitor model health — all from the Ursula dashboard.
 *
 * TEST mode: Shows demo model list and mock responses.
 * LIVE mode: Connects to Project Ops Model Gateway API.
 *
 * Config: Set NEXT_PUBLIC_PROJECT_OPS_URL for live data.
 * Error handling: Graceful fallback with status banners.
 */
'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Brain,
  Send,
  Cpu,
  Activity,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Trash2,
  Copy,
  Server,
  MessageSquare,
  Code,
  Target,
} from 'lucide-react';
import { useMode } from '@/lib/mode-context';
import {
  listModels as apiListModels,
  modelsHealth,
  modelChat,
  modelGenerate,
  llmDecompose,
  llmIntakeParse,
  type ModelInfo,
  type ChatMessage,
  type LLMResponse,
  type ModelsHealthResponse,
} from '@/lib/api';

// =============================================================================
// Mock Data (test mode)
// =============================================================================

const MOCK_MODELS: ModelInfo[] = [
  { name: 'gemma3:4b', family: 'gemma', size_gb: 3.3, modified_at: '2026-02-08T12:00:00Z', digest: 'a2af6cc3eb7f', is_default: true, provider: 'ollama', capabilities: ['generate', 'chat', 'reasoning', 'decompose', 'intake'] },
  { name: 'llama3.2:latest', family: 'llama', size_gb: 2.0, modified_at: '2026-02-08T12:00:00Z', digest: 'a80c4f17acd5', is_default: false, provider: 'ollama', capabilities: ['generate', 'chat', 'reasoning', 'decompose', 'intake'] },
];

const MOCK_HEALTH: ModelsHealthResponse = {
  status: 'healthy',
  providers: [{ name: 'ollama', available: true, version: '0.6.2', url: 'http://localhost:11434', default_model: 'gemma3:4b', default_model_loaded: true, model_count: 2 }],
  timestamp: new Date().toISOString(),
};

// =============================================================================
// Types
// =============================================================================

interface ChatEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
  model?: string;
  duration_ms?: number;
  timestamp: string;
}

type Tab = 'chat' | 'generate' | 'decompose' | 'models';

// =============================================================================
// Component
// =============================================================================

export default function LLMModule() {
  const { isLive } = useMode();

  // Model state
  const [models, setModels] = useState<ModelInfo[]>(MOCK_MODELS);
  const [health, setHealth] = useState<ModelsHealthResponse>(MOCK_HEALTH);
  const [selectedModel, setSelectedModel] = useState<string>('gemma3:4b');

  // UI state
  const [tab, setTab] = useState<Tab>('chat');
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Chat state
  const [chatHistory, setChatHistory] = useState<ChatEntry[]>([]);
  const [chatInput, setChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Generate state
  const [generatePrompt, setGeneratePrompt] = useState('');
  const [generateResult, setGenerateResult] = useState<string | null>(null);
  const [generateMeta, setGenerateMeta] = useState<{ model: string; duration_ms: number } | null>(null);

  // Decompose state
  const [decomposeInput, setDecomposeInput] = useState('');
  const [decomposeResult, setDecomposeResult] = useState<Record<string, unknown> | null>(null);
  const [decomposeMeta, setDecomposeMeta] = useState<{ duration_ms: number } | null>(null);

  // Fetch models + health
  const fetchModels = useCallback(async () => {
    if (!isLive) {
      setModels(MOCK_MODELS);
      setHealth(MOCK_HEALTH);
      return;
    }

    const [modelsRes, healthRes] = await Promise.all([
      apiListModels(),
      modelsHealth(),
    ]);

    if (modelsRes.data?.models) {
      setModels(modelsRes.data.models);
      const def = modelsRes.data.default_model;
      if (def) setSelectedModel(def);
    } else {
      setApiError(modelsRes.error || 'Failed to fetch models');
    }

    if (healthRes.data) {
      setHealth(healthRes.data);
    }
  }, [isLive]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  // --- Chat ---
  const handleChat = async () => {
    if (!chatInput.trim()) return;

    const userEntry: ChatEntry = { role: 'user', content: chatInput.trim(), timestamp: new Date().toISOString() };
    setChatHistory(prev => [...prev, userEntry]);
    setChatInput('');
    setLoading(true);

    if (!isLive) {
      // Mock response
      setTimeout(() => {
        setChatHistory(prev => [...prev, {
          role: 'assistant',
          content: `[TEST MODE] Echo: "${userEntry.content}"\n\nThis is a mock response. Switch to LIVE mode to use your local models.`,
          model: selectedModel,
          duration_ms: 42,
          timestamp: new Date().toISOString(),
        }]);
        setLoading(false);
      }, 500);
      return;
    }

    const messages: ChatMessage[] = [
      ...chatHistory.map(e => ({ role: e.role, content: e.content })),
      { role: 'user' as const, content: userEntry.content },
    ];

    const res = await modelChat(selectedModel, messages);
    setLoading(false);

    if (res.data?.success) {
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: res.data!.response,
        model: res.data!.model,
        duration_ms: res.data!.duration_ms,
        timestamp: new Date().toISOString(),
      }]);
    } else {
      setChatHistory(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${res.data?.error || res.error || 'Unknown error'}`,
        timestamp: new Date().toISOString(),
      }]);
    }
  };

  // --- Generate ---
  const handleGenerate = async () => {
    if (!generatePrompt.trim()) return;
    setLoading(true);
    setGenerateResult(null);
    setGenerateMeta(null);

    if (!isLive) {
      setTimeout(() => {
        setGenerateResult(`[TEST MODE] Generated output for: "${generatePrompt.slice(0, 50)}..."\n\nSwitch to LIVE mode to use your local models.`);
        setGenerateMeta({ model: selectedModel, duration_ms: 42 });
        setLoading(false);
      }, 500);
      return;
    }

    const res = await modelGenerate(selectedModel, generatePrompt);
    setLoading(false);

    if (res.data?.success) {
      setGenerateResult(res.data.response);
      setGenerateMeta({ model: res.data.model, duration_ms: res.data.duration_ms });
    } else {
      setGenerateResult(`Error: ${res.data?.error || res.error}`);
    }
  };

  // --- Decompose ---
  const handleDecompose = async () => {
    if (!decomposeInput.trim()) return;
    setLoading(true);
    setDecomposeResult(null);
    setDecomposeMeta(null);

    if (!isLive) {
      setTimeout(() => {
        setDecomposeResult({
          objective: decomposeInput,
          phases: [
            { title: 'Phase 1: Research', effort_minutes: 30, agent: 'agent_allowed', gate: false },
            { title: 'Phase 2: Implementation', effort_minutes: 120, agent: 'agent_only', gate: true, proof: 'Tests pass' },
            { title: 'Phase 3: Review', effort_minutes: 30, agent: 'human_only', gate: true, proof: 'Approved' },
          ],
          risk_level: 'medium',
          total_estimated_minutes: 180,
        } as Record<string, unknown>);
        setDecomposeMeta({ duration_ms: 42 });
        setLoading(false);
      }, 500);
      return;
    }

    const res = await llmDecompose(decomposeInput);
    setLoading(false);

    if (res.data?.success && res.data.data) {
      setDecomposeResult(res.data.data as Record<string, unknown>);
      setDecomposeMeta({ duration_ms: res.data.duration_ms });
    } else {
      setDecomposeResult({ error: res.data?.error || res.error } as Record<string, unknown>);
    }
  };

  // --- Helpers ---
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const healthColor = health.status === 'healthy' ? '#3fb950' : health.status === 'degraded' ? '#d29922' : '#f85149';

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div className="h-full overflow-y-auto p-6" style={{ background: 'var(--bg-editor)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Brain size={20} style={{ color: '#bc8cff' }} />
        <h1 className="text-lg font-bold" style={{ color: 'var(--text-active)' }}>
          Model Gateway
        </h1>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: isLive ? '#3fb95015' : '#8b949e20', color: isLive ? '#3fb950' : '#8b949e' }}>
          {isLive ? 'LIVE' : 'TEST'}
        </span>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded flex items-center gap-1" style={{ background: `${healthColor}15`, color: healthColor }}>
          <Activity size={9} /> {health.status.toUpperCase()}
        </span>
        <span className="text-[10px] font-mono ml-auto" style={{ color: 'var(--text-secondary)' }}>
          {models.length} models • {selectedModel}
        </span>
      </div>

      {apiError && (
        <div className="mb-4 p-3 rounded-md border text-[11px] font-mono" style={{ background: '#f8514910', borderColor: '#f8514940', color: '#f85149' }}>
          {apiError}
        </div>
      )}

      {/* Model Selector */}
      <div className="flex items-center gap-2 mb-4">
        <label className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>Model:</label>
        <select
          value={selectedModel}
          onChange={e => setSelectedModel(e.target.value)}
          className="px-2 py-1 rounded text-[11px] font-mono"
          style={{ background: 'var(--bg-sidebar)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }}
        >
          {models.map(m => (
            <option key={m.name} value={m.name}>
              {m.name} ({m.size_gb}GB) {m.is_default ? '★' : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6">
        {([
          { id: 'chat' as Tab, icon: <MessageSquare size={11} />, label: 'Chat' },
          { id: 'generate' as Tab, icon: <Code size={11} />, label: 'Generate' },
          { id: 'decompose' as Tab, icon: <Target size={11} />, label: 'Decompose' },
          { id: 'models' as Tab, icon: <Server size={11} />, label: 'Models' },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-3 py-1.5 rounded text-[11px] font-mono font-semibold transition-colors"
            style={{
              background: tab === t.id ? '#bc8cff20' : 'transparent',
              color: tab === t.id ? '#bc8cff' : 'var(--text-secondary)',
              border: '1px solid var(--border-color)',
            }}
          >
            <span className="flex items-center gap-1">{t.icon} {t.label}</span>
          </button>
        ))}
      </div>

      {/* ─── Chat Tab ─── */}
      {tab === 'chat' && (
        <div className="flex flex-col" style={{ height: 'calc(100vh - 320px)' }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-3 mb-4 pr-2">
            {chatHistory.length === 0 && (
              <div className="text-center py-12" style={{ color: 'var(--text-secondary)' }}>
                <Brain size={40} style={{ opacity: 0.2, margin: '0 auto' }} />
                <p className="mt-3 text-sm">Start a conversation with {selectedModel}</p>
              </div>
            )}
            {chatHistory.map((entry, i) => (
              <div key={i} className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className="max-w-[80%] p-3 rounded-lg text-[12px] font-mono whitespace-pre-wrap"
                  style={{
                    background: entry.role === 'user' ? '#bc8cff20' : 'var(--bg-sidebar)',
                    color: 'var(--text-active)',
                    border: '1px solid var(--border-color)',
                  }}
                >
                  {entry.content}
                  {entry.duration_ms != null && (
                    <div className="flex items-center gap-2 mt-2 text-[9px]" style={{ color: 'var(--text-secondary)' }}>
                      <span><Clock size={8} /> {entry.duration_ms}ms</span>
                      {entry.model && <span><Cpu size={8} /> {entry.model}</span>}
                      <button onClick={() => copyToClipboard(entry.content)} className="ml-auto opacity-50 hover:opacity-100"><Copy size={8} /></button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {loading && tab === 'chat' && (
              <div className="flex justify-start">
                <div className="p-3 rounded-lg text-[11px] font-mono animate-pulse" style={{ background: 'var(--bg-sidebar)', color: '#bc8cff', border: '1px solid var(--border-color)' }}>
                  Thinking...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleChat()}
              placeholder={`Message ${selectedModel}...`}
              className="flex-1 px-3 py-2 rounded text-sm font-mono"
              style={{ background: 'var(--bg-sidebar)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }}
              disabled={loading}
            />
            <button
              onClick={handleChat}
              disabled={loading || !chatInput.trim()}
              className="p-2 rounded transition-colors"
              style={{ background: '#bc8cff20', color: '#bc8cff' }}
            >
              <Send size={16} />
            </button>
            <button
              onClick={() => setChatHistory([])}
              className="p-2 rounded transition-colors"
              style={{ background: '#f8514915', color: '#f85149' }}
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ─── Generate Tab ─── */}
      {tab === 'generate' && (
        <div className="space-y-4">
          <textarea
            value={generatePrompt}
            onChange={e => setGeneratePrompt(e.target.value)}
            placeholder="Enter a prompt for text generation..."
            rows={6}
            className="w-full px-3 py-2 rounded text-sm font-mono resize-y"
            style={{ background: 'var(--bg-sidebar)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleGenerate}
              disabled={loading || !generatePrompt.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded text-sm font-mono transition-colors"
              style={{ background: '#bc8cff20', color: '#bc8cff' }}
            >
              <Zap size={14} /> Generate
            </button>
            {generateMeta && (
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                {generateMeta.model} • {generateMeta.duration_ms}ms
              </span>
            )}
          </div>
          {loading && tab === 'generate' && (
            <div className="p-3 rounded-md border text-[11px] font-mono animate-pulse" style={{ background: '#bc8cff10', borderColor: '#bc8cff40', color: '#bc8cff' }}>
              Generating...
            </div>
          )}
          {generateResult && (
            <div className="relative">
              <pre className="p-4 rounded-md border text-[12px] font-mono whitespace-pre-wrap overflow-auto max-h-[400px]" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--text-active)' }}>
                {generateResult}
              </pre>
              <button onClick={() => copyToClipboard(generateResult)} className="absolute top-2 right-2 p-1 rounded opacity-50 hover:opacity-100" style={{ color: 'var(--text-secondary)' }}>
                <Copy size={12} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Decompose Tab ─── */}
      {tab === 'decompose' && (
        <div className="space-y-4">
          <p className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            Enter an objective and the LLM will decompose it into execution phases with effort estimates, agent assignments, and quality gates.
          </p>
          <textarea
            value={decomposeInput}
            onChange={e => setDecomposeInput(e.target.value)}
            placeholder="e.g., Deploy the payment gateway to production with full test coverage"
            rows={3}
            className="w-full px-3 py-2 rounded text-sm font-mono resize-y"
            style={{ background: 'var(--bg-sidebar)', color: 'var(--text-active)', border: '1px solid var(--border-color)' }}
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleDecompose}
              disabled={loading || !decomposeInput.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded text-sm font-mono transition-colors"
              style={{ background: '#bc8cff20', color: '#bc8cff' }}
            >
              <Target size={14} /> Decompose
            </button>
            {decomposeMeta && (
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                {decomposeMeta.duration_ms}ms
              </span>
            )}
          </div>
          {loading && tab === 'decompose' && (
            <div className="p-3 rounded-md border text-[11px] font-mono animate-pulse" style={{ background: '#bc8cff10', borderColor: '#bc8cff40', color: '#bc8cff' }}>
              Decomposing objective...
            </div>
          )}
          {decomposeResult && (
            <div className="relative">
              <pre className="p-4 rounded-md border text-[11px] font-mono whitespace-pre-wrap overflow-auto max-h-[400px]" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--text-active)' }}>
                {JSON.stringify(decomposeResult, null, 2)}
              </pre>
              <button onClick={() => copyToClipboard(JSON.stringify(decomposeResult, null, 2))} className="absolute top-2 right-2 p-1 rounded opacity-50 hover:opacity-100" style={{ color: 'var(--text-secondary)' }}>
                <Copy size={12} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* ─── Models Tab ─── */}
      {tab === 'models' && (
        <div className="space-y-4">
          {/* Provider Health */}
          {health.providers.map(p => (
            <div key={p.name} className="p-4 rounded-md border" style={{ background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)' }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Server size={14} style={{ color: '#bc8cff' }} />
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-active)' }}>{p.name}</span>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>v{p.version}</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: p.available ? '#3fb95015' : '#f8514915', color: p.available ? '#3fb950' : '#f85149' }}>
                  {p.available ? 'CONNECTED' : 'OFFLINE'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                <span>URL: {p.url}</span>
                <span>Default: {p.default_model}</span>
                <span>Models: {p.model_count}</span>
              </div>
            </div>
          ))}

          {/* Model Cards */}
          <div className="space-y-2">
            {models.map(m => (
              <div
                key={m.name}
                className="p-3 rounded-md border cursor-pointer transition-colors"
                style={{
                  background: m.name === selectedModel ? '#bc8cff10' : 'var(--bg-sidebar)',
                  borderColor: m.name === selectedModel ? '#bc8cff40' : 'var(--border-color)',
                }}
                onClick={() => setSelectedModel(m.name)}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Cpu size={12} style={{ color: '#bc8cff' }} />
                    <span className="text-[12px] font-semibold font-mono" style={{ color: 'var(--text-active)' }}>{m.name}</span>
                    {m.is_default && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#d2992215', color: '#d29922' }}>DEFAULT</span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{m.size_gb}GB</span>
                </div>
                <div className="flex items-center gap-1 flex-wrap mt-1">
                  {m.capabilities.map(cap => (
                    <span key={cap} className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: '#58a6ff10', color: '#58a6ff' }}>
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Refresh */}
          <button
            onClick={fetchModels}
            className="flex items-center gap-2 px-3 py-1.5 rounded text-[11px] font-mono transition-colors"
            style={{ background: '#58a6ff15', color: '#58a6ff' }}
          >
            <Activity size={12} /> Refresh Models
          </button>
        </div>
      )}
    </div>
  );
}
