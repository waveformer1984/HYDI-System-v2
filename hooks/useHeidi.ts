import { useState, useEffect, useCallback } from 'react';
import type { SessionState, SystemStatus, ActionLog } from '../types/index';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  actions?: ActionLog[];
}

export function useHeidi(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (sessionId) {
      fetchSessionState();
      fetchSystemStatus();
    }
  }, [sessionId]);

  const fetchSessionState = useCallback(async () => {
    try {
      const response = await fetch(`/api/session?session_id=${sessionId}`);
      if (!response.ok) return;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;
      const data = await response.json();
      setSessionState(data);
    } catch (err) {
      console.error('Failed to fetch session state:', err);
    }
  }, [sessionId]);

  const fetchSystemStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) return;
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return;
      const data = await response.json();
      setSystemStatus(data);
    } catch (err) {
      console.error('Failed to fetch system status:', err);
    }
  }, []);

  const sendMessage = useCallback(async (message: string) => {
    setIsLoading(true);
    setError(null);

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, session_id: sessionId, user_id: 'demo-user' })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      let assistantMessage = '';
      let actions: ActionLog[] = [];
      let responseData: Record<string, unknown> | null = null;
      let streamError: string | null = null;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.type === 'content') assistantMessage += data.content;
                else if (data.type === 'actions') actions = data.actions;
                else if (data.type === 'metadata') responseData = data;
                else if (data.type === 'error') streamError = data.error;
              } catch {
                // ignore malformed chunks
              }
            }
          }
        }
      } else {
        responseData = await response.json() as Record<string, unknown>;
        assistantMessage = responseData.response as string;
        actions = responseData.actions as ActionLog[];
      }

      if (streamError) {
        throw new Error(streamError);
      }

      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: assistantMessage,
        timestamp: new Date(),
        actions
      };
      setMessages(prev => [...prev, assistantMsg]);

      if (responseData && responseData.session_state) {
        setSessionState(responseData.session_state as SessionState);
      }

      fetchSystemStatus();
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, fetchSystemStatus]);

  const clearMessages = useCallback(() => { setMessages([]); }, []);

  const getModelStatus = useCallback(() => {
    if (!systemStatus) return 'unknown';
    if (systemStatus.model_status.circuitBreakerActive) return 'api-fallback';
    if (systemStatus.model_status.consecutiveFailures > 0) return 'degraded';
    return 'healthy';
  }, [systemStatus]);

  const getActiveModel = useCallback(() => {
    return sessionState?.active_model || 'unknown';
  }, [sessionState]);

  return { messages, isLoading, error, sessionState, systemStatus, sendMessage, clearMessages, fetchSessionState, getModelStatus, getActiveModel };
}
