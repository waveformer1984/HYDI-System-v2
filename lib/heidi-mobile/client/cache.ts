/**
 * Local-first cache for Heidi Mobile (browser localStorage).
 *
 * Stores only what makes the app useful while HYDI is unreachable — recent
 * conversation, the last status/task snapshots, and preferences — each
 * stamped with when it was saved so the UI can label it as stale rather
 * than present it as live. Never stores credentials: the session lives in
 * an HttpOnly cookie that script cannot read, and sanitizeForStorage()
 * strips any credential-shaped field defensively before every write.
 *
 * Every access is wrapped: private mode, quota errors, or disabled storage
 * degrade to "no cache", never to a crash.
 */

const PREFIX = 'heidi.v1.';
export const MAX_MESSAGES = 100;
const MAX_MESSAGE_CHARS = 8000;

const FORBIDDEN_KEY = /secret|signing|token|password|cookie|authorization|api[_-]?key/i;

export interface Snapshot<T> {
  data: T;
  savedAt: number;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  status: 'sent' | 'complete' | 'failed' | 'cancelled' | 'interrupted';
  error?: string;
  model?: string | null;
  /** Tool/action notes shown under a reply (e.g. "create_task — pending approval"). */
  notes?: string[];
}

export interface Preferences {
  speakReplies: boolean;
  lastTab: 'chat' | 'status' | 'tasks' | 'control';
}

export const DEFAULT_PREFERENCES: Preferences = { speakReplies: false, lastTab: 'chat' };

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Recursively drop credential-shaped keys. Exported for tests. */
export function sanitizeForStorage(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeForStorage(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEY.test(k)) continue;
    out[k] = sanitizeForStorage(v, depth + 1);
  }
  return out;
}

function read<T>(key: string): T | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PREFIX + key, JSON.stringify(sanitizeForStorage(value)));
  } catch {
    // Quota exceeded or storage disabled: caching is best-effort.
  }
}

export function loadSnapshot<T>(key: 'status' | 'tasks' | 'activity'): Snapshot<T> | null {
  const snap = read<Snapshot<T>>(`snapshot.${key}`);
  if (!snap || typeof snap.savedAt !== 'number' || snap.data === undefined) return null;
  return snap;
}

export function saveSnapshot<T>(key: 'status' | 'tasks' | 'activity', data: T, now = Date.now()): void {
  write(`snapshot.${key}`, { data, savedAt: now });
}

export function loadMessages(): StoredMessage[] {
  const list = read<StoredMessage[]>('messages');
  if (!Array.isArray(list)) return [];
  return list.filter((m) => m && typeof m.text === 'string' && (m.role === 'user' || m.role === 'assistant')).slice(-MAX_MESSAGES);
}

export function saveMessages(messages: StoredMessage[]): void {
  const trimmed = messages.slice(-MAX_MESSAGES).map((m) => ({
    ...m,
    // A reply still streaming when the app closed is saved as interrupted,
    // not as if it had completed.
    status: m.status === 'sent' && m.role === 'assistant' ? 'interrupted' : m.status,
    text: m.text.length > MAX_MESSAGE_CHARS ? `${m.text.slice(0, MAX_MESSAGE_CHARS)}…` : m.text,
  }));
  write('messages', trimmed);
}

export function loadPreferences(): Preferences {
  const p = read<Partial<Preferences>>('prefs') || {};
  return {
    speakReplies: typeof p.speakReplies === 'boolean' ? p.speakReplies : DEFAULT_PREFERENCES.speakReplies,
    lastTab: p.lastTab && ['chat', 'status', 'tasks', 'control'].includes(p.lastTab) ? p.lastTab : DEFAULT_PREFERENCES.lastTab,
  };
}

export function savePreferences(prefs: Preferences): void {
  write('prefs', prefs);
}

export function loadChatSessionId(generate: () => string): string {
  const existing = read<string>('chatSession');
  if (typeof existing === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing;
  const id = generate();
  write('chatSession', id);
  return id;
}

export function resetChatSession(generate: () => string): string {
  const id = generate();
  write('chatSession', id);
  write('messages', []);
  return id;
}

/**
 * The unsent composer text. Chat messages are never queued for automatic
 * sending later — an instruction typed while offline could be stale by the
 * time it would go out — so the draft is kept for the user to send
 * deliberately once HYDI is reachable again.
 */
export function loadDraft(): string {
  const d = read<string>('draft');
  return typeof d === 'string' ? d.slice(0, 4000) : '';
}

export function saveDraft(text: string): void {
  write('draft', text.slice(0, 4000));
}

/** Wipe everything Heidi stored on this phone (used on unpair). */
export function clearAll(): void {
  const s = storage();
  if (!s) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => s.removeItem(k));
  } catch {
    // ignore
  }
}
