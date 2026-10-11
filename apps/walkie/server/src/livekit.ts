import { AccessToken, RoomServiceClient, ServerError, TrackSource, WebhookReceiver } from 'livekit-server-sdk';
import type { Config } from './config.js';

export const roomNameFor = (channelId: string) => `walkie-${channelId}`;
export const channelIdFromRoom = (room: string): string | null => {
  const m = /^walkie-([0-9a-f-]{36})$/i.exec(room);
  return m ? m[1]! : null;
};

export interface RoomParticipant {
  identity: string;
  canPublish: boolean;
  publishedTrackSids: string[];
}

export interface SpeakerMetadata {
  speaker: { userId: string; leaseId: string; since: number; until: number } | null;
}

export type WebhookEventLite = {
  event: string;
  room?: string;
  identity?: string;
  trackSid?: string;
  trackSource?: string;
  /** The participant's publish permission at the time of the event. */
  canPublish?: boolean;
};

/**
 * Everything the backend needs from the media server. The LiveKit
 * implementation is below; tests substitute a fake.
 */
export interface MediaGateway {
  /** Subscribe-only join token. Publishing is never granted by a token. */
  createJoinToken(args: { room: string; identity: string; name: string; ttlS: number }): Promise<string>;
  ensureRoom(room: string, maxParticipants: number): Promise<void>;
  /** Grant or revoke microphone publishing. Returns 'not_found' when the participant is not connected. */
  setCanPublish(room: string, identity: string, canPublish: boolean): Promise<'ok' | 'not_found'>;
  setSpeaker(room: string, meta: SpeakerMetadata): Promise<void>;
  /** Disconnect a participant and invalidate every token issued to them so far. */
  removeParticipant(room: string, identity: string): Promise<void>;
  listParticipants(room: string): Promise<RoomParticipant[] | null>;
  listActiveRooms(): Promise<string[]>;
  receiveWebhook(body: string, authHeader: string | undefined): Promise<WebhookEventLite>;
}

const isNotFound = (err: unknown) => err instanceof ServerError && (err.status === 404 || err.code === 'not_found');

export class LiveKitGateway implements MediaGateway {
  private readonly rooms: RoomServiceClient;
  private readonly webhooks: WebhookReceiver;

  constructor(private readonly cfg: Config['livekit']) {
    this.rooms = new RoomServiceClient(cfg.apiUrl, cfg.apiKey, cfg.apiSecret, { requestTimeout: 5 });
    this.webhooks = new WebhookReceiver(cfg.apiKey, cfg.apiSecret);
  }

  async createJoinToken({ room, identity, name, ttlS }: { room: string; identity: string; name: string; ttlS: number }) {
    const at = new AccessToken(this.cfg.apiKey, this.cfg.apiSecret, { identity, name, ttl: ttlS });
    at.addGrant({
      room,
      roomJoin: true,
      canSubscribe: true,
      canPublish: false,
      canPublishSources: [],
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    return at.toJwt();
  }

  async ensureRoom(room: string, maxParticipants: number) {
    // createRoom is idempotent for an existing room.
    await this.rooms.createRoom({ name: room, emptyTimeout: 120, departureTimeout: 20, maxParticipants });
  }

  async setCanPublish(room: string, identity: string, canPublish: boolean): Promise<'ok' | 'not_found'> {
    try {
      await this.rooms.updateParticipant(room, identity, {
        permission: {
          canSubscribe: true,
          canPublish,
          canPublishSources: canPublish ? [TrackSource.MICROPHONE] : [],
          canPublishData: false,
          canUpdateMetadata: false,
        },
      });
      return 'ok';
    } catch (err) {
      if (isNotFound(err)) return 'not_found';
      throw err;
    }
  }

  async setSpeaker(room: string, meta: SpeakerMetadata) {
    try {
      await this.rooms.updateRoomMetadata(room, JSON.stringify(meta));
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async removeParticipant(room: string, identity: string) {
    try {
      await this.rooms.removeParticipant(room, identity, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)) });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async listParticipants(room: string): Promise<RoomParticipant[] | null> {
    try {
      const ps = await this.rooms.listParticipants(room);
      return ps.map((p) => ({
        identity: p.identity,
        canPublish: Boolean(p.permission?.canPublish),
        publishedTrackSids: p.tracks.map((t) => t.sid),
      }));
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async listActiveRooms() {
    const rooms = await this.rooms.listRooms();
    return rooms.filter((r) => r.numParticipants > 0).map((r) => r.name);
  }

  async receiveWebhook(body: string, authHeader: string | undefined): Promise<WebhookEventLite> {
    const ev = await this.webhooks.receive(body, authHeader);
    return {
      event: ev.event,
      room: ev.room?.name,
      identity: ev.participant?.identity,
      trackSid: ev.track?.sid,
      trackSource: ev.track ? TrackSource[ev.track.source] : undefined,
      canPublish: ev.participant?.permission ? ev.participant.permission.canPublish : undefined,
    };
  }
}
