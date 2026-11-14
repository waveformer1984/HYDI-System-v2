// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { fileScanNowMission } from './job-scout-mission';

describe('fileScanNowMission', () => {
  it('proposes job_scout_scan on heidi-core /allowlist/propose', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, missionId: 'm1', summary: 'Run job-scout scan now' }),
    })) as unknown as typeof fetch;
    const out = await fileScanNowMission({ endpoint: 'http://heidi:3459/', fetchImpl });
    expect(out.ok).toBe(true);
    expect(out.missionId).toBe('m1');
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://heidi:3459/allowlist/propose');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ spec: 'job_scout_scan', args: {} });
  });

  it('reports heidi-core errors without throwing', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'db down' }),
    })) as unknown as typeof fetch;
    const out = await fileScanNowMission({ endpoint: 'http://heidi:3459', fetchImpl });
    expect(out).toEqual({ ok: false, error: 'db down' });
  });

  it('reports an unreachable mission surface', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    const out = await fileScanNowMission({ endpoint: 'http://heidi:3459', fetchImpl });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unreachable/);
  });
});
