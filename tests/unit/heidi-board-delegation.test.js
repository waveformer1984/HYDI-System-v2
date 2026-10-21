'use strict';

const {
  normalizeDomains,
  runBoardDelegation,
} = require('../../lib/heidi/board-delegation');

describe('Heidi board delegation', () => {
  it('normalizes only supported domains', () => {
    expect(normalizeDomains(['revenue', 'unknown', 'revenue', 'infrastructure']))
      .toEqual(['revenue', 'infrastructure']);
  });

  it('keeps Heidi in the loop and agents proposal-only', async () => {
    const posts = [];
    const board = {
      post: jest.fn(async (channel, body, replyTo, options) => {
        posts.push({ sender: options.sender, channel, body, replyTo });
        return { ok: true, message: { id: replyTo ? `reply-${posts.length}` : 'delegation-root' } };
      }),
    };
    const collectors = {
      revenue: jest.fn(async () => ({
        evidence: ['USD net 60.00 from processed livemode events'],
        proposals: ['Review delivery obligations.'],
      })),
      infrastructure: jest.fn(async () => ({
        evidence: ['PM2: 4/4 online', 'Disk: 20 GB free'],
        proposals: ['Keep monitoring.'],
      })),
    };

    const out = await runBoardDelegation({
      domains: ['revenue', 'infrastructure'],
      board,
      collectors,
      now: () => new Date('2026-10-21T22:30:00Z'),
    });

    expect(out).toMatchObject({
      ok: true,
      thread_id: 'delegation-root',
      domains: ['revenue', 'infrastructure'],
    });
    expect(posts.map((post) => post.sender)).toEqual([
      'Heidi',
      'ProtoForge',
      'hydi-daemon',
      'Heidi',
    ]);
    expect(posts[0]).toMatchObject({ channel: 'ops', replyTo: undefined });
    expect(posts[0].body).toContain('Heidi remains the coordinator');
    for (const post of posts.slice(1)) expect(post.replyTo).toBe('delegation-root');
    expect(posts[1].body).toContain('@Heidi Revenue delegated report — PROPOSAL ONLY');
    expect(posts[2].body).toContain('@Heidi Infrastructure delegated report — PROPOSAL ONLY');
    expect(posts[3].body).toContain('Hydi remains in the loop through this thread');
    expect(posts[3].body).toContain('Jordan must file any resulting action as a separate REQUEST @Heidi');
    expect(posts.every((post) => !/\b(done|successfully executed|action approved)\b/i.test(post.body))).toBe(true);
  });

  it('does not create a thread for unsupported delegation', async () => {
    const board = { post: jest.fn() };
    await expect(runBoardDelegation({ domains: ['marketing'], board }))
      .resolves.toEqual({ ok: false, error: 'no supported delegation domain' });
    expect(board.post).not.toHaveBeenCalled();
  });

  it('reports collector failure without inventing a result', async () => {
    const posts = [];
    const board = {
      post: async (channel, body, replyTo) => {
        posts.push({ body, replyTo });
        return { ok: true, message: { id: replyTo ? 'reply' : 'root' } };
      },
    };
    await runBoardDelegation({
      domains: ['revenue'],
      board,
      collectors: { revenue: async () => { throw new Error('store down'); } },
    });
    expect(posts[1].body).toContain('Collector failed; no result is claimed.');
    expect(posts[1].body).toContain('No approval or execution occurred.');
  });

  it('keeps concurrent delegation and normal replies under their own senders', async () => {
    const sdk = require('../../lib/forge-board/sdk');
    const old = {
      url: process.env.HYDI_BOARD_URL,
      sender: process.env.HYDI_BOARD_SENDER,
      heidi: process.env.HYDI_BOARD_TOKEN_HEIDI,
      protoforge: process.env.HYDI_BOARD_TOKEN_PROTOFORGE,
      fetch: global.fetch,
    };
    process.env.HYDI_BOARD_URL = 'http://board.test';
    process.env.HYDI_BOARD_SENDER = 'Heidi';
    process.env.HYDI_BOARD_TOKEN_HEIDI = 'heidi-token';
    process.env.HYDI_BOARD_TOKEN_PROTOFORGE = 'proto-token';
    const calls = [];
    let protoStarted;
    const started = new Promise((resolve) => { protoStarted = resolve; });
    let releaseProto;
    const blocked = new Promise((resolve) => { releaseProto = resolve; });
    global.fetch = jest.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ sender: body.sender, auth: init.headers.Authorization, text: body.body });
      if (body.sender === 'ProtoForge') {
        protoStarted();
        await blocked;
      }
      return {
        status: 200,
        text: async () => JSON.stringify({ ok: true, message: { id: body.reply_to ? `reply-${calls.length}` : 'root' } }),
      };
    });

    try {
      const delegation = runBoardDelegation({
        domains: ['revenue'],
        board: sdk,
        collectors: {
          revenue: async () => ({ evidence: ['read'], proposals: ['review'] }),
        },
      });
      await started;
      const normalReply = sdk.post('ops', 'normal Heidi reply', 'other-thread');
      releaseProto();
      await Promise.all([delegation, normalReply]);

      expect(calls.find((call) => call.text === 'normal Heidi reply')).toMatchObject({
        sender: 'Heidi',
        auth: 'Bearer heidi-token',
      });
      expect(calls.find((call) => call.sender === 'ProtoForge')).toMatchObject({
        auth: 'Bearer proto-token',
      });
      expect(process.env.HYDI_BOARD_SENDER).toBe('Heidi');
    } finally {
      global.fetch = old.fetch;
      for (const [key, value] of [
        ['HYDI_BOARD_URL', old.url],
        ['HYDI_BOARD_SENDER', old.sender],
        ['HYDI_BOARD_TOKEN_HEIDI', old.heidi],
        ['HYDI_BOARD_TOKEN_PROTOFORGE', old.protoforge],
      ]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});
