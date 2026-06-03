import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  buildTraceHeaders,
  getTraceId,
  isExecutionKillSwitchEnabled,
} from '@/lib/phase1-gates';

describe('phase1 gates', () => {
  it('reads trace id from request headers', () => {
    const request = new NextRequest('http://localhost:3000/api/test', {
      headers: { 'x-trace-id': 'trace-from-header' },
    });

    expect(getTraceId(request)).toBe('trace-from-header');
  });

  it('falls back to generated trace id when headers absent', () => {
    const request = new NextRequest('http://localhost:3000/api/test');
    const traceId = getTraceId(request);
    expect(typeof traceId).toBe('string');
    expect(traceId.length).toBeGreaterThan(0);
  });

  it('evaluates execution kill switch state', () => {
    vi.stubEnv('HYDI_EXECUTION_KILL_SWITCH', 'true');
    expect(isExecutionKillSwitchEnabled()).toBe(true);
    vi.stubEnv('HYDI_EXECUTION_KILL_SWITCH', 'false');
    expect(isExecutionKillSwitchEnabled()).toBe(false);
    vi.unstubAllEnvs();
  });

  it('builds trace response headers', () => {
    expect(buildTraceHeaders('trace-123')).toEqual({ 'x-trace-id': 'trace-123' });
  });
});
