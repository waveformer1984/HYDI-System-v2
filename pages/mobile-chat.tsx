import { useCallback, useEffect, useRef, useState } from 'react'
import Head from 'next/head'

// Mobile-optimized Heidi chat surface. Unlike heidi-mobile-chat.html /
// launch-heidi-mobile.js (a standalone local-only Ollama dev tool with no
// Supabase/Claude/ledger access), this page is a real Next.js route deployed
// alongside the rest of the app. It talks to the exact same backend the
// desktop dashboard uses: pages/api/chat.ts (Claude tool-agent + Supabase
// session/memory) and api/mobile-status.js (3G-safe health + revenue
// snapshot).

interface ChatAction {
  type: string
  status: string
}

interface Msg {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  actions?: ChatAction[]
  time: string
}

interface MobileStatus {
  ok: boolean
  alert: string | null
  system: string
  drift: string
  heals_24h: number
  streams: Record<string, { last: string | null; net_24h: number }>
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function MobileChat() {
  const sessionId = useRef(`mobile_${uid()}`).current
  const userId = 'mobile-user'
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<MobileStatus | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const pollStatus = useCallback(async () => {
    try {
      const r = await fetch('/api/mobile-status', { signal: AbortSignal.timeout(4000) })
      if (r.ok) setStatus(await r.json())
    } catch {
      // status strip is best-effort; chat still works without it
    }
  }, [])

  useEffect(() => {
    pollStatus()
    const t = setInterval(pollStatus, 30000)
    setMessages([
      {
        id: uid(),
        role: 'system',
        time: now(),
        content:
          "Hi, I'm Heidi — connected to the live HYDI backend (Supabase + Claude), the same one the dashboard uses. Ask about system status, revenue streams, or anything else.",
      },
    ])
    return () => clearInterval(t)
  }, [pollStatus])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || sending) return
      setSending(true)
      setInput('')
      setMessages((prev) => [...prev, { id: uid(), role: 'user', content: trimmed, time: now() }])

      const assistantId = uid()
      setMessages((prev) => [...prev, { id: assistantId, role: 'assistant', content: '', time: now() }])

      try {
        const resp = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: trimmed, session_id: sessionId, user_id: userId }),
        })

        if (!resp.ok || !resp.body) throw new Error(`HTTP ${resp.status}`)

        const reader = resp.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        let acc = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const parts = buf.split('\n\n')
          buf = parts.pop() || ''
          for (const part of parts) {
            const line = part.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            const raw = line.slice(6)
            if (raw === '[DONE]') continue
            try {
              const evt = JSON.parse(raw)
              if (evt.type === 'content' && typeof evt.content === 'string') {
                acc += evt.content
                const snapshot = acc
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: snapshot } : m)))
              } else if (evt.type === 'actions' && Array.isArray(evt.actions)) {
                const actions = evt.actions as ChatAction[]
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, actions } : m)))
              } else if (evt.type === 'error') {
                acc = acc || `Error: ${evt.error}`
                const snapshot = acc
                setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: snapshot } : m)))
              }
            } catch {
              // ignore malformed SSE chunk
            }
          }
        }

        if (!acc) {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: '(empty response)' } : m)))
        }
      } catch (err) {
        const errMsg = `Connection error: ${err instanceof Error ? err.message : 'unknown'}`
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, content: errMsg } : m)))
      } finally {
        setSending(false)
        pollStatus()
      }
    },
    [sending, sessionId, pollStatus]
  )

  const onKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  const streamCount = status ? Object.keys(status.streams).length : 0
  const silentCount = status ? Object.values(status.streams).filter((s) => !s.last).length : 0

  return (
    <>
      <Head>
        <title>Heidi</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="theme-color" content="#0a0a0f" />
      </Head>

      <div className="app">
        <header className="header">
          <div className="header-left">
            <div className="avatar">🧠</div>
            <div>
              <h1>Heidi</h1>
              <div className="status-line">
                <span className={`dot ${status ? (status.ok ? 'ok' : 'warn') : 'off'}`} />
                <span>{status ? (status.ok ? 'Online · live backend' : status.alert || 'Degraded') : 'Connecting...'}</span>
              </div>
            </div>
          </div>
          <div className={`badge ${status ? (status.ok ? 'ok' : 'warn') : 'off'}`}>
            {status ? status.system : '—'}
          </div>
        </header>

        <div className="health-strip">
          <div className="metric">
            <span className="icon">📈</span>
            <span className="value">{status?.drift ?? '—'}</span>
            <span className="label">drift</span>
          </div>
          <div className="metric">
            <span className="icon">🔧</span>
            <span className="value">{status?.heals_24h ?? '—'}</span>
            <span className="label">heals 24h</span>
          </div>
          <div className="metric">
            <span className="icon">💸</span>
            <span className="value">{streamCount}</span>
            <span className="label">streams</span>
          </div>
          <div className="metric">
            <span className="icon">🔇</span>
            <span className="value">{silentCount}</span>
            <span className="label">silent</span>
          </div>
        </div>

        <div className="messages" ref={scrollRef}>
          {messages.map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="bubble">{m.content || (sending && m.role === 'assistant' ? '…' : '')}</div>
              {m.role !== 'system' && <div className="meta">{m.role === 'user' ? 'You' : 'Heidi'} · {m.time}</div>}
              {m.actions?.length ? (
                <div className="action-card">
                  {m.actions.map((a, i) => (
                    <div key={i} className="action-row">
                      <span>{a.type}</span>
                      <span className={`pill ${a.status}`}>{a.status}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <div className="quick-actions">
          {['System status', 'Revenue streams', 'What can you do?'].map((q) => (
            <div key={q} className="chip" onClick={() => send(q)}>
              {q}
            </div>
          ))}
        </div>

        <div className="input-area">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyPress}
            placeholder="Message Heidi..."
            rows={1}
          />
          <button onClick={() => send(input)} disabled={sending || !input.trim()}>
            ➤
          </button>
        </div>
      </div>

      <style jsx>{`
        * { box-sizing: border-box; }
        .app {
          height: 100dvh;
          display: flex;
          flex-direction: column;
          background: #0a0a0f;
          color: #e2e8f0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          overflow: hidden;
        }
        .header {
          background: #12121a;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding: 12px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }
        .header-left { display: flex; align-items: center; gap: 12px; }
        .avatar {
          width: 40px; height: 40px; border-radius: 50%;
          background: linear-gradient(135deg, #64ffda, #3b82f6);
          display: flex; align-items: center; justify-content: center; font-size: 20px;
        }
        h1 { font-size: 16px; font-weight: 600; margin: 0; }
        .status-line { font-size: 12px; color: #94a3b8; display: flex; align-items: center; gap: 4px; }
        .dot { width: 6px; height: 6px; border-radius: 50%; background: #6b7280; }
        .dot.ok { background: #10b981; }
        .dot.warn { background: #f59e0b; }
        .badge {
          padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 500;
          text-transform: uppercase; background: rgba(107,114,128,0.2); color: #9ca3af;
        }
        .badge.ok { background: rgba(16,185,129,0.2); color: #10b981; }
        .badge.warn { background: rgba(245,158,11,0.2); color: #f59e0b; }
        .health-strip {
          background: #12121a; border-bottom: 1px solid rgba(255,255,255,0.05);
          padding: 8px 16px; display: flex; gap: 10px; overflow-x: auto; flex-shrink: 0;
        }
        .metric {
          display: flex; align-items: center; gap: 6px; padding: 6px 12px;
          background: #1a1a24; border-radius: 8px; white-space: nowrap; font-size: 12px;
        }
        .metric .value { font-weight: 600; }
        .metric .label { color: #64748b; }
        .messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
        .msg { max-width: 85%; }
        .msg.user { align-self: flex-end; }
        .msg.assistant { align-self: flex-start; }
        .msg.system { align-self: center; max-width: 95%; }
        .bubble {
          padding: 12px 16px; border-radius: 18px; font-size: 15px; line-height: 1.5;
          white-space: pre-wrap; word-break: break-word;
        }
        .msg.user .bubble { background: #64ffda; color: #000; border-bottom-right-radius: 4px; }
        .msg.assistant .bubble { background: #1a1a24; border: 1px solid rgba(255,255,255,0.1); border-bottom-left-radius: 4px; }
        .msg.system .bubble {
          background: rgba(100,255,218,0.05); border: 1px solid rgba(100,255,218,0.1);
          font-size: 13px; text-align: center; color: #94a3b8;
        }
        .meta { font-size: 11px; color: #64748b; margin-top: 4px; padding: 0 4px; }
        .msg.user .meta { text-align: right; }
        .action-card {
          background: #1a1a24; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
          padding: 10px 12px; margin-top: 6px; font-size: 12px;
        }
        .action-row { display: flex; justify-content: space-between; padding: 2px 0; }
        .pill { padding: 1px 6px; border-radius: 6px; background: rgba(255,255,255,0.08); }
        .pill.completed { color: #10b981; }
        .pill.failed { color: #ef4444; }
        .pill.pending { color: #f59e0b; }
        .quick-actions {
          background: #12121a; border-top: 1px solid rgba(255,255,255,0.05);
          padding: 8px 16px; display: flex; gap: 8px; overflow-x: auto; flex-shrink: 0;
        }
        .chip {
          padding: 7px 14px; background: #1a1a24; border: 1px solid rgba(255,255,255,0.1);
          border-radius: 16px; font-size: 13px; color: #94a3b8; white-space: nowrap; cursor: pointer;
        }
        .input-area {
          background: #12121a; border-top: 1px solid rgba(255,255,255,0.05);
          padding: 12px 16px; padding-bottom: max(12px, env(safe-area-inset-bottom));
          display: flex; gap: 8px; align-items: flex-end; flex-shrink: 0;
        }
        textarea {
          flex: 1; background: #1a1a24; border: 1px solid rgba(255,255,255,0.1); border-radius: 20px;
          padding: 10px 16px; font-size: 15px; color: #e2e8f0; outline: none; resize: none;
          max-height: 120px; font-family: inherit; line-height: 1.4;
        }
        button {
          width: 44px; height: 44px; border-radius: 50%; border: none; background: #64ffda;
          font-size: 18px; cursor: pointer; flex-shrink: 0;
        }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
      `}</style>
    </>
  )
}
