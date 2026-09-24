/**
 * Realtime connection to /api/heidi-mobile/events (a relay of HYDI's
 * existing mobile-ops SSE stream).
 *
 * The browser's EventSource retries on its own, but it cannot tell a silent
 * dead connection from a quiet one and it retries forever on a fixed
 * interval. This wrapper adds what the phone needs:
 *   - exponential backoff with jitter (1s → 30s) after failures;
 *   - stale detection: HYDI sends a heartbeat every 30s, so no traffic for
 *     STALE_MS means the connection is dead even if the socket isn't;
 *   - duplicate suppression across reconnects;
 *   - malformed events dropped rather than delivered;
 *   - an explicit state the UI shows, so "live" is only claimed while
 *     events are actually arriving.
 */

export type RealtimeState = 'connecting' | 'live' | 'reconnecting' | 'stopped';

export interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

export interface RealtimeOptions {
  url: string;
  onEvent: (_event: RealtimeEvent) => void;
  onStateChange: (_state: RealtimeState) => void;
  staleMs?: number;
  /** Injectable for tests. */
  createSource?: (_url: string) => EventSource;
}

export interface RealtimeHandle {
  start: () => void;
  stop: () => void;
}

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const DEFAULT_STALE_MS = 75000;
const DEDUPE_WINDOW = 200;

export function backoffDelay(attempt: number, random = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** Math.max(0, attempt));
  return Math.round(base / 2 + random() * (base / 2));
}

/** Stable identity for an event, so a replay after reconnect is ignored. */
export function eventKey(e: RealtimeEvent): string | null {
  if (e.type === 'heartbeat' || e.type === 'connected') return null;
  const parts = [e.type, e.timestamp, e.subsystem, e.status, e.id, e.command_id, e.category];
  return parts.map((p) => (p === undefined || p === null ? '' : String(p))).join('|');
}

export function createRealtime(opts: RealtimeOptions): RealtimeHandle {
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const make = opts.createSource || ((url: string) => new EventSource(url));
  let source: EventSource | null = null;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let state: RealtimeState = 'stopped';
  const seen: string[] = [];
  const seenSet = new Set<string>();

  const setState = (next: RealtimeState) => {
    if (next !== state) {
      state = next;
      opts.onStateChange(next);
    }
  };

  const clearTimers = () => {
    if (retryTimer) clearTimeout(retryTimer);
    if (staleTimer) clearTimeout(staleTimer);
    retryTimer = null;
    staleTimer = null;
  };

  const closeSource = () => {
    if (source) {
      source.onmessage = null;
      source.onerror = null;
      source.onopen = null;
      source.close();
      source = null;
    }
  };

  const scheduleReconnect = () => {
    closeSource();
    if (!running) return;
    setState('reconnecting');
    const delay = backoffDelay(attempt);
    attempt += 1;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, delay);
  };

  const armStale = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(scheduleReconnect, staleMs);
  };

  function connect() {
    if (!running) return;
    closeSource();
    if (state !== 'reconnecting') setState('connecting');
    let es: EventSource;
    try {
      es = make(opts.url);
    } catch {
      scheduleReconnect();
      return;
    }
    source = es;
    armStale();
    es.onopen = () => armStale();
    es.onmessage = (msg: MessageEvent) => {
      armStale();
      let data: unknown;
      try { data = JSON.parse(String(msg.data)); } catch { return; }
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      const event = data as RealtimeEvent;
      if (typeof event.type !== 'string') return;
      attempt = 0;
      setState('live');
      const key = eventKey(event);
      if (key) {
        if (seenSet.has(key)) return;
        seen.push(key);
        seenSet.add(key);
        if (seen.length > DEDUPE_WINDOW) seenSet.delete(seen.shift() as string);
      }
      if (event.type !== 'heartbeat') opts.onEvent(event);
    };
    // EventSource's own retry would ignore our backoff; take over instead.
    es.onerror = () => scheduleReconnect();
  }

  return {
    start() {
      if (running) return;
      running = true;
      attempt = 0;
      connect();
    },
    stop() {
      running = false;
      clearTimers();
      closeSource();
      setState('stopped');
    },
  };
}
