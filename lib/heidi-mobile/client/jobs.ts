// Pure helpers for following a mobile-ops job's log from the phone.
// Kept free of React so they are unit-tested (tests/unit/heidi-mobile-jobs-client.test.js).

export interface JobLine {
  seq: number;
  ts: number;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

export const TERMINAL_STATES = ['succeeded', 'failed', 'cancelled', 'timed_out'] as const;

export function isTerminal(state: string): boolean {
  return (TERMINAL_STATES as readonly string[]).includes(state);
}

/**
 * Append newly fetched lines, ignoring duplicates (a retried poll can return
 * lines we already have) and keeping only the newest `max` on the phone.
 */
export function mergeJobLines(existing: JobLine[], incoming: JobLine[], max = 1500): JobLine[] {
  const last = existing.length ? existing[existing.length - 1].seq : 0;
  const fresh = incoming.filter((l) => l.seq > last).sort((a, b) => a.seq - b.seq);
  if (!fresh.length) return existing;
  const merged = existing.concat(fresh);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

/**
 * Delay before the next poll. Running jobs poll quickly; after network
 * failures back off (1s, 2s, 4s … capped at 15s) and keep the cursor, so
 * reconnecting resumes exactly where the log left off.
 */
export function nextPollDelay(failures: number, running: boolean): number {
  if (failures > 0) return Math.min(15_000, 1000 * 2 ** Math.min(failures - 1, 4));
  return running ? 1000 : 0;
}
