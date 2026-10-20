'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const safety = require('../../lib/forge-board/safety');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

function hasPython() {
  const result = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function callBoard(db, payload, extraEnv) {
  return spawnSync(pythonBin(), [path.join(__dirname, '../../lib/forge-board/cli.py')], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: {
      ...process.env,
      HYDI_BOARD_DB: db,
      HYDI_BOARD_HUMAN_TOKEN: 'human-test-token',
      HYDI_BOARD_HUMAN_NAME: 'Jordan',
      HYDI_BOARD_TOKEN_HEIDI: 'heidi-test-token',
      HYDI_BOARD_UPSTREAM: '',
      SUPABASE_URL: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
      ...extraEnv,
    },
  });
}

function parse(result) {
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

describe('forge board safety', () => {
  it('treats a destructive human message as reply-only even when the gate passes', () => {
    const execute = jest.fn();
    const decision = safety.dispatch(
      { id: 'm1', sender: 'Jordan', sender_type: 'human', body: 'rm -rf / && charge the stripe customer' },
      { gateAllows: true, execute },
    );
    expect(decision).toEqual({ effect: 'reply_only', gate: 'pass', executed: false, messageId: 'm1' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not reply for an agent that already mentioned us 3 times in 60s', () => {
    const now = Date.parse('2026-10-20T12:00:30Z');
    const prior = [1, 2, 3].map((n) => ({
      id: `p${n}`,
      ts: `2026-10-20T12:00:0${n}Z`,
      sender: 'CASCADE',
      sender_type: 'agent',
      body: '@Heidi ping',
      mentions: ['Heidi'],
    }));
    const fresh = [{
      id: 'p4',
      ts: '2026-10-20T12:00:20Z',
      sender: 'CASCADE',
      sender_type: 'agent',
      channel: 'ops',
      body: '@Heidi again',
      mentions: ['Heidi'],
    }];
    const replies = safety.planReplies(fresh, prior.concat(fresh), { sender: 'Heidi', now, gate: () => true });
    expect(replies).toEqual([]);
  });

  it('replies on the board to the first mentions and never asks for execution', () => {
    const fresh = [{
      id: 'h1',
      ts: '2026-10-20T12:00:01Z',
      sender: 'Jordan',
      sender_type: 'human',
      channel: 'general',
      body: '@Heidi look at this',
      mentions: ['Heidi'],
    }];
    const replies = safety.planReplies(fresh, fresh, { sender: 'Heidi', now: Date.parse('2026-10-20T12:00:02Z'), gate: () => true });
    expect(replies).toHaveLength(1);
    expect(replies[0].reply_to).toBe('h1');
    expect(replies[0].decision.executed).toBe(false);
    expect(replies[0].body).not.toMatch(/rm |stripe|supabase/i);
  });

  it('keeps the listener and the store off the task bus and payment tools', () => {
    const listener = fs.readFileSync(path.join(__dirname, '../../lib/forge-board/listener.js'), 'utf8');
    const store = fs.readFileSync(path.join(__dirname, '../../lib/forge-board/store.py'), 'utf8');
    const safetySrc = fs.readFileSync(path.join(__dirname, '../../lib/forge-board/safety.js'), 'utf8');
    for (const src of [listener, safetySrc]) {
      expect(src).not.toMatch(/child_process|stripe|agent_bus|HEIDI_ALLOW_EXEC/);
    }
    expect(store).not.toMatch(/subprocess|stripe|agent_bus/);
    expect(listener).toMatch(/Replies are the only effect/);
  });
});

const describeStore = hasPython() ? describe : describe.skip;

describeStore('forge board sqlite store', () => {
  let db;

  beforeEach(() => {
    db = path.join(os.tmpdir(), `forge-board-${process.pid}-${Date.now()}.sqlite`);
  });

  afterEach(() => {
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(db + suffix); } catch { /* already gone */ }
    }
  });

  it('posts as the human token, reads back, and flattens a reply to one level', () => {
    const first = parse(callBoard(db, {
      method: 'POST',
      client_ip: '127.0.0.1',
      authorization: 'Bearer human-test-token',
      body: { sender: 'Jordan', channel: 'general', body: 'hello @Heidi' },
    }));
    expect(first.ok).toBe(true);
    expect(first.message.sender_type).toBe('human');
    expect(first.message.mentions).toEqual(['Heidi']);

    const second = parse(callBoard(db, {
      method: 'POST',
      client_ip: '100.64.1.5',
      authorization: 'Bearer heidi-test-token',
      body: { sender: 'Heidi', channel: 'general', body: 'Noted, Jordan.', reply_to: first.message.id },
    }));
    const third = parse(callBoard(db, {
      method: 'POST',
      client_ip: '192.168.1.20',
      authorization: 'Bearer human-test-token',
      body: { sender: 'Jordan', channel: 'general', body: 'thanks', reply_to: second.message.id },
    }));
    expect(third.message.reply_to).toBe(first.message.id);

    const listed = parse(callBoard(db, {
      method: 'GET',
      client_ip: '10.0.0.8',
      query: { channel: 'general' },
    }));
    expect(listed.messages.map((message) => message.id)).toEqual([
      first.message.id,
      second.message.id,
      third.message.id,
    ]);
    expect(parse(callBoard(db, {
      method: 'GET',
      client_ip: 'fd7a:115c:a1e0::12',
      query: { channel: 'general' },
    })).ok).toBe(true);
  });

  it('rejects unknown tokens, sender mismatches, public clients, long bodies, and the 11th agent post', () => {
    expect(parse(callBoard(db, {
      method: 'POST',
      client_ip: '127.0.0.1',
      authorization: 'Bearer nope',
      body: { sender: 'Jordan', body: 'hi' },
    })).status).toBe(401);

    expect(parse(callBoard(db, {
      method: 'POST',
      client_ip: '127.0.0.1',
      authorization: 'Bearer human-test-token',
      body: { sender: 'Heidi', body: 'hi' },
    })).status).toBe(403);

    expect(parse(callBoard(db, {
      method: 'POST',
      client_ip: '8.8.8.8',
      authorization: 'Bearer human-test-token',
      body: { sender: 'Jordan', body: 'hi' },
    })).status).toBe(404);

    expect(parse(callBoard(db, {
      method: 'POST',
      client_ip: '127.0.0.1',
      authorization: 'Bearer human-test-token',
      body: { sender: 'Jordan', body: 'x'.repeat(4001) },
    })).status).toBe(400);

    let last;
    for (let i = 0; i < 11; i += 1) {
      last = parse(callBoard(db, {
        method: 'POST',
        client_ip: '127.0.0.1',
        authorization: 'Bearer heidi-test-token',
        body: { sender: 'Heidi', channel: 'ops', body: `note ${i}` },
      }));
    }
    expect(last.status).toBe(429);
  });
});
