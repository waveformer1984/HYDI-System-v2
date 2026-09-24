import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import styles from '../../styles/heidi-mobile.module.css';
import { streamChat, type ApiError, type ChatEvent } from '../../lib/heidi-mobile/client/api';
import {
  loadMessages, saveMessages, loadChatSessionId, resetChatSession, loadDraft, saveDraft, type StoredMessage,
} from '../../lib/heidi-mobile/client/cache';
import { clockTime, newId } from '../../lib/heidi-mobile/client/format';
import {
  createBrowserSpeechInput, createBrowserSpeechOutput, isSpeechInputSupported, type SpeechInput, type SpeechOutput,
} from '../../lib/heidi-mobile/client/voice';
import { ConfirmSheet } from './ui';

const PAGE = 40;
const SUGGESTIONS = ['What is HYDI’s status?', 'What needs my approval?', 'Summarize recent activity'];

interface Props {
  online: boolean;
  speakReplies: boolean;
  onAuthError: (_error: ApiError) => void;
  onTasksChanged: () => void;
}

function describeActions(event: Extract<ChatEvent, { type: 'actions' }>): string[] {
  return event.actions.map((a) => {
    const name = a.type || 'action';
    if (a.status === 'pending_approval') return `${name} — needs your approval (see Tasks)`;
    if (a.status === 'failed') return `${name} — failed${a.error ? `: ${a.error}` : ''}`;
    return `${name} — ${a.status || 'unknown'}`;
  });
}

export default function ChatView({ online, speakReplies, onAuthError, onTasksChanged }: Props) {
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [input, setInput] = useState('');
  const [interim, setInterim] = useState('');
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [visible, setVisible] = useState(PAGE);
  const [confirmReset, setConfirmReset] = useState(false);
  const [coarse, setCoarse] = useState(true);
  const [micSupported, setMicSupported] = useState(false);

  const sessionId = useRef<string>('');
  const controller = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const speechIn = useRef<SpeechInput | null>(null);
  const speechOut = useRef<SpeechOutput | null>(null);
  const pendingText = useRef<{ id: string; text: string } | null>(null);
  const flushHandle = useRef<number | null>(null);

  // Client-only state (localStorage, media queries) is loaded after mount so
  // server and client render the same initial HTML.
  useEffect(() => {
    setMessages(loadMessages());
    setInput(loadDraft());
    sessionId.current = loadChatSessionId(() => newId('m'));
    setCoarse(window.matchMedia('(pointer: coarse)').matches);
    setMicSupported(isSpeechInputSupported());
    speechOut.current = createBrowserSpeechOutput();
    return () => {
      controller.current?.abort();
      speechIn.current?.stop();
      speechOut.current?.cancel();
    };
  }, []);

  useEffect(() => {
    if (!streamingId) saveMessages(messages);
  }, [messages, streamingId]);

  useEffect(() => {
    const t = setTimeout(() => saveDraft(input), 300);
    return () => clearTimeout(t);
  }, [input]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [input, interim]);

  const patch = useCallback((id: string, fn: (_m: StoredMessage) => StoredMessage) => {
    setMessages((list) => list.map((m) => (m.id === id ? fn(m) : m)));
  }, []);

  // Deltas arrive token-by-token; batch them into one render per frame.
  const flushDeltas = useCallback(() => {
    flushHandle.current = null;
    const pending = pendingText.current;
    if (!pending || !pending.text) return;
    const { id, text } = pending;
    pending.text = '';
    patch(id, (m) => ({ ...m, text: m.text + text }));
  }, [patch]);

  const send = useCallback(async (text: string, retryUserId?: string) => {
    const message = text.trim();
    if (!message || controller.current) return;

    const now = Date.now();
    const assistantId = newId('a');
    const assistant: StoredMessage = { id: assistantId, role: 'assistant', text: '', at: now, status: 'sent' };
    nearBottom.current = true;

    if (retryUserId) {
      // Retry: drop the failed reply, keep the original question in place.
      setMessages((list) => {
        const idx = list.findIndex((m) => m.id === retryUserId);
        const kept = list.filter((m, i) => !(i === idx + 1 && m.role === 'assistant' && m.status !== 'complete'));
        const at = kept.findIndex((m) => m.id === retryUserId);
        return [...kept.slice(0, at + 1), assistant, ...kept.slice(at + 1)];
      });
    } else {
      const user: StoredMessage = { id: newId('u'), role: 'user', text: message, at: now, status: 'sent' };
      setMessages((list) => [...list, user, assistant]);
      setInput('');
      saveDraft('');
    }

    const ac = new AbortController();
    controller.current = ac;
    setStreamingId(assistantId);
    pendingText.current = { id: assistantId, text: '' };
    speechOut.current?.cancel();

    let fullText = '';
    let sawApproval = false;
    const outcome = await streamChat({ message, sessionId: sessionId.current, signal: ac.signal }, (event) => {
      if (event.type === 'delta') {
        fullText += event.text;
        if (pendingText.current) pendingText.current.text += event.text;
        if (flushHandle.current === null) flushHandle.current = requestAnimationFrame(flushDeltas);
      } else if (event.type === 'meta') {
        patch(assistantId, (m) => ({ ...m, model: event.model }));
      } else if (event.type === 'tool') {
        const note = `${event.name || 'tool'} — ${event.status || 'ran'}${event.error ? `: ${event.error}` : ''}`;
        patch(assistantId, (m) => ({ ...m, notes: [...(m.notes || []), note] }));
      } else if (event.type === 'actions') {
        if (event.actions.some((a) => a.status === 'pending_approval')) sawApproval = true;
        const notes = describeActions(event);
        if (notes.length) patch(assistantId, (m) => ({ ...m, notes: [...(m.notes || []), ...notes] }));
      }
    });

    if (flushHandle.current !== null) cancelAnimationFrame(flushHandle.current);
    flushDeltas();
    pendingText.current = null;
    controller.current = null;

    if (outcome.ok) {
      patch(assistantId, (m) => ({ ...m, status: 'complete' }));
      if (speakReplies && fullText) speechOut.current?.speak(fullText);
      if (sawApproval) onTasksChanged();
    } else if (outcome.error.kind === 'aborted') {
      patch(assistantId, (m) => ({ ...m, status: 'cancelled' }));
    } else {
      patch(assistantId, (m) => ({
        ...m,
        status: outcome.partial ? 'interrupted' : 'failed',
        error: outcome.error.message,
      }));
      if (['not_paired', 'unauthorized'].includes(outcome.error.kind)) onAuthError(outcome.error);
    }
    setStreamingId(null);
  }, [flushDeltas, onAuthError, onTasksChanged, patch, speakReplies]);

  const cancel = () => controller.current?.abort();

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Physical keyboards: Enter sends, Shift+Enter is a newline. Touch
    // keyboards: Enter is always a newline; the Send button sends.
    if (e.key === 'Enter' && !e.shiftKey && (!coarse || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send(input);
    }
  };

  const toggleMic = () => {
    setVoiceError(null);
    if (listening) {
      speechIn.current?.stop();
      return;
    }
    speechIn.current = createBrowserSpeechInput({
      onPartial: (t) => setInterim(t),
      onFinal: (t) => {
        setInterim('');
        // Recognised speech only fills the composer; the user decides to send.
        setInput((cur) => (cur ? `${cur.replace(/\s+$/, '')} ${t}` : t));
      },
      onError: (msg) => setVoiceError(msg),
      onEnd: () => { setListening(false); setInterim(''); },
    });
    if (speechIn.current) {
      setListening(true);
      speechIn.current.start();
    }
  };

  const startNew = () => {
    controller.current?.abort();
    sessionId.current = resetChatSession(() => newId('m'));
    setMessages([]);
    setVisible(PAGE);
    setConfirmReset(false);
  };

  const shown = messages.slice(-visible);
  const hidden = messages.length - shown.length;
  const streaming = streamingId !== null;
  const lastUserBefore = (idx: number) => {
    for (let i = idx - 1; i >= 0; i -= 1) if (shown[i].role === 'user') return shown[i];
    return null;
  };

  return (
    <>
      <div className={styles.chatToolbar}>
        <span>{messages.length ? `${messages.length} messages on this phone` : 'New conversation'}</span>
        <button type="button" className={styles.linkButton} onClick={() => setConfirmReset(true)} disabled={!messages.length}>
          New chat
        </button>
      </div>

      <div className={styles.scroll} ref={scrollRef} onScroll={onScroll}>
        {!messages.length && (
          <div className={styles.emptyChat}>
            <p style={{ fontSize: 18, fontWeight: 650, margin: 0 }}>Ask Heidi about HYDI</p>
            <p className={styles.muted}>Replies come from the live HYDI system. If HYDI is unreachable you’ll see that, not a made-up answer.</p>
            <div className={styles.chips}>
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className={styles.chip} onClick={() => void send(s)} disabled={streaming || !online}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {hidden > 0 && (
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <button type="button" className={styles.linkButton} onClick={() => setVisible((v) => v + PAGE)}>
              Show {Math.min(PAGE, hidden)} earlier messages
            </button>
          </div>
        )}

        <div className={styles.chatList} role="log" aria-live="polite" aria-relevant="additions">
          {shown.map((m, idx) => {
            const isStreaming = m.id === streamingId;
            const failed = m.status === 'failed' || m.status === 'interrupted';
            const retryTarget = failed ? lastUserBefore(idx) : null;
            return (
              <div
                key={m.id}
                className={`${m.role === 'user' ? styles.msgUser : styles.msgAssistant} ${failed ? styles.msgFailed : ''}`}
              >
                {m.text ? <span className={isStreaming ? styles.typing : undefined}>{m.text}</span>
                  : isStreaming ? <span className={`${styles.muted} ${styles.typing}`}>Heidi is thinking</span>
                    : m.role === 'assistant' && failed ? null
                      : m.status === 'cancelled' ? <span className={styles.muted}>(no reply — cancelled)</span> : null}
                {(m.notes || []).map((n, i) => <div key={i} className={styles.toolLine}>⚙ {n}</div>)}
                {failed && (
                  <div className={styles.errorText} role="alert" style={{ marginTop: m.text ? 8 : 0 }}>
                    {m.status === 'interrupted' ? 'Reply cut off: ' : 'Not sent to HYDI: '}{m.error || 'request failed'}
                  </div>
                )}
                <div className={styles.msgMeta}>
                  <span>{clockTime(m.at)}</span>
                  {m.model && <span>· {m.model}</span>}
                  {m.status === 'cancelled' && <span>· cancelled</span>}
                  {retryTarget && !streaming && (
                    <button type="button" className={styles.linkButton} onClick={() => void send(retryTarget.text, retryTarget.id)}>
                      Retry
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {(voiceError || !online) && (
        <div className={`${styles.banner} ${voiceError ? styles.bannerWarn : styles.bannerBad}`} role="status">
          {voiceError || 'You’re offline. Your draft is kept on this phone; send it once you’re back online.'}
        </div>
      )}

      <form
        className={styles.composer}
        onSubmit={(e) => { e.preventDefault(); void send(input); }}
      >
        {micSupported && (
          <button
            type="button"
            className={`${styles.iconButton} ${listening ? styles.micActive : ''}`}
            onClick={toggleMic}
            aria-label={listening ? 'Stop voice input' : 'Speak a message'}
            aria-pressed={listening}
            disabled={streaming}
          >
            🎙
          </button>
        )}
        <label htmlFor="heidi-composer" className={styles.srOnly}>Message Heidi</label>
        <textarea
          id="heidi-composer"
          ref={textareaRef}
          className={styles.textarea}
          rows={1}
          value={interim ? `${input}${input ? ' ' : ''}${interim}` : input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={listening ? 'Listening…' : 'Message Heidi'}
          enterKeyHint={coarse ? 'enter' : 'send'}
          maxLength={4000}
          autoComplete="off"
          readOnly={listening}
        />
        {streaming ? (
          <button type="button" className={styles.stopButton} onClick={cancel} aria-label="Stop generating">■</button>
        ) : (
          <button type="submit" className={styles.sendButton} aria-label="Send" disabled={!input.trim() || !online}>➤</button>
        )}
      </form>

      {confirmReset && (
        <ConfirmSheet
          title="Start a new chat?"
          body="This clears the conversation saved on this phone and starts a fresh HYDI session. HYDI’s own records are not affected."
          confirmLabel="Start new chat"
          onConfirm={startNew}
          onCancel={() => setConfirmReset(false)}
        />
      )}
    </>
  );
}
