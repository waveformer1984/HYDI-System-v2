import { useState, useRef, useEffect, useCallback, FormEvent, KeyboardEvent } from 'react'

/**
 * Embeddable Heidi chat panel.
 *
 * This is the panel version of the chat implemented full-page in
 * pages/index.tsx: same real, verified contract (POST /api/chat ->
 * pages/api/chat.ts, which streams SSE `data: {...}` lines of type
 * content/metadata/tool/error), reused here as a self-contained component
 * that any module (Photo Forge, future modules) can embed directly in its
 * own layout instead of linking out to a separate page.
 *
 * Deliberately excludes pages/index.tsx's action-approval flow
 * (resolveAction/service-secret minting) -- that machinery exists for the
 * main ops dashboard's ProtoForge-escalated actions specifically, and is
 * out of scope for a generic embed. Tool-call display is similarly left
 * out of this first pass; mirror pages/index.tsx's AssistantBubble/tools
 * rendering here if a module needs to surface them.
 *
 * NOTE ON THE ORIGINAL DESIGN SPEC (photo-forge-dashboard-spec.md): that
 * spec assumed the contract was `POST /api/chat` with `{ message, system }`,
 * based on CLAUDE.md's description of api/chat/route.js (a top-level
 * Vercel-convention file). With the repo now available, the actual live
 * endpoint Next.js serves at /api/chat is pages/api/chat.ts, which expects
 * `{ message, session_id, user_id }` and has no `system` field at all --
 * it's a single-agent (Heidi) endpoint, which is exactly what this embed
 * needs. That resolves the spec's open question about the payload shape;
 * the `context` field the spec proposed adding is NOT implemented here,
 * since pages/api/chat.ts doesn't read one yet -- passing it today would be
 * silently ignored, not acted on. Wiring real context-awareness through
 * needs a corresponding change in pages/api/chat.ts, which is out of scope
 * for this scaffold.
 */

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  isStreaming?: boolean
}

export interface HeidiChatProps {
  /** Optional heading shown above the message list. Defaults to "Heidi". */
  title?: string
  /** Optional short status line under the title (e.g. the module this chat is embedded in). */
  subtitle?: string
  /** Suggested starter prompts shown when the conversation is empty. */
  suggestions?: string[]
  /** Extra className applied to the outer panel, e.g. to control width from a parent grid. */
  className?: string
}

const DEFAULT_SUGGESTIONS = ['What can you do?', 'System status', 'Run health check']

export default function HeidiChat({
  title = 'Heidi',
  subtitle,
  suggestions = DEFAULT_SUGGESTIONS,
  className = '',
}: HeidiChatProps) {
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

  // Same health check pages/index.tsx uses: /api/status is the real bridged,
  // unauthenticated status endpoint (pages/api/status.ts).
  useEffect(() => {
    fetch('/api/status')
      .then(r => (r.ok ? r.json() : null))
      .then(() => setConnectionOk(true))
      .catch(() => setConnectionOk(false))
  }, [])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [messages])

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return
      setError(null)

      const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: text.trim(), timestamp: new Date() }
      const assistantId = `a-${Date.now()}`
      const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', timestamp: new Date(), isStreaming: true }

      setMessages(prev => [...prev, userMsg, assistantMsg])
      setIsLoading(true)
      setInput('')

      abortRef.current = new AbortController()

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text.trim(), session_id: sessionId, user_id: 'heidi-user' }),
          signal: abortRef.current.signal,
        })

        if (!res.ok) throw new Error(`Server error (${res.status})`)

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
                  prev.map(m => (m.id === assistantId ? { ...m, content: m.content + data.content } : m))
                )
              } else if (data.type === 'metadata' && data.model_used) {
                setModel(data.model_used)
              } else if (data.type === 'error') {
                throw new Error(data.error)
              }
            } catch (parseErr) {
              if (parseErr instanceof SyntaxError) continue
              throw parseErr
            }
          }
        }

        setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, isStreaming: false } : m)))
      } catch (err) {
        if ((err as Error).name === 'AbortError') return

        const errMsg = err instanceof Error ? err.message : 'Unknown error'
        setError(errMsg)
        setMessages(prev =>
          prev.map(m =>
            m.id === assistantId ? { ...m, content: m.content || 'Sorry, something went wrong.', isStreaming: false } : m
          )
        )
      } finally {
        setIsLoading(false)
        abortRef.current = null
        inputRef.current?.focus()
      }
    },
    [isLoading, sessionId]
  )

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

  return (
    <div className={`flex flex-col h-full bg-[#0f0f17] text-gray-100 ${className}`}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-xs font-bold shrink-0">
            H
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold tracking-tight truncate">{title}</h2>
            <p className="text-[11px] text-gray-500 truncate">{subtitle || (model ?? 'connecting...')}</p>
          </div>
        </div>
        {connectionOk !== null && (
          <span className="flex items-center gap-1.5 text-[11px] text-gray-500 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${connectionOk ? 'bg-emerald-400' : 'bg-red-400'}`} />
            {connectionOk ? 'Online' : 'Offline'}
          </span>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 select-none px-4 text-center">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 border border-violet-500/20 flex items-center justify-center">
              <span className="text-lg">H</span>
            </div>
            <p className="text-xs text-gray-600 max-w-[220px]">Ask Heidi anything while you work.</p>
            <div className="flex flex-wrap gap-1.5 justify-center">
              {suggestions.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="px-2.5 py-1 text-[11px] text-gray-400 bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] rounded-full transition-all hover:text-gray-200"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className="mb-3">
            {msg.role === 'user' ? (
              <div className="ml-6 rounded-2xl rounded-tr-sm bg-violet-600/20 border border-violet-500/20 px-3 py-2 text-sm text-gray-100">
                {msg.content}
              </div>
            ) : (
              <div className="mr-6 rounded-2xl rounded-tl-sm bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-sm text-gray-200 whitespace-pre-wrap">
                {msg.content}
                {msg.isStreaming && <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-gray-400 animate-pulse align-middle" />}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="px-3 pb-2">
          <div className="flex items-center gap-2 text-[11px] text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-2.5 py-1.5">
            <span className="shrink-0">Error:</span>
            <span className="truncate">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400/60 hover:text-red-400">
              dismiss
            </button>
          </div>
        </div>
      )}

      <div className="border-t border-white/[0.06]">
        <form onSubmit={handleSubmit} className="px-3 py-2.5">
          <div className="relative flex items-end bg-white/[0.04] border border-white/[0.08] rounded-xl focus-within:border-violet-500/40 transition-colors">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message Heidi..."
              rows={1}
              className="flex-1 bg-transparent text-sm text-gray-100 placeholder-gray-600 px-3 py-2.5 resize-none outline-none max-h-28 overflow-y-auto"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="m-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:hover:bg-violet-600 transition-colors shrink-0"
            >
              Send
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
