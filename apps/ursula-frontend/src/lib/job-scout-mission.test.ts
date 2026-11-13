// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { fileScanNowMission } from './job-scout-mission';

describe('fileScanNowMission', () => {
  it('POSTs an informational mission to heidi-core /missions', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ ok: true, mission: { id: 'm1' } }),
    })) as unknown as typeof fetch;
    const out = await fileScanNowMission({ endpoint: 'http://heidi:3459/', fetchImpl });
    expect(out).toEqual({ ok: true, mission: { id: 'm1' } });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('http://heidi:3459/missions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.goal).toMatch(/job-scout/);
    expect(body.source).toBe('ursula-freelance');
    expect(body.action).toBeUndefined(); // informational only — no action payload
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
