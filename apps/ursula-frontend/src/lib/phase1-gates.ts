import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';

export function getTraceId(request: NextRequest): string {
  return (
    request.headers.get('x-trace-id') ||
    request.headers.get('x-request-id') ||
    randomUUID()
  );
}

export function isExecutionKillSwitchEnabled(): boolean {
  return process.env.HYDI_EXECUTION_KILL_SWITCH === 'true';
}

export function buildTraceHeaders(traceId: string): Record<string, string> {
  return { 'x-trace-id': traceId };
}
