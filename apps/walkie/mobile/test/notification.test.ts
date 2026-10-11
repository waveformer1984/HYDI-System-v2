import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reduce, type PttEvent, type PttState } from '../src/ptt/machine';
import { notificationContent, releaseOnBackground } from '../src/ptt/notification';

const ready: PttState = { ...initialState, connection: 'connected', mic: 'granted' };
const run = (s: PttState, ...evs: PttEvent[]) => evs.reduce((acc, e) => reduce(acc, e)[0], s);

test('idle and connected: Listening, Talk offered', () => {
  assert.deepEqual(notificationContent(ready, 'me', null), { status: 'Listening', detail: null, transmitting: false, canTalk: true });
});

test('someone else talking: Receiving with their name, no Talk button', () => {
  const s = run(ready, { type: 'SPEAKER', speaker: { userId: 'bob', until: 9 } });
  assert.deepEqual(notificationContent(s, 'me', 'Bob'), { status: 'Receiving', detail: 'Bob', transmitting: false, canTalk: false });
});

test('transmitting: Stop shown instead of Talk', () => {
  const s = run(ready, { type: 'PRESS', now: 0 }, { type: 'GRANTED', leaseId: 'L', until: 30_000 });
  const c = notificationContent(s, 'me', null);
  assert.equal(c.transmitting, true);
  assert.equal(c.canTalk, false);
  assert.match(c.status, /Transmitting/);
});

test('no Talk button without microphone permission (a dialog cannot be shown from a notification)', () => {
  for (const mic of ['unknown', 'denied'] as const) {
    assert.equal(notificationContent({ ...ready, mic }, 'me', null).canTalk, false, mic);
  }
  assert.equal(notificationContent({ ...ready, mic: 'denied' }, 'me', null).status, 'Listening (microphone off)');
});

test('no Talk button while reconnecting, requesting or cooling down', () => {
  assert.equal(notificationContent({ ...ready, connection: 'reconnecting' }, 'me', null).canTalk, false);
  assert.equal(notificationContent(run(ready, { type: 'PRESS', now: 0 }), 'me', null).canTalk, false);
  const cool = run(ready, { type: 'PRESS', now: 0 }, { type: 'DENIED_RATE_LIMIT', retryAfterMs: 500, now: 0 }, { type: 'RELEASE' });
  assert.equal(notificationContent(cool, 'me', null).canTalk, false);
});

test('backgrounding ends an on-screen press but not a latched notification turn', () => {
  assert.equal(releaseOnBackground({ pressed: false, keepAlive: false, latched: false }), false);
  assert.equal(releaseOnBackground({ pressed: true, keepAlive: false, latched: false }), true);
  assert.equal(releaseOnBackground({ pressed: true, keepAlive: true, latched: false }), true);
  assert.equal(releaseOnBackground({ pressed: true, keepAlive: false, latched: true }), true);
  assert.equal(releaseOnBackground({ pressed: true, keepAlive: true, latched: true }), false);
});

test('a latched turn from the notification still ends at the maximum duration', () => {
  // Notification Talk = PRESS with no RELEASE ever coming.
  const s = run(ready, { type: 'PRESS', now: 0 }, { type: 'GRANTED', leaseId: 'L', until: 30_000 });
  const [after, effs] = reduce(s, { type: 'TICK', now: 30_000 });
  assert.equal(after.talk.kind, 'idle');
  assert.deepEqual(effs.map((e) => e.type).filter((t) => t !== 'haptic'), ['stopMic', 'stopRenewing', 'releaseTurn']);
});
