import { useState, useCallback } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  actions?: { type: string }[];
}

interface SessionState {
  session_id: string;
  tone: 'neutral' | 'focused' | 'degraded' | 'recovery';
  active_model: 'local' | 'api' | 'fallback' | 'unconfigured';
  last_action_status: 'success' | 'failure' | 'pending';
}

export function useHeidi(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (message: string) => {
      setIsLoading(true);
      setError(null);

      const userMessage: ChatMessage = {
        id: `${Date.now()}-user`,
        role: 'user',
        content: message,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);

      try {
        const res = await fetch('/api/heidi/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, session_id: sessionId, user_id: 'default-user' }),
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json() as {
          response: string;
          model_used: string;
          latency: number;
          session_state: SessionState;
        };

        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-assistant`,
            role: 'assistant',
            content: data.response,
            timestamp: new Date(),
          },
        ]);

        if (data.session_state) setSessionState(data.session_state);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        setMessages((prev) => [
          ...prev,
          {
            id: `${Date.now()}-error`,
            role: 'assistant',
            content: 'Sorry, I encountered an error. Please try again.',
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId]
  );

  const clearMessages = useCallback(() => setMessages([]), []);

  const getModelStatus = useCallback(() => {
    if (!sessionState) return 'unknown';
    if (sessionState.active_model === 'api') return 'healthy';
    if (sessionState.active_model === 'fallback') return 'api-fallback';
    return 'degraded';
  }, [sessionState]);

  const getActiveModel = useCallback(
    () => sessionState?.active_model ?? 'unknown',
    [sessionState]
  );

  return {
    messages,
    isLoading,
    error,
    sessionState,
    systemStatus: null,
    sendMessage,
    clearMessages,
    fetchSessionState: () => Promise.resolve(),
    getModelStatus,
    getActiveModel,
  };
}
