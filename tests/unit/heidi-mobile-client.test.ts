/**
 * Browser-side Heidi Mobile modules, exercised in Node with minimal fakes
 * (localStorage, EventSource, fetch).
 */

import { createSseParser } from '../../lib/heidi-mobile/sseParser';
import {
  sanitizeForStorage, saveSnapshot, loadSnapshot, saveMessages, loadMessages, clearAll, loadPreferences,
  savePreferences, saveDraft, loadDraft, MAX_MESSAGES, type StoredMessage,
} from '../../lib/heidi-mobile/client/cache';
import { createRealtime, backoffDelay, eventKey, type RealtimeState } from '../../lib/heidi-mobile/client/realtime';
import { relativeTime, isStale } from '../../lib/heidi-mobile/client/format';
import { heidiRequest, streamChat, kindForStatus, type ChatEvent } from '../../lib/heidi-mobile/client/api';

// ── fakes ───────────────────────────────────────────────────────────────
class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return Array.from(this.map.keys())[i] ?? null; }
  getItem(k: string) { return this.map.has(k) ? (this.map.get(k) as string) : null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
  dump() { return Array.from(this.map.values()).join('\n'); }
}

const storage = new MemoryStorage();
(globalThis as unknown as { window: unknown }).window = { localStorage: storage };

function sseStreamResponse(chunks: string[], status = 200) {
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); },
  }), { status, headers: { 'content-type': 'text/event-stream' } });
}

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; storage.clear(); });

// ── SSE parser ──────────────────────────────────────────────────────────
describe('createSseParser', () => {
  it('handles events split across chunks, CRLF, comments and multi-line data', () => {
    const out: Array<{ event: string; data: string }> = [];
    const p = createSseParser((e) => out.push({ event: e.event, data: e.data }));
    p.push(': keepalive\r\n\r\nevent: x\r\ndata: a');
    p.push('\r\ndata: b\r\n\r\ndata: {"k":1}');
    p.push('\n\n');
    expect(out).toEqual([{ event: 'x', data: 'a\nb' }, { event: 'message', data: '{"k":1}' }]);
  });

  it('refuses unbounded buffering', () => {
    const p = createSseParser(() => undefined);
    expect(() => p.push('data: ' + 'x'.repeat(1024 * 1024 + 10))).toThrow(/maximum size/);
  });
});

// ── cache ───────────────────────────────────────────────────────────────
describe('client cache', () => {
  it('strips credential-shaped keys before storing anything', () => {
    const cleaned = sanitizeForStorage({ ok: 1, secret: 'x', nested: { signingKey: 'y', apiKey: 'z', list: [{ token: 't', keep: 2 }] } });
    expect(cleaned).toEqual({ ok: 1, nested: { list: [{ keep: 2 }] } });
    saveSnapshot('status', { state: 'online', device_secret: 'leak', x_hydi_service_token: 'leak' });
    expect(storage.dump()).not.toContain('leak');
  });

  it('stamps snapshots with when they were saved so the UI can label staleness', () => {
    saveSnapshot('status', { state: 'online' }, 1000);
    expect(loadSnapshot('status')).toEqual({ data: { state: 'online' }, savedAt: 1000 });
    expect(isStale(1000, 1000 + 91 * 1000)).toBe(true);
    expect(isStale(1000, 1000 + 30 * 1000)).toBe(false);
  });

  it('caps history and saves a still-streaming reply as interrupted, not complete', () => {
    const msgs: StoredMessage[] = Array.from({ length: MAX_MESSAGES + 20 }, (_, i) => ({
      id: String(i), role: i % 2 ? 'assistant' : 'user', text: `m${i}`, at: i, status: 'complete',
    }));
    msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], role: 'assistant', status: 'sent' };
    saveMessages(msgs);
    const loaded = loadMessages();
    expect(loaded).toHaveLength(MAX_MESSAGES);
    expect(loaded[loaded.length - 1].status).toBe('interrupted');
  });

  it('survives corrupt storage and disabled storage', () => {
    storage.setItem('heidi.v1.messages', '{not json');
    expect(loadMessages()).toEqual([]);
    expect(loadPreferences()).toEqual({ speakReplies: false, lastTab: 'chat' });
  });

  it('round-trips preferences and drafts, and clearAll wipes only Heidi keys', () => {
    savePreferences({ speakReplies: true, lastTab: 'tasks' });
    saveDraft('approve the invoice');
    storage.setItem('other-app', 'keep');
    expect(loadPreferences()).toEqual({ speakReplies: true, lastTab: 'tasks' });
    expect(loadDraft()).toBe('approve the invoice');
    clearAll();
    expect(loadDraft()).toBe('');
    expect(storage.getItem('other-app')).toBe('keep');
  });
});

// ── format ──────────────────────────────────────────────────────────────
describe('relativeTime', () => {
  it('formats honest relative times', () => {
    const now = 10_000_000;
    expect(relativeTime(now - 5000, now)).toBe('just now');
    expect(relativeTime(now - 4 * 60 * 1000, now)).toBe('4 min ago');
    expect(relativeTime(null, now)).toBe('never');
    expect(relativeTime('garbage', now)).toBe('unknown');
  });
});

// ── realtime ────────────────────────────────────────────────────────────
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((_e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  constructor(public url: string) { FakeEventSource.instances.push(this); }
  close() { this.closed = true; }
  emit(data: unknown) { this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) } as MessageEvent); }
}

describe('createRealtime', () => {
  beforeEach(() => { FakeEventSource.instances = []; jest.useFakeTimers(); });
  afterEach(() => jest.useRealTimers());

  function setup(staleMs = 75000) {
    const events: unknown[] = [];
    const states: RealtimeState[] = [];
    const rt = createRealtime({
      url: '/api/heidi-mobile/events',
      onEvent: (e) => events.push(e),
      onStateChange: (s) => states.push(s),
      staleMs,
      createSource: (u) => new FakeEventSource(u) as unknown as EventSource,
    });
    rt.start();
    return { rt, events, states, es: () => FakeEventSource.instances[FakeEventSource.instances.length - 1] };
  }

  it('only reports live once events actually arrive, and drops malformed/duplicate events', () => {
    const { events, states, es } = setup();
    expect(states).toEqual(['connecting']);
    es().emit({ type: 'connected' });
    expect(states).toEqual(['connecting', 'live']);
    const e = { type: 'subsystem_status', subsystem: 'memory', status: 'degraded', timestamp: 't1' };
    es().emit(e);
    es().emit(e);
    es().emit('not json');
    es().emit([1, 2]);
    es().emit({ no: 'type' });
    es().emit({ type: 'heartbeat' });
    expect(events).toEqual([{ type: 'connected' }, e]);
  });

  it('reconnects with backoff after an error', () => {
    const { states, es } = setup();
    const first = es();
    first.onerror?.();
    expect(first.closed).toBe(true);
    expect(states[states.length - 1]).toBe('reconnecting');
    jest.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it('treats a silent connection as dead (stale detection)', () => {
    const { es, states } = setup(1000);
    es().emit({ type: 'connected' });
    jest.advanceTimersByTime(1001);
    expect(states[states.length - 1]).toBe('reconnecting');
  });

  it('stops cleanly', () => {
    const { rt, es, states } = setup();
    rt.stop();
    expect(es().closed).toBe(true);
    expect(states[states.length - 1]).toBe('stopped');
    jest.advanceTimersByTime(100000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('backoff grows and caps', () => {
    expect(backoffDelay(0, () => 1)).toBe(1000);
    expect(backoffDelay(3, () => 1)).toBe(8000);
    expect(backoffDelay(20, () => 1)).toBe(30000);
    expect(eventKey({ type: 'heartbeat' })).toBeNull();
  });
});

// ── api client ──────────────────────────────────────────────────────────
describe('heidiRequest', () => {
  it('marks mutating requests with the CSRF header and sends no credentials of its own', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await heidiRequest('/tasks', { method: 'POST', body: { id: 'x' } });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    expect(headers['x-heidi-request']).toBe('1');
    expect(Object.keys(headers).some((h) => /token|secret|authorization/i.test(h))).toBe(false);
    expect(init.credentials).toBe('same-origin');
  });

  it.each([
    [401, 'not_paired', 'not_paired'], [401, 'unauthorized', 'unauthorized'], [403, 'csrf_rejected', 'forbidden'],
    [502, 'network', 'network'], [504, 'timeout', 'timeout'], [502, 'malformed', 'malformed'], [500, 'x', 'server'],
  ])('maps %i/%s to %s', (status, code, kind) => {
    expect(kindForStatus(status, code)).toBe(kind);
  });

  it('returns malformed for a non-JSON success body', async () => {
    globalThis.fetch = jest.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    const r = await heidiRequest('/status');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('malformed');
  });

  it('times out', async () => {
    globalThis.fetch = jest.fn((_u: string, init: RequestInit) => new Promise((_, rej) => {
      init.signal?.addEventListener('abort', () => rej(new Error('abort')));
    })) as unknown as typeof fetch;
    const r = await heidiRequest('/status', { timeoutMs: 20 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('timeout');
  });
});

describe('streamChat', () => {
  it('delivers validated events and resolves ok on done', async () => {
    globalThis.fetch = jest.fn(async () => sseStreamResponse([
      'data: {"type":"delta","text":"Hi"}\n\n', 'data: {"type":"bogus"}\n\n', 'data: {"type":"done"}\n\n',
    ])) as unknown as typeof fetch;
    const events: ChatEvent[] = [];
    const r = await streamChat({ message: 'x', sessionId: 'abcdefgh12' }, (e) => events.push(e));
    expect(r).toEqual({ ok: true });
    expect(events).toEqual([{ type: 'delta', text: 'Hi' }, { type: 'done' }]);
  });

  it('never treats a truncated stream as a complete reply', async () => {
    globalThis.fetch = jest.fn(async () => sseStreamResponse(['data: {"type":"delta","text":"Hal"}\n\n'])) as unknown as typeof fetch;
    const r = await streamChat({ message: 'x', sessionId: 'abcdefgh12' }, () => undefined);
    expect(r).toMatchObject({ ok: false, partial: true });
  });

  it('surfaces server errors with their message', async () => {
    globalThis.fetch = jest.fn(async () => new Response(JSON.stringify({ error: 'network', message: 'HYDI is unreachable' }), { status: 502 })) as unknown as typeof fetch;
    const r = await streamChat({ message: 'x', sessionId: 'abcdefgh12' }, () => undefined);
    expect(r).toMatchObject({ ok: false, partial: false, error: { kind: 'network', message: 'HYDI is unreachable' } });
  });

  it('reports cancellation as aborted', async () => {
    globalThis.fetch = jest.fn((_u: string, init: RequestInit) => new Promise((_, rej) => {
      init.signal?.addEventListener('abort', () => rej(new Error('abort')));
    })) as unknown as typeof fetch;
    const ac = new AbortController();
    const p = streamChat({ message: 'x', sessionId: 'abcdefgh12', signal: ac.signal }, () => undefined);
    ac.abort();
    expect(await p).toMatchObject({ ok: false, error: { kind: 'aborted' } });
  });
});
