// @vitest-environment node
import { describe, expect, it, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/hydi-devices-proxy', () => ({
  listDevices: vi.fn(async () => ({ ok: true, pending: [] })),
  postDeviceAction: vi.fn(async () => ({ ok: true, device: { device_id: 'd1', role: 'operator', status: 'approved' } })),
}));

describe('/api/devices guards', () => {
  afterEach(() => vi.clearAllMocks());

  it('refuses non-loopback callers', async () => {
    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://192.168.1.2/api/devices', { headers: { host: '192.168.1.2:3100' } }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('local_only');
  });

  it('refuses cross-origin POST without x-ursula-request', async () => {
    const { POST } = await import('./[deviceId]/route');
    const res = await POST(
      new NextRequest('http://127.0.0.1:3100/api/devices/abc', {
        method: 'POST',
        headers: { host: '127.0.0.1:3100', origin: 'https://evil.example', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      }),
      { params: Promise.resolve({ deviceId: 'abc' }) },
    );
    expect(res.status).toBe(403);
  });

  it('allows loopback approve and omits secrets from response body', async () => {
    process.env.HYDI_SERVICE_SECRET = 'route-test-secret';
    const { POST } = await import('./[deviceId]/route');
    const res = await POST(
      new NextRequest('http://127.0.0.1:3100/api/devices/abc', {
        method: 'POST',
        headers: { host: '127.0.0.1:3100', 'x-ursula-request': '1', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      }),
      { params: Promise.resolve({ deviceId: 'abc' }) },
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('route-test-secret');
    delete process.env.HYDI_SERVICE_SECRET;
  });
});
