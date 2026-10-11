import { config } from './config';

export type Role = 'owner' | 'member';
export interface ChannelSummary { id: string; name: string; role: Role; ownerId: string }
export interface ChannelDetail extends ChannelSummary {
  members: Array<{ userId: string; displayName: string | null; role: Role }>;
  speaker: { userId: string; until: number } | null;
}
export interface Connection { url: string; token: string; room: string; identity: string; expiresInS: number }
export interface TalkGrant {
  kind: 'granted';
  leaseId: string;
  grantedAt: number;
  renewDeadline: number;
  hardDeadline: number;
  renewEveryMs: number;
  maxMs: number;
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly body: Record<string, unknown> = {}) {
    super(code);
  }
}

export type TokenSource = () => Promise<string | null>;

export function createApi(getToken: TokenSource) {
  async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 8000): Promise<T> {
    const token = await getToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${config.apiUrl}${path}`, {
        method,
        signal: ctrl.signal,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
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

  return {
    devSession: (handle: string) => call<{ token: string; userId: string; expiresAt: number }>('POST', '/v1/dev/session', { handle }),
    me: () => call<{ userId: string; displayName: string | null }>('GET', '/v1/me'),
    setDisplayName: (displayName: string) => call<{ userId: string; displayName: string }>('PUT', '/v1/me', { displayName }),
    deleteAccount: () => call<{ deleted: boolean; authUserDeleted: boolean }>('DELETE', '/v1/me'),
    channels: () => call<{ channels: ChannelSummary[] }>('GET', '/v1/channels'),
    createChannel: (name: string) => call<ChannelSummary>('POST', '/v1/channels', { name }),
    channel: (id: string) => call<ChannelDetail>('GET', `/v1/channels/${id}`),
    deleteChannel: (id: string) => call<{ deleted: boolean }>('DELETE', `/v1/channels/${id}`),
    createInvite: (id: string) => call<{ code: string; expiresAt: number; maxUses: number }>('POST', `/v1/channels/${id}/invites`, {}),
    redeemInvite: (code: string) => call<ChannelSummary>('POST', '/v1/invites/redeem', { code }),
    leave: (id: string) => call<{ left: boolean }>('POST', `/v1/channels/${id}/leave`),
    removeMember: (id: string, userId: string) => call<{ removed: boolean }>('DELETE', `/v1/channels/${id}/members/${userId}`),
    block: (id: string, userId: string) => call<{ blocked: boolean }>('POST', `/v1/channels/${id}/blocks`, { userId }),
    connection: (id: string) => call<Connection>('POST', `/v1/channels/${id}/connection`),
    requestTalk: (id: string) => call<TalkGrant>('POST', `/v1/channels/${id}/talk`, undefined, 5000),
    renewTalk: (id: string, leaseId: string) => call<{ renewDeadline: number }>('POST', `/v1/channels/${id}/talk/${leaseId}/renew`, undefined, 3000),
    releaseTalk: (id: string, leaseId: string) => call<{ released: boolean }>('DELETE', `/v1/channels/${id}/talk/${leaseId}`, undefined, 5000),
  };
}

export type Api = ReturnType<typeof createApi>;
