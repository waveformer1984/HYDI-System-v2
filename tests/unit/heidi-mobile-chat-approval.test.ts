import {
  actionCardKey,
  buildTaskDecisionBody,
  createApprovalCardController,
  describeChatActionNote,
  formatTaskDecisionOutcome,
  isChatActionDecidable,
  postTaskDecision,
} from '../../lib/heidi-mobile/client/taskDecision';
import { heidiRequest, streamChat, type ChatEvent } from '../../lib/heidi-mobile/client/api';

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; jest.restoreAllMocks(); });

describe('chat inline approval helpers', () => {
  it('builds UUID approve body', () => {
    expect(buildTaskDecisionBody({ actionId: UUID, missionId: null }, 'approve')).toEqual({
      id: UUID,
      decision: 'approve',
    });
  });

  it('builds mission reject body', () => {
    expect(buildTaskDecisionBody({ actionId: null, missionId: 42 }, 'reject')).toEqual({
      mission_id: 42,
      decision: 'reject',
    });
  });

  it('first tap opens confirm without posting', async () => {
    const fetchMock = jest.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const c = createApprovalCardController(true, { actionId: UUID, missionId: null });
    c.tap('approve');
    expect(c.phase).toBe('confirm');
    expect(fetchMock).not.toHaveBeenCalled();
    c.cancelConfirm();
    expect(c.phase).toBe('idle');
  });

  it('null actionId and missionId → see Tasks note, not decidable', () => {
    const row = { type: 'pay_invoice', status: 'pending_approval', actionId: null, missionId: null, error: null };
    expect(isChatActionDecidable(row)).toBe(false);
    expect(describeChatActionNote(row)).toBe('pay_invoice — needs your approval (see Tasks)');
  });

  it('409 refusal text and settled card does not return to idle', async () => {
    globalThis.fetch = jest.fn(async () => new Response(
      JSON.stringify({ error: 'decision_refused', message: 'Execution gates blocked this.' }),
      { status: 409 },
    )) as unknown as typeof fetch;
    const c = createApprovalCardController(true, { actionId: UUID, missionId: null });
    c.tap('approve');
    const out = await c.confirm();
    expect(c.phase).toBe('settled');
    expect(out.ok).toBe(false);
    expect(out.text).toContain('Execution gates blocked');
    c.tap('approve');
    expect(c.phase).toBe('settled');
  });

  it('postTaskDecision sends x-heidi-request via heidiRequest', async () => {
    const fetchMock = jest.fn(async () => new Response(JSON.stringify({ ok: true, status: 'approved' }), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await postTaskDecision({ actionId: UUID, missionId: null }, 'approve');
    const init = (fetchMock.mock.calls[0] as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['x-heidi-request']).toBe('1');
  });
});

describe('streamChat actions contract', () => {
  function sse(chunks: string[]) {
    const enc = new TextEncoder();
    return new Response(new ReadableStream({
      start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  }

  it('accepts actions events with missionId', async () => {
    globalThis.fetch = jest.fn(async () => sse([
      `data: ${JSON.stringify({
        type: 'actions',
        actions: [{ type: 'restart_module', status: 'pending_approval', actionId: null, missionId: 42, error: null }],
      })}\n\n`,
      'data: {"type":"done"}\n\n',
    ])) as unknown as typeof fetch;
    const events: ChatEvent[] = [];
    const r = await streamChat({ message: 'hi', sessionId: 'abcdefgh12' }, (e) => events.push(e));
    expect(r).toEqual({ ok: true });
    expect(events[0]).toMatchObject({ type: 'actions', actions: [{ missionId: 42 }] });
    expect(actionCardKey({ actionId: null, missionId: 42, type: 'restart_module' })).toBe('m:42');
  });
});

describe('formatTaskDecisionOutcome', () => {
  it('maps approve success', () => {
    const r = formatTaskDecisionOutcome('approve', { ok: true, data: { ok: true, status: 'approved', error: null }, status: 200 }, { viaMission: false });
    expect(r.text).toContain('Approved and executed');
  });
});