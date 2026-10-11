/**
 * Push-to-talk client state machine. Pure: (state, event) → (state, effects).
 * The controller performs the effects (network calls, microphone) and feeds
 * results back in as events. Kept free of React Native imports so it runs
 * under plain Node tests.
 *
 * Safety rules encoded here:
 *  - The microphone is enabled only after the server grants a turn, and only
 *    if the button is still held at that moment.
 *  - Releasing stops the microphone first (locally, immediately), then tells
 *    the server.
 *  - Any loss of the turn, connection, or permission stops the microphone.
 */

export type Connection = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
export type MicPermission = 'unknown' | 'granted' | 'denied';

export type Talk =
  | { kind: 'idle' }
  | { kind: 'requesting'; cancelled: boolean }
  | { kind: 'speaking'; leaseId: string; until: number }
  | { kind: 'busy'; speakerId: string }
  | { kind: 'cooldown'; until: number };

export interface PttState {
  connection: Connection;
  mic: MicPermission;
  talk: Talk;
  pressed: boolean;
  /** Who the server says holds the floor (room metadata). */
  speaker: { userId: string; until: number } | null;
  /** Last user-facing problem, cleared by the next press. */
  notice: Notice | null;
}

export type Notice =
  | 'not_connected'
  | 'mic_denied'
  | 'busy'
  | 'rate_limited'
  | 'turn_ended'
  | 'max_duration'
  | 'request_failed'
  | 'connection_lost';

export type PttEvent =
  | { type: 'PRESS'; now: number }
  | { type: 'RELEASE' }
  | { type: 'GRANTED'; leaseId: string; until: number }
  | { type: 'DENIED_BUSY'; speakerId: string }
  | { type: 'DENIED_RATE_LIMIT'; retryAfterMs: number; now: number }
  | { type: 'DENIED_ERROR' }
  | { type: 'TURN_LOST'; reason: 'turn_ended' | 'max_duration' }
  | { type: 'CONNECTION'; state: Connection }
  | { type: 'MIC_PERMISSION'; state: MicPermission }
  | { type: 'SPEAKER'; speaker: { userId: string; until: number } | null }
  | { type: 'TICK'; now: number };

export type Effect =
  | { type: 'requestTurn' }
  | { type: 'requestMicPermission' }
  | { type: 'startMic' }
  | { type: 'stopMic' }
  | { type: 'startRenewing'; leaseId: string }
  | { type: 'stopRenewing' }
  | { type: 'releaseTurn'; leaseId: string }
  | { type: 'haptic'; kind: 'granted' | 'denied' | 'ended' };

export const initialState: PttState = {
  connection: 'idle',
  mic: 'unknown',
  talk: { kind: 'idle' },
  pressed: false,
  speaker: null,
  notice: null,
};

type Out = [PttState, Effect[]];

/** Effects that end a speaking turn, in the order they must run. */
const endTurn = (leaseId: string, tellServer: boolean): Effect[] => [
  { type: 'stopMic' },
  { type: 'stopRenewing' },
  ...(tellServer ? [{ type: 'releaseTurn', leaseId } as const] : []),
];

export function reduce(s: PttState, e: PttEvent): Out {
  switch (e.type) {
    case 'PRESS': {
      if (s.pressed) return [s, []];
      const pressed = { ...s, pressed: true, notice: null };
      if (s.connection !== 'connected') return [{ ...pressed, notice: 'not_connected' }, [{ type: 'haptic', kind: 'denied' }]];
      if (s.mic === 'denied') return [{ ...pressed, notice: 'mic_denied' }, [{ type: 'haptic', kind: 'denied' }]];
      if (s.mic === 'unknown') return [pressed, [{ type: 'requestMicPermission' }]];
      if (s.talk.kind === 'cooldown' && e.now < s.talk.until) return [{ ...pressed, notice: 'rate_limited' }, [{ type: 'haptic', kind: 'denied' }]];
      if (s.talk.kind === 'idle' || s.talk.kind === 'busy' || s.talk.kind === 'cooldown') {
        return [{ ...pressed, talk: { kind: 'requesting', cancelled: false } }, [{ type: 'requestTurn' }]];
      }
      // Pressed again before the previous request answered: keep that request.
      if (s.talk.kind === 'requesting') return [{ ...pressed, talk: { kind: 'requesting', cancelled: false } }, []];
      return [pressed, []];
    }

    case 'RELEASE': {
      const released = { ...s, pressed: false };
      switch (s.talk.kind) {
        case 'speaking':
          return [{ ...released, talk: { kind: 'idle' } }, [...endTurn(s.talk.leaseId, true), { type: 'haptic', kind: 'ended' }]];
        case 'requesting':
          // The grant may still arrive; GRANTED will hand it straight back.
          return [{ ...released, talk: { kind: 'requesting', cancelled: true } }, []];
        case 'busy':
          return [{ ...released, talk: { kind: 'idle' } }, []];
        default:
          return [released, []];
      }
    }

    case 'GRANTED': {
      if (s.talk.kind !== 'requesting') {
        // Unexpected grant (e.g. after a disconnect): give it back.
        return [s, [{ type: 'releaseTurn', leaseId: e.leaseId }]];
      }
      if (s.talk.cancelled || !s.pressed || s.connection !== 'connected' || s.mic !== 'granted') {
        return [{ ...s, talk: { kind: 'idle' } }, [{ type: 'releaseTurn', leaseId: e.leaseId }]];
      }
      return [
        { ...s, talk: { kind: 'speaking', leaseId: e.leaseId, until: e.until } },
        [{ type: 'startMic' }, { type: 'startRenewing', leaseId: e.leaseId }, { type: 'haptic', kind: 'granted' }],
      ];
    }

    case 'DENIED_BUSY':
      if (s.talk.kind !== 'requesting') return [s, []];
      return [
        { ...s, talk: s.pressed && !s.talk.cancelled ? { kind: 'busy', speakerId: e.speakerId } : { kind: 'idle' }, notice: 'busy' },
        [{ type: 'haptic', kind: 'denied' }],
      ];

    case 'DENIED_RATE_LIMIT':
      if (s.talk.kind !== 'requesting') return [s, []];
      return [{ ...s, talk: { kind: 'cooldown', until: e.now + e.retryAfterMs }, notice: 'rate_limited' }, [{ type: 'haptic', kind: 'denied' }]];

    case 'DENIED_ERROR':
      if (s.talk.kind !== 'requesting') return [s, []];
      return [{ ...s, talk: { kind: 'idle' }, notice: 'request_failed' }, [{ type: 'haptic', kind: 'denied' }]];

    case 'TURN_LOST':
      if (s.talk.kind !== 'speaking') return [s, []];
      // The server already ended the turn; still release in case only the
      // client noticed (e.g. local max-duration timer).
      return [{ ...s, talk: { kind: 'idle' }, notice: e.reason }, [...endTurn(s.talk.leaseId, true), { type: 'haptic', kind: 'ended' }]];

    case 'CONNECTION': {
      const next = { ...s, connection: e.state };
      if (e.state === 'connected') return [next, []];
      if (s.talk.kind === 'speaking') {
        return [{ ...next, talk: { kind: 'idle' }, notice: 'connection_lost' }, endTurn(s.talk.leaseId, true)];
      }
      if (s.talk.kind === 'requesting') return [{ ...next, talk: { kind: 'requesting', cancelled: true } }, []];
      if (s.talk.kind === 'busy') return [{ ...next, talk: { kind: 'idle' } }, []];
      return [next, []];
    }

    case 'MIC_PERMISSION': {
      const next = { ...s, mic: e.state };
      if (e.state === 'denied') {
        if (s.talk.kind === 'speaking') return [{ ...next, talk: { kind: 'idle' }, notice: 'mic_denied' }, endTurn(s.talk.leaseId, true)];
        return [{ ...next, notice: s.pressed ? 'mic_denied' : s.notice }, []];
      }
      // Permission was just granted while the user holds the button: go on
      // and ask for the turn.
      if (e.state === 'granted' && s.pressed && s.connection === 'connected' && s.talk.kind === 'idle') {
        return [{ ...next, talk: { kind: 'requesting', cancelled: false } }, [{ type: 'requestTurn' }]];
      }
      return [next, []];
    }

    case 'SPEAKER':
      // Display only. Room metadata and the HTTP grant travel on different
      // connections, so a stale announcement can arrive after our grant;
      // losing the turn is signalled by TURN_LOST (renew refused, or LiveKit
      // revoking our publish permission), never inferred from metadata.
      return [{ ...s, speaker: e.speaker }, []];

    case 'TICK': {
      if (s.talk.kind === 'speaking' && e.now >= s.talk.until) {
        return reduce(s, { type: 'TURN_LOST', reason: 'max_duration' });
      }
      if (s.talk.kind === 'cooldown' && e.now >= s.talk.until) return [{ ...s, talk: { kind: 'idle' } }, []];
      return [s, []];
    }
  }
}

export type DisplayStatus =
  | 'mic_denied'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'speaking'
  | 'requesting'
  | 'busy'
  | 'receiving'
  | 'listening';

/** One status for the UI, most important first. */
export function displayStatus(s: PttState, selfId: string): DisplayStatus {
  if (s.talk.kind === 'speaking') return 'speaking';
  if (s.connection === 'reconnecting') return 'reconnecting';
  if (s.connection === 'connecting' || s.connection === 'idle') return 'connecting';
  if (s.connection === 'disconnected') return 'disconnected';
  if (s.mic === 'denied' && s.pressed) return 'mic_denied';
  if (s.talk.kind === 'requesting') return 'requesting';
  if (s.talk.kind === 'busy') return 'busy';
  if (s.speaker && s.speaker.userId !== selfId) return 'receiving';
  if (s.mic === 'denied') return 'mic_denied';
  return 'listening';
}
