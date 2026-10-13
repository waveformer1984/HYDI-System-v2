import type { Config } from '../src/config.js';
import type { MediaGateway, RoomParticipant, SpeakerMetadata, WebhookEventLite } from '../src/livekit.js';

export const DEV_SECRET = 'test-dev-secret-0123456789abcdef0123456789';
export const SESSION_SECRET = 'test-session-secret-0123456789abcdef01234567';

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    livekit: { url: 'ws://livekit.test', apiUrl: 'http://livekit.test', apiKey: 'devkey', apiSecret: 'secret-secret-secret-secret-secret-00' },
    auth: { mode: 'dev', devSecret: DEV_SECRET },
    talk: { maxMs: 30_000, renewTtlMs: 5_000, minRequestIntervalMs: 250, burst: 6, burstWindowMs: 10_000 },
    publicRatePerMin: 1000,
    joinTokenTtlS: 300,
    inviteTtlHours: 24,
    maxChannelMembers: 50,
    sweepIntervalMs: 500,
    reconcileIntervalMs: 10_000,
    ...over,
  };
}

export class FakeClock {
  constructor(public t = 1_700_000_000_000) {}
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

/** In-memory stand-in for LiveKit that records every permission change. */
export class FakeMedia implements MediaGateway {
  rooms = new Map<string, Map<string, RoomParticipant>>();
  metadata = new Map<string, SpeakerMetadata>();
  calls: string[] = [];
  removed: Array<{ room: string; identity: string }> = [];
  failNextGrant = false;
  /** Called while a grant is "in flight", to inject races. */
  onGrant?: () => Promise<void>;

  connect(room: string, identity: string) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Map());
    this.rooms.get(room)!.set(identity, { identity, canPublish: false, publishedTrackSids: [] });
  }
  disconnect(room: string, identity: string) {
    this.rooms.get(room)?.delete(identity);
  }
  canPublish(room: string, identity: string) {
    return this.rooms.get(room)?.get(identity)?.canPublish ?? false;
  }
  publishers(room: string) {
    return [...(this.rooms.get(room)?.values() ?? [])].filter((p) => p.canPublish).map((p) => p.identity);
  }

  async createJoinToken({ room, identity }: { room: string; identity: string }) {
    return `fake-token:${room}:${identity}`;
  }
  async ensureRoom(room: string) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Map());
  }
  async setCanPublish(room: string, identity: string, canPublish: boolean) {
    this.calls.push(`${canPublish ? 'grant' : 'revoke'}:${identity}`);
    if (canPublish && this.onGrant) await this.onGrant();
    if (canPublish && this.failNextGrant) {
      this.failNextGrant = false;
      throw new Error('livekit down');
    }
    const p = this.rooms.get(room)?.get(identity);
    if (!p) return 'not_found' as const;
    p.canPublish = canPublish;
    if (!canPublish) p.publishedTrackSids = [];
    return 'ok' as const;
  }
  async setSpeaker(room: string, meta: SpeakerMetadata) {
    this.metadata.set(room, meta);
  }
  async removeParticipant(room: string, identity: string) {
    this.removed.push({ room, identity });
    this.rooms.get(room)?.delete(identity);
  }
  async listParticipants(room: string) {
    const r = this.rooms.get(room);
    return r ? [...r.values()].map((p) => ({ ...p })) : null;
  }
  async listActiveRooms() {
    return [...this.rooms].filter(([, ps]) => ps.size > 0).map(([n]) => n);
  }
  async receiveWebhook(body: string, auth: string | undefined): Promise<WebhookEventLite> {
    if (auth !== 'valid') throw new Error('bad signature');
    return JSON.parse(body);
  }
}

export const silentLog = { info() {}, warn() {}, error() {} };
