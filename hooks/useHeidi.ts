import { useState, useEffect, useCallback } from 'react'
import type { SessionState, SystemStatus, ActionItem } from '../types'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  actions?: ActionItem[]
}

interface StreamChunk {
  type: 'content' | 'actions' | 'metadata' | 'error'
  content?: string
  actions?: ActionItem[]
  model_used?: string
  latency?: number
  session_state?: SessionState
  error?: string
}

export function useHeidi(sessionId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (sessionId) {
      fetchSessionState()
      fetchSystemStatus()
    }
  }, [sessionId])

  const fetchSessionState = useCallback(async () => {
    try {
      const response = await fetch(`/api/session?session_id=${sessionId}`)
      const data: SessionState = await response.json()
      setSessionState(data)
    } catch (err) {
      console.error('Failed to fetch session state:', err)
    }
  }, [sessionId])

  const fetchSystemStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/status')
      const data: SystemStatus = await response.json()
      setSystemStatus(data)
    } catch (err) {
      console.error('Failed to fetch system status:', err)
    }
  }, [])

  const sendMessage = useCallback(async (message: string) => {
    setIsLoading(true)
    setError(null)

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          session_id: sessionId,
          user_id: 'demo-user',
        }),
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      let assistantMessage = ''
      let actions: ActionItem[] = []
      let newSessionState: SessionState | undefined

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const data: StreamChunk = JSON.parse(line.slice(6))
              if (data.type === 'content' && data.content) {
                assistantMessage += data.content
              } else if (data.type === 'actions' && data.actions) {
                actions = data.actions
              } else if (data.type === 'metadata' && data.session_state) {
                newSessionState = data.session_state
              }
            } catch {
              // ignore malformed SSE chunks
            }
          }
        }
      } else {
        // non-streaming fallback
        const data = await response.json() as {
          response: string
          actions?: ActionItem[]
          session_state?: SessionState
        }
        assistantMessage = data.response
        actions = data.actions ?? []
        newSessionState = data.session_state
      }

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: assistantMessage,
        timestamp: new Date(),
        actions,
      }])

      if (newSessionState) setSessionState(newSessionState)
      fetchSystemStatus()

    } catch (err) {
      console.error('Failed to send message:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
      }])
    } finally {
      setIsLoading(false)
    }
  }, [sessionId, fetchSystemStatus])

  const clearMessages = useCallback(() => setMessages([]), [])

  const getModelStatus = useCallback(() => {
    if (!systemStatus) return 'unknown'
    if (systemStatus.model_status.circuitBreakerActive) return 'api-fallback'
    if (systemStatus.model_status.consecutiveFailures > 0) return 'degraded'
    return 'healthy'
  }, [systemStatus])

  const getActiveModel = useCallback(() =>
    sessionState?.active_model ?? 'unknown'
  , [sessionState])

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
    getActiveModel,
  }
}
