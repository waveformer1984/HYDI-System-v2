/**
 * Pure mapping from workspace engineering telemetry to banner rows.
 * The Command Center contract: TIMEOUT/UNAVAILABLE/DEGRADED surface
 * visibly, STALE stays informational, HEALTHY produces no row — and
 * nothing degrades silently into a fake-healthy or a fake-failure.
 */
export type TelemetryStatus = 'HEALTHY' | 'DEGRADED' | 'TIMEOUT' | 'UNAVAILABLE' | 'STALE';

export interface TelemetryReading {
  status: TelemetryStatus;
  observedAt?: string;
  ageMs?: number;
  ms?: number;
}

export interface TelemetryAlert {
  service: string;
  status: TelemetryStatus;
  severity: 'info' | 'warning' | 'critical';
  detail: string;
  blockingNote: string;
}

const SEVERITY: Record<TelemetryStatus, TelemetryAlert['severity']> = {
  HEALTHY: 'info',
  STALE: 'info',       // stale data is not a failure — informational
  DEGRADED: 'warning',
  TIMEOUT: 'critical',
  UNAVAILABLE: 'critical',
};

const BLOCKING: Record<string, string> = {
  'Supabase REST': 'Chat infrastructure may be degraded',
  'PM2': 'Non-blocking: cached telemetry remains available',
  'Ollama': 'Non-blocking: deterministic paths still work',
};

function detailFor(t: TelemetryReading): string {
  switch (t.status) {
    case 'TIMEOUT': return `probe exceeded ${Math.round((t.ms ?? 0) / 1000)}s`;
    case 'STALE': return `last live reading ${Math.round((t.ageMs ?? 0) / 1000)}s ago`;
    case 'DEGRADED': return 'responding but unhealthy';
    case 'UNAVAILABLE': return 'no reading yet — probe warming';
    default: return 'live probe OK';
  }
}

export function buildTelemetryAlerts(eng: {
  supabaseRestTelemetry?: TelemetryReading;
  servicesTelemetry?: TelemetryReading;
  ollamaTelemetry?: TelemetryReading;
} | null | undefined): TelemetryAlert[] {
  if (!eng) return [];
  const sources: Array<{ name: string; t?: TelemetryReading }> = [
    { name: 'Supabase REST', t: eng.supabaseRestTelemetry },
    { name: 'PM2', t: eng.servicesTelemetry },
    { name: 'Ollama', t: eng.ollamaTelemetry },
  ];
  return sources
    .filter(p => p.t && p.t.status !== 'HEALTHY')
    .map(p => ({
      service: p.name,
      status: p.t!.status,
      severity: SEVERITY[p.t!.status],
      detail: detailFor(p.t!),
      blockingNote: BLOCKING[p.name] ?? 'status may affect dependent features',
    }));
}
