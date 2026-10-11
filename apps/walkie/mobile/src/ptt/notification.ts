import { displayStatus, type PttState } from './machine';

export interface NotificationContent {
  status: string;
  detail: string | null;
  transmitting: boolean;
  /** Show the notification's Talk button. */
  canTalk: boolean;
}

/**
 * What the Android background notification shows for a session state. Pure,
 * so the wording and when Talk is offered are unit-tested.
 */
export function notificationContent(s: PttState, selfId: string, speakerName: string | null): NotificationContent {
  const status = displayStatus(s, selfId);
  const transmitting = s.talk.kind === 'speaking';
  // Talk is offered only when a press could actually succeed from the
  // background: connected, microphone already granted (a permission dialog
  // cannot be shown from a notification), nobody else talking, not cooling down.
  const canTalk =
    !transmitting &&
    s.connection === 'connected' &&
    s.mic === 'granted' &&
    s.talk.kind === 'idle' &&
    !(s.speaker && s.speaker.userId !== selfId);
  const label: Record<typeof status, string> = {
    speaking: 'Transmitting — tap Stop talking',
    requesting: 'Requesting the turn…',
    busy: 'Busy — someone else is talking',
    receiving: 'Receiving',
    listening: 'Listening',
    connecting: 'Connecting…',
    reconnecting: 'Reconnecting…',
    disconnected: 'Disconnected — open Walkie',
    mic_denied: 'Listening (microphone off)',
  };
  return {
    status: label[status],
    detail: status === 'receiving' && speakerName ? speakerName : null,
    transmitting,
    canTalk,
  };
}

/**
 * Whether backgrounding the app must end the current press. An on-screen
 * press always ends (the finger has left the button). Only a turn latched
 * from the notification survives, and only while the foreground service
 * keeps the session alive.
 */
export function releaseOnBackground(p: { pressed: boolean; keepAlive: boolean; latched: boolean }): boolean {
  if (!p.pressed) return false;
  return !(p.keepAlive && p.latched);
}

/**
 * A latched turn (started from Android's notification or iOS's system UI)
 * has no finger to lift. Once its turn is no longer being requested or held
 * (max duration, busy, loss, error), the latch must be released, or the
 * machine would keep thinking a button is held and ignore the next Talk.
 */
export function latchedShouldRelease(s: { pressed: boolean; talk: { kind: string } }): boolean {
  return s.pressed && s.talk.kind !== 'speaking' && s.talk.kind !== 'requesting';
}
