/** Session + API client for the browser walkie (same backend the app uses). */

export interface Session {
  token: string;
  expiresAt: number;
  userId: string;
  kind: 'guest' | 'owner';
}
export interface ChannelSummary {
  id: string;
  name: string;
  role: 'owner' | 'member';
  ownerId: string;
}
export interface ChannelDetail extends ChannelSummary {
  members: Array<{ userId: string; displayName: string | null; role: string }>;
}
export interface TalkGrant {
  leaseId: string;
  grantedAt: number;
  renewDeadline: number;
  hardDeadline: number;
  maxMs: number;
}

const SESSION_KEY = 'walkie.session';
const NAME_KEY = 'walkie.name';

// Storage can be unavailable (private mode, blocked site data): fall back to memory.
const memory = new Map<string, string>();
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return memory.get(k) ?? null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      memory.set(k, v);
    }
  },
  remove(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      memory.delete(k);
    }
  },
};

export function loadSession(): Session | null {
  const raw = store.get(SESSION_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    if (typeof s.token !== 'string' || !(s.expiresAt > Date.now() + 60_000)) return null;
    return s;
  } catch {
    return null;
  }
}
export const saveSession = (s: Session) => store.set(SESSION_KEY, JSON.stringify(s));
export const clearSession = () => store.remove(SESSION_KEY);
export const lastName = () => store.get(NAME_KEY) ?? '';
export const saveName = (n: string) => store.set(NAME_KEY, n);

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
  const s = loadSession();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      signal: ctrl.signal,
      headers: {
        ...(s ? { authorization: `Bearer ${s.token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network');
  } finally {
    clearTimeout(timer);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, String(json.error ?? 'error'), json);
  return json as T;
}

export const api = {
  preview: (code: string) =>
    call<{ channelName: string; ownerName: string | null; expiresAt: number; guestJoin: boolean }>('GET', `/v1/invites/${encodeURIComponent(code)}/preview`),
  join: (code: string, displayName: string) =>
    call<{ userId: string; channel: ChannelSummary; session: { token: string; expiresAt: number } | null }>('POST', '/v1/join', { code, displayName }),
  exchange: (ticket: string) =>
    call<{ userId: string; displayName: string; session: { token: string; expiresAt: number } }>('POST', '/v1/session/exchange', { ticket }),
  me: () => call<{ userId: string; displayName: string | null; guest: boolean }>('GET', '/v1/me'),
  channels: () => call<{ channels: ChannelSummary[] }>('GET', '/v1/channels'),
  createChannel: (name: string) => call<ChannelSummary>('POST', '/v1/channels', { name }),
  channel: (id: string) => call<ChannelDetail>('GET', `/v1/channels/${id}`),
  createInvite: (id: string) =>
    call<{ code: string; expiresAt: number; joinUrl: string | null; appUrl: string; qrUrl: string }>('POST', `/v1/channels/${id}/invites`, {}),
  leave: (id: string) => call<{ left: boolean }>('POST', `/v1/channels/${id}/leave`),
  connection: (id: string) => call<{ url: string; token: string; identity: string }>('POST', `/v1/channels/${id}/connection`),
  requestTalk: (id: string) => call<TalkGrant>('POST', `/v1/channels/${id}/talk`, undefined, 5000),
  renewTalk: (id: string, leaseId: string) => call<{ renewDeadline: number }>('POST', `/v1/channels/${id}/talk/${leaseId}/renew`, undefined, 3000),
  releaseTalk: (id: string, leaseId: string) => call<{ released: boolean }>('DELETE', `/v1/channels/${id}/talk/${leaseId}`, undefined, 5000),
};
