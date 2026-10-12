import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onStateChange, onSystemTransmit } from '../src/ptt/ios-ptt-policy';
import { initialState, reduce, type PttEvent, type PttState } from '../src/ptt/machine';

const ready: PttState = { ...initialState, connection: 'connected', mic: 'granted' };
const run = (s: PttState, ...evs: PttEvent[]) => evs.reduce((acc, e) => reduce(acc, e)[0], s);
const names = (id: string) => ({ bob: 'Bob', carol: 'Carol' })[id] ?? '?';

test('Talk in the iOS system UI starts a latched turn; its end releases', () => {
  assert.deepEqual(onSystemTransmit('began', 'user', ready), [{ type: 'pressLatched' }]);
  assert.deepEqual(onSystemTransmit('began', 'accessory', ready), [{ type: 'pressLatched' }]);
  const pressed = run(ready, { type: 'PRESS', now: 0 });
  assert.deepEqual(onSystemTransmit('ended', 'user', pressed), [{ type: 'release' }]);
  assert.deepEqual(onSystemTransmit('ended', 'user', ready), []);
});

test('a transmission the app itself requested (on-screen press) is not pressed twice', () => {
  assert.deepEqual(onSystemTransmit('began', 'app', ready), []);
  assert.deepEqual(onSystemTransmit('began', 'user', run(ready, { type: 'PRESS', now: 0 })), []);
});

test('when our turn ends for any reason, the system transmission is stopped', () => {
  const speaking = run(ready, { type: 'PRESS', now: 0 }, { type: 'GRANTED', leaseId: 'L', until: 30_000 });
  for (const ev of [
    { type: 'RELEASE' },
    { type: 'TURN_LOST', reason: 'turn_ended' },
    { type: 'TICK', now: 30_000 },
    { type: 'CONNECTION', state: 'reconnecting' },
  ] as PttEvent[]) {
    const after = run(speaking, ev, ...(ev.type === 'RELEASE' ? [] : [{ type: 'RELEASE' } as PttEvent]));
    assert.ok(onStateChange(speaking, after, 'me', names).some((a) => a.type === 'stopTransmitting'), ev.type);
  }
});

test('a denied request (busy) stops the system transmission once released', () => {
  const busy = run(ready, { type: 'PRESS', now: 0 }, { type: 'DENIED_BUSY', speakerId: 'bob' });
  assert.deepEqual(onStateChange(run(ready, { type: 'PRESS', now: 0 }), busy, 'me', names), []);
  const released = run(busy, { type: 'RELEASE' });
  assert.deepEqual(onStateChange(busy, released, 'me', names), [{ type: 'stopTransmitting' }]);
});

test('the system UI shows whoever the server says is speaking, never ourselves', () => {
  const bob = run(ready, { type: 'SPEAKER', speaker: { userId: 'bob', until: 1 } });
  assert.deepEqual(onStateChange(ready, bob, 'me', names), [{ type: 'setActiveRemoteParticipant', name: 'Bob' }]);
  const carol = run(bob, { type: 'SPEAKER', speaker: { userId: 'carol', until: 1 } });
  assert.deepEqual(onStateChange(bob, carol, 'me', names), [{ type: 'setActiveRemoteParticipant', name: 'Carol' }]);
  const none = run(carol, { type: 'SPEAKER', speaker: null });
  assert.deepEqual(onStateChange(carol, none, 'me', names), [{ type: 'setActiveRemoteParticipant', name: null }]);
  const me = run(ready, { type: 'SPEAKER', speaker: { userId: 'me', until: 1 } });
  assert.deepEqual(onStateChange(ready, me, 'me', names), []);
  assert.deepEqual(onStateChange(bob, bob, 'me', names), []);
});
