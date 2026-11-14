import { mintHydiServiceToken } from '@/lib/hydi-service-token';

export type DeviceRow = {
  device_id: string;
  device_name: string | null;
  role: string;
  status: string;
  last_seen_at: string | null;
  created_at: string;
};

function hydiBaseUrl(): string {
  return (process.env.HYDI_API_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
}

function serviceSecret(): string | undefined {
  return process.env.HYDI_SERVICE_SECRET;
}

function authHeaders(): Record<string, string> {
  const secret = serviceSecret();
  if (!secret) return {};
  return { 'x-hydi-service-token': mintHydiServiceToken(secret, 'ursula') };
}

export async function listDevices(fetchImpl: typeof fetch = fetch): Promise<
  { ok: true; pending: DeviceRow[] } | { ok: false; error: string; status?: number }
> {
  const secret = serviceSecret();
  if (!secret) return { ok: false, error: 'HYDI_SERVICE_SECRET not configured on Ursula (server env only)' };
  let res: Response;
  try {
    res = await fetchImpl(`${hydiBaseUrl()}/api/devices`, {
      headers: { Accept: 'application/json', ...authHeaders() },
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'heidi-web unreachable' };
  }
  const text = await res.text();
  let data: { devices?: DeviceRow[]; error?: string };
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok) return { ok: false, error: data.error || text.slice(0, 200) || `HTTP ${res.status}`, status: res.status };
  const devices = Array.isArray(data.devices) ? data.devices : [];
  const pending = devices.filter((d) => d.status === 'pending');
  return { ok: true, pending };
}

export async function postDeviceAction(
  deviceId: string,
  action: 'approve' | 'revoke',
  extra: Record<string, unknown> = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; device: DeviceRow } | { ok: false; error: string; status?: number }> {
  const secret = serviceSecret();
  if (!secret) return { ok: false, error: 'HYDI_SERVICE_SECRET not configured on Ursula (server env only)' };
  let res: Response;
  try {
    res = await fetchImpl(`${hydiBaseUrl()}/api/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeaders() },
      body: JSON.stringify({ action, device_id: deviceId, ...extra }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'heidi-web unreachable' };
  }
  const text = await res.text();
  let data: { device?: DeviceRow; error?: string; secret?: string };
  try { data = JSON.parse(text); } catch { data = {}; }
  if (!res.ok) return { ok: false, error: data.error || text.slice(0, 200) || `HTTP ${res.status}`, status: res.status };
  if (!data.device) return { ok: false, error: 'unexpected upstream response' };
  // Never leak registration secrets if a caller misconfigured upstream.
  const { secret: _ignored, ...device } = data.device as DeviceRow & { secret?: string };
  return { ok: true, device: device as DeviceRow };
}
