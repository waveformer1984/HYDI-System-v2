import { useState, useRef, useEffect, useCallback, FormEvent, KeyboardEvent } from 'react';

export interface ToolEvent {
  type: string;
  status: string;
  result?: unknown;
  error?: string;
}

export interface ActionEvent {
  type: string;
  status: 'completed' | 'failed' | 'pending_approval';
  error?: string;
  actionId?: string;
  resolving?: boolean;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
  tools?: ToolEvent[];
  actions?: ActionEvent[];
}

export interface UseHeidiChatOptions {
  userId?: string;
  buildMessage?: (input: string) => string;
}

const SERVICE_SECRET_KEY = 'hydi.serviceSecret';

export async function mintServiceToken(secret: string): Promise<string> {
  const ts = Date.now().toString();
  const requestId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const service = 'heidi-dashboard';
  const payload = `${ts}:${requestId}:${service}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sig = [...new Uint8Array(sigBuf)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${ts}.${requestId}.${service}.${sig}`;
}

export function parseSSEData(line: string): Record<string, unknown> | null {
  if (!line.startsWith('data: ') || line === 'data: [DONE]') return null;
  try {
    return JSON.parse(line.slice(6));
  } catch {
    return null;
  }
}

export function useHeidiChat(options: UseHeidiChatOptions = {}) {
  const { userId = 'heidi-user', buildMessage } = options;

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const [model, setModel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
  const [serviceSecret, setServiceSecret] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [secretDraft, setSecretDraft] = useState('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(SERVICE_SECRET_KEY) || '';
    setServiceSecret(stored);
    setSecretDraft(stored);
  }, []);

  useEffect(() => {
    fetch('/api/status')
      .then(r => (r.ok ? r.json() : null))
      .then(() => setConnectionOk(true))
      .catch(() => setConnectionOk(false));
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages]);

  const saveServiceSecret = useCallback(() => {
    localStorage.setItem(SERVICE_SECRET_KEY, secretDraft);
    setServiceSecret(secretDraft);
    setSettingsOpen(false);
  }, [secretDraft]);

  const sendMessage = useCallback(
    async (rawText: string) => {
      const text = rawText.trim();
      if (!text || isLoading) return;

      const fullMessage = buildMessage ? buildMessage(text) : text;

      setError(null);

      const userMsg: Message = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
        timestamp: new Date(),
      };

      const assistantId = `a-${Date.now()}`;
      const assistantMsg: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        tools: [],
      };

      setMessages(prev => [...prev, userMsg, assistantMsg]);
      setIsLoading(true);
      setInput('');

      abortRef.current = new AbortController();

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: fullMessage,
            session_id: sessionId,
            user_id: userId,
          }),
          signal: abortRef.current.signal,
        });

        if (!res.ok) {
          throw new Error(`Server error (${res.status})`);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No response stream');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const data = parseSSEData(line);
            if (!data) continue;

            if (data.type === 'content') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: m.content + (data.content as string) }
                    : m
                )
              );
            } else if (data.type === 'metadata' && data.model_used) {
              setModel(data.model_used as string);
            } else if (data.type === 'tool') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId
                    ? { ...m, tools: [...(m.tools || []), data.tool as ToolEvent] }
                    : m
                )
              );
            } else if (data.type === 'actions' && Array.isArray(data.actions)) {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId ? { ...m, actions: data.actions as ActionEvent[] } : m
                )
              );
            } else if (data.type === 'error') {
              throw new Error(data.error as string);
            }
          }
        }

        setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, isStreaming: false } : m)));
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;

        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errMsg);

        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId
              ? {
                  ...m,
                  content: m.content || 'Sorry, something went wrong.',
                  isStreaming: false,
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
        abortRef.current = null;
        inputRef.current?.focus();
      }
    },
    [isLoading, sessionId, userId, buildMessage]
  );

  const resolveAction = useCallback(
    async (messageId: string, actionId: string, decision: 'approve' | 'reject') => {
      setMessages(prev =>
        prev.map(m =>
          m.id === messageId
            ? {
                ...m,
                actions: m.actions?.map(a =>
                  a.actionId === actionId ? { ...a, resolving: true } : a
                ),
              }
            : m
        )
      );

      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (serviceSecret) {
          headers['x-hydi-service-token'] = await mintServiceToken(serviceSecret);
        }

        const res = await fetch(`/api/actions/${actionId}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ decision }),
        });
        const data = await res.json();
        const nextStatus: ActionEvent['status'] =
          res.ok && data.status === 'completed' ? 'completed' : 'failed';
        const nextError = res.ok
          ? data.error
          : res.status === 401 || res.status === 403
          ? 'Not authorized to approve actions. Set your service secret in ⚙️ settings.'
          : data.error || 'Failed to resolve action';

        setMessages(prev =>
          prev.map(m =>
            m.id === messageId
              ? {
                  ...m,
                  actions: m.actions?.map(a =>
                    a.actionId === actionId
                      ? { ...a, status: nextStatus, error: nextError, resolving: false }
                      : a
                  ),
                }
              : m
          )
        );
      } catch (err) {
        setMessages(prev =>
          prev.map(m =>
            m.id === messageId
              ? {
                  ...m,
                  actions: m.actions?.map(a =>
                    a.actionId === actionId
                      ? {
                          ...a,
                          status: 'failed',
                          error: err instanceof Error ? err.message : 'Network error',
                          resolving: false,
                        }
                      : a
                  ),
                }
              : m
          )
        );
      }
    },
    [serviceSecret]
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    sendMessage(input);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const stopStreaming = () => {
    abortRef.current?.abort();
    setIsLoading(false);
    setMessages(prev => prev.map(m => (m.isStreaming ? { ...m, isStreaming: false } : m)));
  };

  return {
    messages,
    input,
    setInput,
    isLoading,
    error,
    connectionOk,
    model,
    serviceSecret,
    settingsOpen,
    setSettingsOpen,
    secretDraft,
    setSecretDraft,
    saveServiceSecret,
    sendMessage,
    handleSubmit,
    handleKeyDown,
    stopStreaming,
    resolveAction,
    scrollRef,
    inputRef,
  };
}
