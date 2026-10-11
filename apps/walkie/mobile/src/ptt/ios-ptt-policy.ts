import type { PttState } from './machine';

/**
 * How the app reacts to iOS PushToTalk system events and to its own state
 * (Milestone 3). Pure, so it is unit-tested; useIosPtt performs the actions.
 */
export type PttAction =
  | { type: 'pressLatched' }
  | { type: 'release' }
  | { type: 'stopTransmitting' }
  | { type: 'setActiveRemoteParticipant'; name: string | null };

/** The system UI (lock screen, Dynamic Island) or an accessory started/stopped a transmission. */
export function onSystemTransmit(kind: 'began' | 'ended', source: string, s: PttState): PttAction[] {
  if (kind === 'began') {
    // 'app' = we asked (on-screen press): the machine already has the press.
    if (source === 'app' || s.pressed) return [];
    // Pressed Talk in the system UI: there is no finger on our button, so the
    // turn is latched exactly like Android's notification Talk.
    return [{ type: 'pressLatched' }];
  }
  return s.pressed ? [{ type: 'release' }] : [];
}

const active = (s: PttState) => s.talk.kind === 'speaking' || s.talk.kind === 'requesting' || s.pressed;

/**
 * Reactions to a state change while joined to a PTT channel:
 * - our turn ended (any reason) while the system still shows us
 *   transmitting → tell the system to stop;
 * - the speaker shown in the system UI follows the server's speaker.
 */
export function onStateChange(prev: PttState, next: PttState, selfId: string, nameOf: (id: string) => string): PttAction[] {
  const out: PttAction[] = [];
  if (active(prev) && !active(next)) out.push({ type: 'stopTransmitting' });
  const remote = (s: PttState) => (s.speaker && s.speaker.userId !== selfId ? s.speaker.userId : null);
  const before = remote(prev);
  const after = remote(next);
  if (before !== after) out.push({ type: 'setActiveRemoteParticipant', name: after ? nameOf(after) : null });
  return out;
}

/** Wait for the system to activate the audio session before opening the mic. */
export const AUDIO_ACTIVATION_TIMEOUT_MS = 2500;
