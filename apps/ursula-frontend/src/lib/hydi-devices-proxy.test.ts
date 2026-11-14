// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listDevices, postDeviceAction } from './hydi-devices-proxy';

const SECRET = 'unit-test-secret-not-for-production';

describe('hydi-devices-proxy', () => {
  afterEach(() => {
    delete process.env.HYDI_SERVICE_SECRET;
    delete process.env.HYDI_API_URL;
    vi.restoreAllMocks();
  });

  it('never returns service secrets in JSON payloads', async () => {
    process.env.HYDI_SERVICE_SECRET = SECRET;
    process.env.HYDI_API_URL = 'http://127.0.0.1:3999';
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/api/devices');
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-hydi-service-token']).toBeTruthy();
      expect(headers['x-hydi-service-token']).not.toContain(SECRET);
      return new Response(JSON.stringify({
        devices: [{ device_id: 'phone-1', device_name: 'Pixel', role: 'viewer', status: 'pending', created_at: '2026-01-01T00:00:00Z', last_seen_at: null }],
      }), { status: 200 });
    });
    const out = await listDevices(fetchImpl);
    expect(out.ok).toBe(true);
    if (out.ok) {
      const blob = JSON.stringify(out);
      expect(blob).not.toContain(SECRET);
      expect(blob).not.toMatch(/x-hydi-service-token/);
    }
  });

  it('approve strips accidental secret fields from upstream', async () => {
    process.env.HYDI_SERVICE_SECRET = SECRET;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      device: { device_id: 'x', role: 'operator', status: 'approved', secret: 'must-not-leak' },
    }), { status: 200 }));
    const out = await postDeviceAction('x', 'approve', { role: 'operator' }, fetchImpl);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(JSON.stringify(out.device)).not.toContain('must-not-leak');
      expect((out.device as { secret?: string }).secret).toBeUndefined();
    }
  });
});
