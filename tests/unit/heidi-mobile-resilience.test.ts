import { messageForChatError, noteBffFailure, shouldShowLifelineCard } from '../../components/heidi-mobile/chatErrors';
import { streamChat } from '../../lib/heidi-mobile/client/api';
import fs from 'fs';
import path from 'path';

describe('messageForChatError', () => {
  it.each([
    [{ kind: 'timeout' as const, message: '' }, "Heidi is busy — no reply in 15s."],
    [{ kind: 'server' as const, message: 'HYDI is busy right now' }, "Heidi is busy — no reply in 15s."],
    [{ kind: 'network' as const, message: '' }, 'Lost connection to Frank.'],
    [{ kind: 'server' as const, message: 'The reply stream ended unexpectedly.' }, 'Lost connection to Frank.'],
    [{ kind: 'unconfigured' as const, message: '' }, "Heidi's model is offline on Frank. Try again in a minute."],
    [{ kind: 'server' as const, message: 'Ollama model not loaded' }, "Heidi's model is offline on Frank. Try again in a minute."],
    [{ kind: 'server' as const, message: 'Custom upstream explanation' }, 'Custom upstream explanation'],
  ])('maps %#', (error, expected) => {
    expect(messageForChatError(error)).toBe(expected);
  });
});

describe('Lifeline card gate', () => {
  it('shows after two consecutive 502-class failures', () => {
    let n = 0;
    n = noteBffFailure(n, { kind: 'server', status: 502 });
    expect(shouldShowLifelineCard(n)).toBe(false);
    n = noteBffFailure(n, { kind: 'network', status: 502 });
    expect(shouldShowLifelineCard(n)).toBe(true);
    n = noteBffFailure(2, { kind: 'server', status: 200 });
    expect(n).toBe(0);
  });
});

describe('streamChat stream without done', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('counts as network failure (never silent success)', async () => {
    const enc = new TextEncoder();
    globalThis.fetch = jest.fn(async () => new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(enc.encode('data: {"type":"delta","text":"Hi"}\n\n'));
          c.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )) as unknown as typeof fetch;
    const r = await streamChat({ message: 'x', sessionId: 'abcdefgh12' }, () => undefined);
    expect(r).toMatchObject({ ok: false, partial: true, error: { kind: 'network' } });
  });
});

describe('retry keeps session_id', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it('sends the same session_id on a second POST body', async () => {
    const calls: string[] = [];
    globalThis.fetch = jest.fn(async (_u: string, init: RequestInit) => {
      calls.push(String(init.body));
      return new Response(JSON.stringify({ error: 'network', message: 'down' }), { status: 502 });
    }) as unknown as typeof fetch;
    const session = 'sess-retry-01';
    await streamChat({ message: 'hello', sessionId: session }, () => undefined);
    await streamChat({ message: 'hello', sessionId: session }, () => undefined);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]).session_id).toBe(session);
    expect(JSON.parse(calls[1]).session_id).toBe(session);
  });
});

describe('heidi-sw.js cache policy', () => {
  it('does not intercept /lifeline/ paths', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../public/heidi-sw.js'), 'utf8');
    expect(src).toMatch(/\/lifeline\//);
  });
});