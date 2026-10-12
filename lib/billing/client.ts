/**
 * Browser helpers for the billing pages (pages/pricing.tsx, pages/billing.tsx,
 * pages/billing-admin.tsx). No billing logic lives here — the server decides
 * everything; this only carries credentials and formats numbers for display.
 */

const CUSTOMER_TOKEN_KEY = 'hydi.billing.customerToken';
// Same key + HMAC scheme as pages/coo.tsx and pages/workspace.tsx.
const SERVICE_SECRET_KEY = 'hydi.serviceSecret';

function safeStorage(kind: 'local' | 'session'): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reads the customer token, adopting one passed as ?token= (the onboarding
 * link) into sessionStorage and removing it from the address bar.
 */
export function customerToken(): string | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get('token');
  const store = safeStorage('session');
  if (fromUrl) {
    store?.setItem(CUSTOMER_TOKEN_KEY, fromUrl);
    url.searchParams.delete('token');
    window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
    return fromUrl;
  }
  return store?.getItem(CUSTOMER_TOKEN_KEY) ?? null;
}

export function setCustomerToken(token: string): void {
  safeStorage('session')?.setItem(CUSTOMER_TOKEN_KEY, token.trim());
}

export function clearCustomerToken(): void {
  safeStorage('session')?.removeItem(CUSTOMER_TOKEN_KEY);
}

export interface ApiError { error: string; message?: string; details?: Record<string, unknown> }

export async function customerFetch<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T | ApiError }> {
  const token = customerToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(path, { ...init, headers: { ...headers, ...(init.headers as Record<string, string> | undefined) } });
  const data = (await r.json().catch(() => ({ error: 'bad_response' }))) as T | ApiError;
  return { ok: r.ok, status: r.status, data };
}

export function serviceSecret(): string | null {
  return safeStorage('local')?.getItem(SERVICE_SECRET_KEY) ?? null;
}

export function setServiceSecret(secret: string): void {
  safeStorage('local')?.setItem(SERVICE_SECRET_KEY, secret.trim());
}

export async function mintServiceToken(secret: string): Promise<string> {
  const ts = Date.now().toString();
  const requestId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  const service = 'billing-admin';
  const payload = `${ts}:${requestId}:${service}`;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const sig = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${ts}.${requestId}.${service}.${sig}`;
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: T | ApiError }> {
  const secret = serviceSecret();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['x-hydi-service-token'] = await mintServiceToken(secret);
  const r = await fetch(path, { ...init, headers });
  const data = (await r.json().catch(() => ({ error: 'bad_response' }))) as T | ApiError;
  return { ok: r.ok, status: r.status, data };
}

/** Display-only formatting of integer minor units. Never used for arithmetic. */
export function formatMoney(amountMinor: number | null | undefined, currency: string): string {
  if (amountMinor === null || amountMinor === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(amountMinor / 100);
  } catch {
    return `${(amountMinor / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function formatDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function intervalLabel(interval: string, count: number): string {
  if (count === 1) return interval === 'year' ? 'per year' : 'per month';
  return `every ${count} ${interval}s`;
}

export function newIdempotencyKey(prefix: string): string {
  const rand = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`;
}

export const palette = {
  bg: '#0d1117', panel: '#161b22', border: '#30363d', text: '#e6edf3', muted: '#8b949e',
  accent: '#58a6ff', good: '#3fb950', warn: '#d29922', bad: '#f85149',
};
