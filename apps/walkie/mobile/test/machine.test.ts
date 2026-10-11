import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayStatus, initialState, reduce, type Effect, type PttEvent, type PttState } from '../src/ptt/machine';

const ready: PttState = { ...initialState, connection: 'connected', mic: 'granted' };

function run(s: PttState, ...events: PttEvent[]): [PttState, Effect[]] {
  const all: Effect[] = [];
  for (const e of events) {
    const [n, eff] = reduce(s, e);
    s = n;
    all.push(...eff);
  }
  return [s, all];
}
const types = (effs: Effect[]) => effs.map((e) => e.type).filter((t) => t !== 'haptic');

test('joining never starts the microphone', () => {
  const [, effs] = run(initialState, { type: 'CONNECTION', state: 'connecting' }, { type: 'CONNECTION', state: 'connected' }, { type: 'MIC_PERMISSION', state: 'granted' });
  assert.deepEqual(types(effs), []);
});

test('press requests the turn; mic starts only after the grant', () => {
  let [s, effs] = run(ready, { type: 'PRESS', now: 0 });
  assert.deepEqual(types(effs), ['requestTurn']);
  assert.equal(displayStatus(s, 'me'), 'requesting');
  [s, effs] = run(s, { type: 'GRANTED', leaseId: 'L1', until: 30_000 });
  assert.deepEqual(types(effs), ['startMic', 'startRenewing']);
  assert.equal(displayStatus(s, 'me'), 'speaking');
});

test('release stops the mic before telling the server', () => {
  const [s] = run(ready, { type: 'PRESS', now: 0 }, { type: 'GRANTED', leaseId: 'L1', until: 30_000 });
  const [after, effs] = run(s, { type: 'RELEASE' });
  assert.deepEqual(types(effs), ['stopMic', 'stopRenewing', 'releaseTurn']);
  assert.equal(after.talk.kind, 'idle');
});

test('release while the request is in flight: a late grant is handed straight back, mic never starts', () => {
  const [s, effs] = run(ready, { type: 'PRESS', now: 0 }, { type: 'RELEASE' }, { type: 'GRANTED', leaseId: 'L1', until: 30_000 });
  assert.deepEqual(types(effs), ['requestTurn', 'releaseTurn']);
  assert.equal(s.talk.kind, 'idle');
});

test('busy while held, back to listening on release', () => {
  let [s] = run(ready, { type: 'PRESS', now: 0 }, { type: 'DENIED_BUSY', speakerId: 'other' });
  assert.equal(displayStatus(s, 'me'), 'busy');
  assert.equal(s.notice, 'busy');
  [s] = run(s, { type: 'RELEASE' }, { type: 'SPEAKER', speaker: { userId: 'other', until: 1 } });
  assert.equal(displayStatus(s, 'me'), 'receiving');
});

test('rate limit puts the button in cooldown until it expires', () => {
  let [s, effs] = run(ready, { type: 'PRESS', now: 0 }, { type: 'DENIED_RATE_LIMIT', retryAfterMs: 500, now: 0 }, { type: 'RELEASE' }, { type: 'PRESS', now: 100 });
  assert.deepEqual(types(effs), ['requestTurn']);
  assert.equal(s.notice, 'rate_limited');
  [s, effs] = run(s, { type: 'RELEASE' }, { type: 'TICK', now: 600 }, { type: 'PRESS', now: 600 });
  assert.deepEqual(types(effs), ['requestTurn']);
});

test('losing the turn (renew refused / permission revoked) stops the mic', () => {
  const [s] = run(ready, { type: 'PRESS', now: 0 }, { type: 'GRANTED', leaseId: 'L1', until: 30_000 });
  const [after, effs] = run(s, { type: 'TURN_LOST', reason: 'turn_ended' });
  assert.deepEqual(types(effs), ['stopMic', 'stopRenewing', 'releaseTurn']);
  assert.equal(after.notice, 'turn_ended');
});

test('local max-duration timer stops the mic even if the server is silent', () => {
  const [s] = run(ready, { type: 'PRESS', now: 0 }, { type: 'GRANTED', leaseId: 'L1', until: 30_000 });
  const [, early] = run(s, { type: 'TICK', now: 29_999 });
  assert.deepEqual(types(early), []);
  const [after, effs] = run(s, { type: 'TICK', now: 30_000 });
  assert.deepEqual(types(effs), ['stopMic', 'stopRenewing', 'releaseTurn']);
  assert.equal(after.notice, 'max_duration');
});

test('connection loss while speaking stops the mic; reconnecting shows reconnecting', () => {
  const [s] = run(ready, { type: 'PRESS', now: 0 }, { type: 'GRANTED', leaseId: 'L1', until: 30_000 });
  const [after, effs] = run(s, { type: 'CONNECTION', state: 'reconnecting' });
  assert.deepEqual(types(effs), ['stopMic', 'stopRenewing', 'releaseTurn']);
  assert.equal(displayStatus(after, 'me'), 'reconnecting');
  const [back] = run(after, { type: 'CONNECTION', state: 'connected' });
  assert.equal(displayStatus(back, 'me'), 'listening');
});

test('connection loss during a request cancels it', () => {
  const [s, effs] = run(ready, { type: 'PRESS', now: 0 }, { type: 'CONNECTION', state: 'disconnected' }, { type: 'GRANTED', leaseId: 'L9', until: 1 });
  assert.deepEqual(types(effs), ['requestTurn', 'releaseTurn']);
  assert.equal(displayStatus(s, 'me'), 'disconnected');
});

test('pressing while disconnected does nothing but explain', () => {
  const [s, effs] = run({ ...ready, connection: 'disconnected' }, { type: 'PRESS', now: 0 });
  assert.deepEqual(types(effs), []);
  assert.equal(s.notice, 'not_connected');
});

test('first press asks for microphone permission, then requests the turn if still held', () => {
  const base = { ...ready, mic: 'unknown' as const };
  let [s, effs] = run(base, { type: 'PRESS', now: 0 });
  assert.deepEqual(types(effs), ['requestMicPermission']);
  [s, effs] = run(s, { type: 'MIC_PERMISSION', state: 'granted' });
  assert.deepEqual(types(effs), ['requestTurn']);
});

test('microphone denied: usable explanation, no request, no crash', () => {
  let [s, effs] = run({ ...ready, mic: 'unknown' }, { type: 'PRESS', now: 0 }, { type: 'MIC_PERMISSION', state: 'denied' });
  assert.deepEqual(types(effs), ['requestMicPermission']);
  assert.equal(displayStatus(s, 'me'), 'mic_denied');
  assert.equal(s.notice, 'mic_denied');
  [s, effs] = run(s, { type: 'RELEASE' }, { type: 'PRESS', now: 1 });
  assert.deepEqual(types(effs), []);
  assert.equal(s.notice, 'mic_denied');
});

test('permission revoked mid-turn stops the mic', () => {
  const [s] = run(ready, { type: 'PRESS', now: 0 }, { type: 'GRANTED', leaseId: 'L1', until: 30_000 });
  const [, effs] = run(s, { type: 'MIC_PERMISSION', state: 'denied' });
  assert.deepEqual(types(effs), ['stopMic', 'stopRenewing', 'releaseTurn']);
});

test('room metadata never ends or starts a turn by itself', () => {
  const [s] = run(ready, { type: 'PRESS', now: 0 }, { type: 'GRANTED', leaseId: 'L1', until: 30_000 });
  const [after, effs] = run(s, { type: 'SPEAKER', speaker: null }, { type: 'SPEAKER', speaker: { userId: 'other', until: 5 } });
  assert.deepEqual(effs, []);
  assert.equal(after.talk.kind, 'speaking');
});

test('fuzz: the mic is never left on unless the user holds the button with a granted turn', () => {
  const events: Array<(i: number) => PttEvent> = [
    (i) => ({ type: 'PRESS', now: i * 100 }),
    () => ({ type: 'RELEASE' }),
    (i) => ({ type: 'GRANTED', leaseId: `L${i}`, until: i * 100 + 30_000 }),
    () => ({ type: 'DENIED_BUSY', speakerId: 'x' }),
    (i) => ({ type: 'DENIED_RATE_LIMIT', retryAfterMs: 300, now: i * 100 }),
    () => ({ type: 'DENIED_ERROR' }),
    () => ({ type: 'TURN_LOST', reason: 'turn_ended' }),
    () => ({ type: 'CONNECTION', state: 'reconnecting' }),
    () => ({ type: 'CONNECTION', state: 'connected' }),
    () => ({ type: 'MIC_PERMISSION', state: 'denied' }),
    () => ({ type: 'MIC_PERMISSION', state: 'granted' }),
    (i) => ({ type: 'TICK', now: i * 100 }),
  ];
  let seed = 42;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let trial = 0; trial < 300; trial++) {
    let s: PttState = ready;
    let micOn = false;
    for (let i = 0; i < 60; i++) {
      const [n, effs] = reduce(s, events[Math.floor(rnd() * events.length)]!(i));
      for (const e of effs) {
        if (e.type === 'startMic') micOn = true;
        if (e.type === 'stopMic') micOn = false;
      }
      s = n;
      if (micOn) {
        assert.equal(s.talk.kind, 'speaking', `mic on outside a turn (trial ${trial}, step ${i})`);
        assert.equal(s.pressed, true);
        assert.equal(s.connection, 'connected');
        assert.equal(s.mic, 'granted');
      }
      if (s.talk.kind === 'speaking') assert.equal(micOn, true);
    }
  }
});
