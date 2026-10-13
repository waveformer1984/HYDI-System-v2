/**
 * One channel's live session in the browser: LiveKit room (listen), the
 * shared push-to-talk state machine (the app's own `machine.ts`), and the
 * effects it asks for. Mirrors the app's useChannelSession, minus native
 * audio routing and background modes.
 */
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track, type Participant, type RemoteTrack } from 'livekit-client';
import { initialState, reduce, type Connection, type Effect, type PttEvent, type PttState } from '../../../mobile/src/ptt/machine';
import { api, ApiError } from './api';

export interface Presence {
  identity: string;
  name: string;
  speaking: boolean;
}
export type Ended = 'removed' | 'channel_gone' | 'signed_out' | null;

export class ChannelSession {
  state: PttState = initialState;
  presence: Presence[] = [];
  ended: Ended = null;
  /** Browser blocked autoplay: the user must tap once to hear audio. */
  audioBlocked = false;

  private room: Room | null = null;
  private alive = true;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private tick: ReturnType<typeof setInterval>;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private renewLastOk = 0;
  private renewTtl = 5000;
  private sawPublishGrant = false;
  private micChain: Promise<void> = Promise.resolve();
  private audioEls = new Map<string, HTMLMediaElement>();

  constructor(
    readonly channelId: string,
    private readonly onChange: () => void,
  ) {
    this.tick = setInterval(() => this.dispatch({ type: 'TICK', now: Date.now() }), 250);
    void this.connect();
  }

  press() {
    this.dispatch({ type: 'PRESS', now: Date.now() });
  }
  release() {
    this.dispatch({ type: 'RELEASE' });
  }

  /** Call from a user gesture: unlocks audio playback (iOS Safari, Chrome autoplay). */
  async unlockAudio() {
    try {
      await this.room?.startAudio();
    } catch {
      /* stays blocked; the UI keeps offering the button */
    }
    this.audioBlocked = Boolean(this.room && !this.room.canPlaybackAudio);
    this.onChange();
  }

  /** Ask for the microphone up front (from the join tap) so the first press can talk. */
  async primeMicrophone() {
    if (this.state.mic !== 'unknown') return;
    await this.askMic();
  }

  close() {
    this.alive = false;
    if (this.state.talk.kind === 'speaking') this.release();
    clearInterval(this.tick);
    this.stopRenewing();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    void this.room?.disconnect();
    for (const el of this.audioEls.values()) el.remove();
    this.audioEls.clear();
  }

  private dispatch(e: PttEvent) {
    const [next, effects] = reduce(this.state, e);
    const changed = next !== this.state;
    this.state = next;
    for (const fx of effects) this.run(fx);
    if (changed || effects.length) this.onChange();
  }

  private async askMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      for (const t of stream.getTracks()) t.stop();
      this.dispatch({ type: 'MIC_PERMISSION', state: 'granted' });
    } catch {
      this.dispatch({ type: 'MIC_PERMISSION', state: 'denied' });
    }
  }

  private micOp(fn: () => Promise<void>) {
    this.micChain = this.micChain.then(fn, fn).catch(() => undefined);
  }

  private stopRenewing() {
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.renewTimer = null;
  }

  private run(e: Effect) {
    const room = this.room;
    switch (e.type) {
      case 'requestMicPermission':
        void this.askMic();
        return;

      case 'requestTurn':
        void (async () => {
          try {
            const g = await api.requestTalk(this.channelId);
            this.renewTtl = Math.max(1000, g.renewDeadline - g.grantedAt);
            this.sawPublishGrant = Boolean(this.room?.localParticipant.permissions?.canPublish);
            this.dispatch({ type: 'GRANTED', leaseId: g.leaseId, until: Date.now() + g.maxMs });
          } catch (err) {
            if (err instanceof ApiError && err.status === 409 && err.code === 'busy') {
              const sp = err.body.speaker as { userId?: string } | undefined;
              this.dispatch({ type: 'DENIED_BUSY', speakerId: sp?.userId ?? '' });
            } else if (err instanceof ApiError && err.status === 429) {
              this.dispatch({ type: 'DENIED_RATE_LIMIT', retryAfterMs: Number(err.body.retryAfterMs ?? 1000), now: Date.now() });
            } else {
              this.dispatch({ type: 'DENIED_ERROR' });
            }
          }
        })();
        return;

      case 'startMic':
        this.micOp(async () => {
          if (!room || this.state.talk.kind !== 'speaking') return;
          try {
            await room.localParticipant.setMicrophoneEnabled(true, { echoCancellation: true, noiseSuppression: true, autoGainControl: true });
          } catch (err) {
            const name = err instanceof Error ? err.name : '';
            if (name === 'NotAllowedError' || name === 'PermissionDeniedError') this.dispatch({ type: 'MIC_PERMISSION', state: 'denied' });
            else this.dispatch({ type: 'TURN_LOST', reason: 'turn_ended' });
          }
        });
        return;

      case 'stopMic':
        this.micOp(async () => {
          if (!room) return;
          const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
          // Unpublish and stop capture so the browser's mic indicator goes off.
          if (pub?.track) await room.localParticipant.unpublishTrack(pub.track, true);
        });
        return;

      case 'startRenewing': {
        this.stopRenewing();
        this.renewLastOk = Date.now();
        const every = Math.max(250, Math.floor(this.renewTtl / 3));
        this.renewTimer = setInterval(() => {
          // Unreachable for a whole TTL: the server has already ended the turn.
          if (Date.now() - this.renewLastOk > this.renewTtl) {
            this.dispatch({ type: 'TURN_LOST', reason: 'turn_ended' });
            return;
          }
          api.renewTalk(this.channelId, e.leaseId).then(
            () => {
              this.renewLastOk = Date.now();
            },
            (err) => {
              if (err instanceof ApiError && (err.status === 410 || err.status === 404)) this.dispatch({ type: 'TURN_LOST', reason: 'turn_ended' });
            },
          );
        }, every);
        return;
      }

      case 'stopRenewing':
        this.stopRenewing();
        return;

      case 'releaseTurn':
        api.releaseTalk(this.channelId, e.leaseId).catch(() => {
          // One retry; after that the server's renew timeout reclaims the turn.
          setTimeout(() => api.releaseTalk(this.channelId, e.leaseId).catch(() => {}), 1000);
        });
        return;

      case 'haptic':
        try {
          navigator.vibrate?.(e.kind === 'granted' ? 40 : e.kind === 'denied' ? [0, 30, 60, 30] : 20);
        } catch {
          /* not supported */
        }
        return;
    }
  }

  private refreshPresence = () => {
    const room = this.room;
    if (!room) return;
    const ps: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    this.presence = ps.map((p) => ({ identity: p.identity, name: p.name || p.identity, speaking: p.isSpeaking }));
    this.onChange();
  };

  private attach = (track: RemoteTrack) => {
    if (track.kind !== Track.Kind.Audio || !track.sid) return;
    const el = track.attach();
    el.setAttribute('playsinline', '');
    el.style.display = 'none';
    document.body.appendChild(el);
    this.audioEls.set(track.sid, el);
  };

  private detach = (track: RemoteTrack) => {
    if (!track.sid) return;
    for (const el of track.detach()) el.remove();
    this.audioEls.get(track.sid)?.remove();
    this.audioEls.delete(track.sid);
  };

  private finish(reason: Exclude<Ended, null>) {
    this.ended = reason;
    this.dispatch({ type: 'CONNECTION', state: 'disconnected' });
    this.onChange();
  }

  private scheduleReconnect() {
    if (!this.alive || this.ended) return;
    this.attempt += 1;
    const delay = Math.min(15_000, 500 * 2 ** Math.min(this.attempt, 5));
    this.retryTimer = setTimeout(() => void this.connect(), delay);
  }

  private async connect() {
    if (!this.alive) return;
    this.dispatch({ type: 'CONNECTION', state: this.attempt === 0 ? 'connecting' : 'reconnecting' });
    const mapConn = (s: ConnectionState): Connection =>
      s === ConnectionState.Connected ? 'connected' : s === ConnectionState.Connecting ? 'connecting' : s === ConnectionState.Disconnected ? 'disconnected' : 'reconnecting';
    try {
      const c = await api.connection(this.channelId);
      if (!this.alive) return;
      const room = new Room({ adaptiveStream: false, dynacast: false, stopLocalTrackOnUnpublish: true });
      this.room = room;
      room
        .on(RoomEvent.ConnectionStateChanged, (s) => this.dispatch({ type: 'CONNECTION', state: mapConn(s) }))
        .on(RoomEvent.ParticipantConnected, this.refreshPresence)
        .on(RoomEvent.ParticipantDisconnected, this.refreshPresence)
        .on(RoomEvent.ActiveSpeakersChanged, this.refreshPresence)
        .on(RoomEvent.TrackSubscribed, (track) => this.attach(track))
        .on(RoomEvent.TrackUnsubscribed, (track) => this.detach(track))
        .on(RoomEvent.AudioPlaybackStatusChanged, () => {
          this.audioBlocked = !room.canPlaybackAudio;
          this.onChange();
        })
        .on(RoomEvent.RoomMetadataChanged, (md) => {
          try {
            const sp = (JSON.parse(md) as { speaker?: { userId: string; until: number } | null }).speaker ?? null;
            this.dispatch({ type: 'SPEAKER', speaker: sp });
          } catch {
            /* ignore malformed metadata */
          }
        })
        .on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
          if (participant !== room.localParticipant) return;
          const can = Boolean(room.localParticipant.permissions?.canPublish);
          if (can) this.sawPublishGrant = true;
          // Only a revocation after this turn's grant ends the turn.
          else if (this.sawPublishGrant && this.state.talk.kind === 'speaking') {
            this.sawPublishGrant = false;
            this.dispatch({ type: 'TURN_LOST', reason: 'turn_ended' });
          }
        })
        .on(RoomEvent.Disconnected, (reason) => {
          if (this.room !== room) return;
          this.dispatch({ type: 'CONNECTION', state: 'disconnected' });
          if (reason === DisconnectReason.PARTICIPANT_REMOVED) this.finish('removed');
          else if (reason === DisconnectReason.ROOM_DELETED) this.finish('channel_gone');
          else if (reason !== DisconnectReason.CLIENT_INITIATED) this.scheduleReconnect();
        });
      await room.connect(c.url, c.token, { autoSubscribe: true });
      this.attempt = 0;
      if (room.metadata) room.emit(RoomEvent.RoomMetadataChanged, room.metadata);
      this.audioBlocked = !room.canPlaybackAudio;
      this.refreshPresence();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return this.finish('removed');
      if (err instanceof ApiError && err.status === 401) return this.finish('signed_out');
      this.dispatch({ type: 'CONNECTION', state: 'disconnected' });
      this.scheduleReconnect();
    }
  }
}
