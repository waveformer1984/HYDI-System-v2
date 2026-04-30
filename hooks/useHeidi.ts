/**
 * HOOKS - useHeidi.ts
 * 
 * React hook for Heidi integration with streaming chat, model status, and session state
 */

import { useState, useEffect, useCallback } from 'react';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  actions?: any[];
}

interface SessionState {
  session_id: string;
  tone: 'neutral' | 'focused' | 'degraded' | 'recovery';
  active_model: 'local' | 'api';
  last_action_status: 'success' | 'failure' | 'pending';
}

interface SystemStatus {
  model_status: {
    consecutiveFailures: number;
    circuitBreakerActive: boolean;
    circuitBreakerCooldown: number;
  };
  memory_connected: boolean;
  allowed_actions: string[];
}

export function useHeidi(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize session
  useEffect(() => {
    if (sessionId) {
      fetchSessionState();
      fetchSystemStatus();
    }
  }, [sessionId]);

  // Fetch session state
  const fetchSessionState = useCallback(async () => {
    try {
      const response = await fetch(`/api/session?session_id=${sessionId}`);
      const data = await response.json();
      setSessionState(data);
    } catch (error) {
      console.error('Failed to fetch session state:', error);
    }
  }, [sessionId]);

  // Fetch system status
  const fetchSystemStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      setSystemStatus(data);
    } catch (error) {
      console.error('Failed to fetch system status:', error);
    }
  }, []);

  // Send message with streaming
  const sendMessage = useCallback(async (message: string) => {
    setIsLoading(true);
    setError(null);

    // Add user message
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
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          session_id: sessionId,
          user_id: 'demo-user' // In production, get from auth
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      
      let assistantMessage = '';
      let actions: any[] = [];
      let modelUsed = '';
      let latency = 0;
      let responseData: any = null;

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
                
                if (data.type === 'content') {
                  assistantMessage += data.content;
                } else if (data.type === 'actions') {
                  actions = data.actions;
                } else if (data.type === 'metadata') {
                  modelUsed = data.model_used;
                  latency = data.latency;
                  responseData = data;
                }
              } catch (e) {
                // Ignore malformed JSON chunks
              }
            }
          }
        }
      } else {
        // Fallback for non-streaming response
        responseData = await response.json();
        assistantMessage = responseData.response;
        actions = responseData.actions;
        modelUsed = responseData.model_used;
        latency = responseData.latency;
      }

      // Add assistant message
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: assistantMessage,
        timestamp: new Date(),
        actions
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Update session state (only available in non-streaming response)
      if (responseData && responseData.session_state) {
        setSessionState(responseData.session_state);
      }

      // Refresh system status
      fetchSystemStatus();

    } catch (error) {
      console.error('Failed to send message:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
      
      // Add error message
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

  // Clear messages
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // Get model status indicator
  const getModelStatus = useCallback(() => {
    if (!systemStatus) return 'unknown';
    
    if (systemStatus.model_status.circuitBreakerActive) {
      return 'api-fallback';
    }
    
    if (systemStatus.model_status.consecutiveFailures > 0) {
      return 'degraded';
    }
    
    return 'healthy';
  }, [systemStatus]);

  // Get active model display
  const getActiveModel = useCallback(() => {
    return sessionState?.active_model || 'unknown';
  }, [sessionState]);

  return {
    messages,
    isLoading,
    error,
    sessionState,
    systemStatus,
    sendMessage,
    clearMessages,
    fetchSessionState,
    getModelStatus,
    getActiveModel
  };
}
