/**
 * /api/chat authorization gate — mutating intents require
 * x-hydi-service-token; read-only intents stay open.
 *
 * Regression for the audit finding: POST /api/chat accepted governed
 * commands (stop/retry/approve/investigate) from any caller that could
 * reach the port. Now: unauthorized mutating intent → explicit
 * AUTHORIZATION_REQUIRED refusal, no governed state written.
 */
import { createHmac } from 'crypto';

// Heavy deps the handler touches on import — none are exercised on the
// gated paths under test.
jest.mock('../../lib/heidi-agent', () => ({ runHeidiAgentStream: jest.fn() }));
jest.mock('../../lib/claude', () => ({ isClaudeAvailable: () => false }));
jest.mock('../../lib/supabase-timed', () => ({
  createTimedClient: jest.fn(() => { throw new Error('supabase must not be reached by an unauthorized mutating intent'); }),
}));

const TEST_SECRET = 'chat-auth-gate-test-secret';
process.env.HYDI_SERVICE_SECRET = TEST_SECRET;

import handler from '../../pages/api/chat';

function mintToken(): string {
  const ts = Date.now().toString();
  const requestId = 'req-' + Math.random().toString(36).slice(2);
  const service = 'heidi-dashboard';
  const sig = createHmac('sha256', TEST_SECRET).update(`${ts}:${requestId}:${service}`).digest('hex');
  return `${ts}.${requestId}.${service}.${sig}`;
}

function mockRes() {
  const chunks: string[] = [];
  return {
    chunks,
    writeHead: jest.fn(),
    write: (s: string) => { chunks.push(s); return true; },
    end: jest.fn(function (this: any) { this.ended = true; }),
    status: jest.fn(function (this: any, _c: number) { return this; }),
    json: jest.fn(function (this: any, _o: unknown) { return this; }),
    text: () => chunks.join(''),
  } as any;
}

const req = (body: object, token?: string) => ({
  method: 'POST',
  body,
  headers: token ? { 'x-hydi-service-token': token } : {},
}) as any;

describe('/api/chat authorization gate', () => {
  it('unauthorized `stop <agent>` is refused, no goal created', async () => {
    const res = mockRes();
    await handler(req({ message: 'stop team-coo', session_id: 's', user_id: 'j' }), res);
    expect(res.text()).toContain('AUTHORIZATION_REQUIRED');
    expect(res.text()).not.toContain('submitted as governed action');
  });

  it('unauthorized mission creation is refused', async () => {
    const res = mockRes();
    await handler(req({ message: 'investigate opportunities', session_id: 's', user_id: 'j' }), res);
    expect(res.text()).toContain('AUTHORIZATION_REQUIRED');
  });

  it('unauthorized approve is refused', async () => {
    const res = mockRes();
    await handler(req({ message: 'approve first', session_id: 's', user_id: 'j' }), res);
    expect(res.text()).toContain('AUTHORIZATION_REQUIRED');
  });

  it('read-only `inspect <target>` stays open without a token', async () => {
    // inspect hits the (mocked-failing) supabase path — the refusal must
    // NOT fire; we expect it to try the real read path instead.
    const res = mockRes();
    try {
      await handler(req({ message: 'inspect team-coo', session_id: 's', user_id: 'j' }), res);
    } catch { /* supabase mock throws — proof it reached the read path */ }
    expect(res.text()).not.toContain('AUTHORIZATION_REQUIRED');
  });
});
