'use client';

/**
 * Always-on Heidi chat panel for Ursula. Open by default on every page;
 * closing it leaves a small button in the corner, and that choice (and the
 * open conversation) is remembered on this browser. It talks to the real
 * heidi-core through /api/heidi/* (lib/heidi-relay.ts), so memory, tasks,
 * `system report` and `trace <id>` all work the same as on the phone.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { parseSse, splitToolLines, type HeidiEvent } from '@/lib/heidi-sse';

type Msg = { id: string; role: 'user' | 'heidi' | 'system'; text: string; tools?: string[]; pending?: boolean };

const OPEN_KEY = 'ursula.heidiPanel.open';
const CONVO_KEY = 'ursula.heidiPanel.conversationId';
const QUICK = [
  { label: 'System report', text: 'system report' },
  { label: 'Tasks', text: 'tasks' },
  { label: 'Memory', text: 'memory status' },
];

function load(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* storage unavailable: state just isn't remembered */ }
}
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function HeidiChatPanel() {
  const [open, setOpen] = useState(true);
  const [ready, setReady] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const convoRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Restore open/closed and the last conversation (after mount: no SSR mismatch).
  useEffect(() => {
    setOpen(load(OPEN_KEY) !== 'false');
    convoRef.current = load(CONVO_KEY);
    setReady(true);
    const id = convoRef.current;
    if (!id) return;
    fetch(`/api/heidi/conversations/${encodeURIComponent(id)}/messages`)
      .then(async (r) => {
        if (r.status === 404) { convoRef.current = null; save(CONVO_KEY, null); return; }
        if (!r.ok) return;
        const data = await r.json();
        const rows: Array<{ id?: string; role: string; content: string }> = data.messages || [];
        setMessages(rows.map((x) => ({ id: String(x.id || newId()), role: x.role === 'user' ? 'user' : 'heidi', text: x.content })));
      })
      .catch(() => { /* history is optional; the panel still works */ });
  }, []);

  // Status dot: is heidi-core answering? Polls only while the panel is open.
  useEffect(() => {
    if (!open) return;
    let stop = false;
    const check = () => fetch('/api/heidi/health')
      .then((r) => r.json()).then((d) => { if (!stop) setOnline(Boolean(d.ok)); })
      .catch(() => { if (!stop) setOnline(false); });
    check();
    const t = setInterval(check, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open]);

  const setPanel = (next: boolean) => { setOpen(next); save(OPEN_KEY, String(next)); };

  const newChat = () => {
    convoRef.current = null;
    save(CONVO_KEY, null);
    setMessages([]);
  };

  const send = useCallback(async (text: string) => {
    const message = text.trim();
    if (!message || busy) return;
    setInput('');
    setBusy(true);
    const replyId = newId();
    setMessages((m) => [...m, { id: newId(), role: 'user', text: message }, { id: replyId, role: 'heidi', text: '', pending: true }]);
    const update = (fn: (msg: Msg) => Msg) => setMessages((m) => m.map((x) => (x.id === replyId ? fn(x) : x)));

    try {
      const res = await fetch('/api/heidi/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, conversation_id: convoRef.current, request_id: newId() }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({}));
        const why = err.error === 'local_only' ? err.hint
          : err.error === 'heidi_core_unreachable' ? 'Heidi is not answering (heidi-core on :3459 is down).'
          : `Heidi returned an error (${res.status}).`;
        update((x) => ({ ...x, role: 'system', text: why, pending: false }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let raw = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const parsed = parseSse(buffer + decoder.decode(value, { stream: true }));
        buffer = parsed.rest;
        for (const ev of parsed.events as HeidiEvent[]) {
          if (typeof ev.t === 'string') {
            raw += ev.t;
            const { tools, answer } = splitToolLines(raw);
            update((x) => ({ ...x, text: answer, tools }));
          }
          if (ev.error) {
            if (ev.conversation_not_found) { convoRef.current = null; save(CONVO_KEY, null); }
            update((x) => ({ ...x, role: 'system', text: ev.conversation_not_found ? 'That conversation is gone; starting a new one. Send your message again.' : String(ev.error), pending: false }));
          }
          if (ev.done && typeof ev.conversation_id === 'string' && ev.conversation_id) {
            convoRef.current = ev.conversation_id;
            save(CONVO_KEY, ev.conversation_id);
          }
        }
      }
      update((x) => ({ ...x, pending: false, text: x.text || (x.tools && x.tools.length ? '(Heidi ran tools but sent no answer.)' : x.text) }));
    } catch (e) {
      update((x) => ({ ...x, role: 'system', text: `Could not reach Ursula's Heidi relay: ${e instanceof Error ? e.message : 'unknown error'}`, pending: false }));
    } finally {
      setBusy(false);
    }
  }, [busy]);

  if (!ready) return null;

  if (!open) {
    return (
      <button
        type="button"
        data-testid="heidi-panel-open"
        onClick={() => setPanel(true)}
        aria-label="Open Heidi chat"
        className="fixed bottom-4 right-4 z-[1000] flex h-12 w-12 items-center justify-center rounded-full shadow-lg print:hidden"
        style={{ background: 'var(--text-accent)', color: '#fff' }}
      >
        <span className="text-lg font-semibold">H</span>
      </button>
    );
  }

  const dot = online === null ? '#858585' : online ? '#10b981' : '#ef4444';
  return (
    <section
      data-testid="heidi-panel"
      aria-label="Heidi chat"
      className="fixed bottom-4 right-4 z-[1000] flex flex-col overflow-hidden rounded-lg border shadow-2xl print:hidden"
      style={{ width: 'min(380px, calc(100vw - 2rem))', height: 'min(560px, calc(100vh - 2rem))', background: 'var(--bg-sidebar)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
    >
      <header className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--border-color)', background: 'var(--bg-titlebar)' }}>
        <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: dot }} />
        <span className="text-sm font-semibold">Heidi</span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          {online === false ? 'not answering' : online ? 'online' : 'checking…'}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" onClick={newChat} className="rounded px-2 py-1 text-xs hover:opacity-80" style={{ color: 'var(--text-secondary)' }} title="Start a new conversation">
            New chat
          </button>
          <button type="button" data-testid="heidi-panel-close" onClick={() => setPanel(false)} aria-label="Close Heidi chat" className="rounded px-2 py-1 text-sm hover:opacity-80" style={{ color: 'var(--text-secondary)' }}>
            ✕
          </button>
        </div>
      </header>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto px-3 py-3" data-testid="heidi-panel-messages">
        {messages.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            Ask Heidi anything, or try a command: <code>system report</code>, <code>tasks</code>, <code>trace &lt;id&gt;</code>, <code>memory status</code>.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className="max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm"
              style={m.role === 'user'
                ? { background: 'var(--highlight)', color: 'var(--text-active)' }
                : m.role === 'system'
                  ? { background: 'transparent', color: '#fbbf24', border: '1px solid var(--border-color)' }
                  : { background: 'var(--bg-tab)', color: 'var(--text-primary)' }}
            >
              {m.tools && m.tools.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {m.tools.map((t, i) => (
                    <span key={`${t}-${i}`} className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: 'var(--bg-editor)', color: 'var(--text-secondary)' }}>⚙ {t}</span>
                  ))}
                </div>
              )}
              {m.text || (m.pending ? '…' : '')}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-1 overflow-x-auto border-t px-3 pt-2" style={{ borderColor: 'var(--border-color)' }}>
        {QUICK.map((q) => (
          <button key={q.text} type="button" disabled={busy} onClick={() => send(q.text)} className="whitespace-nowrap rounded-full border px-2.5 py-1 text-xs hover:opacity-80 disabled:opacity-50" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
            {q.label}
          </button>
        ))}
      </div>

      <form
        className="flex items-end gap-2 px-3 py-2"
        onSubmit={(e) => { e.preventDefault(); send(input); }}
      >
        <textarea
          data-testid="heidi-panel-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
          rows={1}
          placeholder="Message Heidi…"
          className="max-h-28 min-h-[36px] flex-1 resize-none rounded px-2 py-2 text-sm outline-none"
          style={{ background: 'var(--bg-editor)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
        />
        <button type="submit" disabled={busy || !input.trim()} className="rounded px-3 py-2 text-sm font-medium disabled:opacity-50" style={{ background: 'var(--text-accent)', color: '#fff' }}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
