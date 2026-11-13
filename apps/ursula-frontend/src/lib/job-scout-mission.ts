/**
 * "Run scan now" — files an informational heidi-core mission through the
 * existing POST /missions surface (same pattern as /api/apps/[id]/start).
 * Ursula never spawns the scan process itself; a mission is the governed
 * request, and hydi-schedulers / an operator decides execution.
 */

export interface MissionResult {
  ok: boolean;
  mission?: unknown;
  error?: string;
}

export async function fileScanNowMission(opts: {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
} = {}): Promise<MissionResult> {
  const endpoint = (opts.endpoint || process.env.HEIDI_CORE_URL || 'http://localhost:3459').replace(/\/$/, '');
  const fetcher = opts.fetchImpl || fetch;
  const timeoutMs = opts.timeoutMs ?? 4000;
  try {
    const res = await fetcher(`${endpoint}/missions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        goal: 'Run the job-scout scan now (node scripts/job-scout.js --once)',
        source: 'ursula-freelance',
        priority: 1,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (json.error as string) || `heidi-core ${res.status}` };
    return { ok: true, mission: json.mission };
  } catch (e) {
    return { ok: false, error: `mission surface unreachable: ${(e as Error)?.message || e}` };
  }
}
