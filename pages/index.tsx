import { useState, useRef, useEffect, useCallback, FormEvent, KeyboardEvent } from 'react'
import Link from 'next/link'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isStreaming?: boolean
  tools?: ToolEvent[]
}

interface ToolEvent {
  type: string
  status: string
  result?: unknown
  error?: string
}

export default function HeidiChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId] = useState(() => `s-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  const [model, setModel] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Health check on mount
  useEffect(() => {
    fetch('/api/heidi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'status' }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        setConnectionOk(true)
        if (d?.currentModel) setModel(d.currentModel)
      })
      .catch(() => setConnectionOk(false))
  }, [])

  // Smooth scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [messages])

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isLoading) return
    setError(null)

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    }

    const assistantId = `a-${Date.now()}`
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: new Date(),
      isStreaming: true,
      tools: [],
    }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setIsLoading(true)
    setInput('')

    abortRef.current = new AbortController()

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text.trim(),
          session_id: sessionId,
          user_id: 'heidi-user',
        }),
        signal: abortRef.current.signal,
      })

      if (!res.ok) {
        throw new Error(`Server error (${res.status})`)
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response stream')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ') || line === 'data: [DONE]') continue

          try {
            const data = JSON.parse(line.slice(6))

            if (data.type === 'content') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId
                    ? { ...m, content: m.content + data.content }
                    : m
                )
              )
            } else if (data.type === 'metadata' && data.model_used) {
              setModel(data.model_used)
            } else if (data.type === 'tool') {
              setMessages(prev =>
                prev.map(m =>
                  m.id === assistantId
                    ? { ...m, tools: [...(m.tools || []), data.tool] }
                    : m
                )
              )
            } else if (data.type === 'error') {
              throw new Error(data.error)
            }
          } catch (parseErr) {
            if (parseErr instanceof SyntaxError) continue
            throw parseErr
          }
        }
      }

      // Mark streaming as done
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        )
      )
    } catch (err) {
      if ((err as Error).name === 'AbortError') return

      const errMsg = err instanceof Error ? err.message : 'Unknown error'
      setError(errMsg)

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
      )
    } finally {
      setIsLoading(false)
      abortRef.current = null
      inputRef.current?.focus()
    }
  }, [isLoading, sessionId])

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const stopStreaming = () => {
    abortRef.current?.abort()
    setIsLoading(false)
    setMessages(prev =>
      prev.map(m => (m.isStreaming ? { ...m, isStreaming: false } : m))
    )
  }

  return (
    <div className="flex flex-col h-[100dvh] bg-[#0f0f17] text-gray-100">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] bg-[#0f0f17]/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-sm font-bold">
            H
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-tight">Heidi</h1>
            <p className="text-[11px] text-gray-500">
              {model ? model : 'connecting...'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {connectionOk !== null && (
            <span className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  connectionOk ? 'bg-emerald-400' : 'bg-red-400'
                }`}
              />
              {connectionOk ? 'Online' : 'Offline'}
            </span>
          )}
          <Link
            href="/funding"
            className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
          >
            Z-Labs
          </Link>
        </div>
      </header>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto chat-scroll">
        <div className="max-w-3xl mx-auto px-4 py-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 select-none">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/20 flex items-center justify-center">
                <span className="text-3xl">H</span>
              </div>
              <div className="text-center">
                <h2 className="text-lg font-medium text-gray-300">
                  What can I help with?
                </h2>
                <p className="text-sm text-gray-600 mt-1 max-w-md">
                  Ask me about system status, run tasks, manage revenue streams, or just chat.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 mt-4 justify-center">
                {[
                  'System status',
                  'Show revenue streams',
                  'Run health check',
                  'What can you do?',
                ].map(q => (
                  <button
                    key={q}
                    onClick={() => sendMessage(q)}
                    className="px-3 py-1.5 text-xs text-gray-400 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-full transition-all hover:text-gray-200"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className="msg-enter mb-5">
              {msg.role === 'user' ? (
                <UserBubble content={msg.content} />
              ) : (
                <AssistantBubble
                  content={msg.content}
                  isStreaming={!!msg.isStreaming}
                  tools={msg.tools}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Error toast */}
      {error && (
        <div className="mx-auto max-w-3xl px-4 pb-2">
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            <span className="shrink-0">Error:</span>
            <span className="truncate">{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400/60 hover:text-red-400"
            >
              dismiss
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-white/[0.06] bg-[#0f0f17]/80 backdrop-blur-sm">
        <form
          onSubmit={handleSubmit}
          className="max-w-3xl mx-auto px-4 py-3"
        >
          <div className="relative flex items-end bg-white/[0.04] border border-white/[0.08] rounded-2xl focus-within:border-violet-500/40 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Heidi..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 px-4 py-3 resize-none outline-none max-h-36 overflow-y-auto"
              style={{
                height: 'auto',
                minHeight: '44px',
                maxHeight: '144px',
              }}
              onInput={e => {
                const t = e.currentTarget
                t.style.height = 'auto'
                t.style.height = Math.min(t.scrollHeight, 144) + 'px'
              }}
              disabled={isLoading}
              autoFocus
            />
            <div className="px-2 pb-2 flex items-center gap-1">
              {isLoading ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  className="p-2 rounded-xl bg-white/[0.06] hover:bg-white/[0.1] text-gray-400 hover:text-gray-200 transition-colors"
                  title="Stop generating"
                >
                  <StopIcon />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  className="p-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:hover:bg-violet-600 text-white transition-colors"
                  title="Send message"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
          <p className="text-[10px] text-gray-700 text-center mt-2">
            Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  )
}

/* ─── Sub-components ─────────────────────────────────────────── */

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-violet-600/20 border border-violet-500/20 rounded-2xl rounded-br-md px-4 py-2.5">
        <p className="text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
          {content}
        </p>
      </div>
    </div>
  )
}

function AssistantBubble({
  content,
  isStreaming,
  tools,
}: {
  content: string
  isStreaming: boolean
  tools?: ToolEvent[]
}) {
  return (
    <div className="flex gap-3">
      <div className="shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/30 to-fuchsia-500/30 flex items-center justify-center text-[11px] font-bold text-violet-300 mt-0.5">
        H
      </div>
      <div className="min-w-0 flex-1">
        {/* Tool use indicators */}
        {tools && tools.length > 0 && (
          <div className="mb-2 space-y-1">
            {tools.map((tool, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-[11px] text-gray-500 bg-white/[0.02] border border-white/[0.04] rounded-lg px-2.5 py-1.5"
              >
                <span className="text-violet-400/70">
                  {tool.status === 'completed' ? '\u2713' : tool.status === 'failed' ? '\u2717' : '\u25CB'}
                </span>
                <span className="font-mono">{tool.type}</span>
                {tool.error && (
                  <span className="text-red-400/70 truncate ml-auto">
                    {tool.error}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        {content ? (
          <div
            className={`text-sm text-gray-300 whitespace-pre-wrap leading-relaxed ${
              isStreaming ? 'streaming-cursor' : ''
            }`}
          >
            {content}
          </div>
        ) : isStreaming ? (
          <div className="dot-pulse flex gap-1 py-2">
            <span className="w-2 h-2 rounded-full bg-violet-400/60" />
            <span className="w-2 h-2 rounded-full bg-violet-400/60" />
            <span className="w-2 h-2 rounded-full bg-violet-400/60" />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}
