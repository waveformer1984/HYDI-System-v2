/** Time/staleness formatting for Heidi Mobile. Pure; `now` is injectable for tests. */

export function relativeTime(at: number | string | null | undefined, now = Date.now()): string {
  if (at === null || at === undefined) return 'never';
  const t = typeof at === 'number' ? at : new Date(at).getTime();
  if (!Number.isFinite(t)) return 'unknown';
  const s = Math.round((now - t) / 1000);
  if (s < 0) return 'just now';
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} d ago`;
}

/** Data older than this is labelled stale in the UI. */
export const STALE_AFTER_MS = 90 * 1000;

export function isStale(savedAt: number | null | undefined, now = Date.now(), staleAfterMs = STALE_AFTER_MS): boolean {
  if (!savedAt) return true;
  return now - savedAt > staleAfterMs;
}

export function clockTime(at: number | string, locale?: string): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function newId(prefix = ''): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return prefix + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
