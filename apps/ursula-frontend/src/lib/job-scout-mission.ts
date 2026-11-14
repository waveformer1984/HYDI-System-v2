/**
 * "Run scan now" — proposes the allowlisted `job_scout_scan` action on
 * heidi-core. The mission worker runs `scripts/job-scout.js --once` with
 * standing approval (read-only toward job sites). Ursula never spawns it.
 */

export interface MissionResult {
  ok: boolean;
  mission?: unknown;
  missionId?: string | number;
  summary?: string;
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
    const res = await fetcher(`${endpoint}/allowlist/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spec: 'job_scout_scan', args: {} }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: (json.error as string) || `heidi-core ${res.status}` };
    return {
      ok: true,
      missionId: json.missionId as string | number | undefined,
      summary: json.summary as string | undefined,
      mission: { id: json.missionId, summary: json.summary },
    };
  } catch (e) {
    return { ok: false, error: `mission surface unreachable: ${(e as Error)?.message || e}` };
  }
}
