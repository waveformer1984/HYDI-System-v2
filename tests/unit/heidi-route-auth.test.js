/**
 * Unit tests for pages/api/heidi.js's auth gate.
 *
 * POST /api/heidi forwards prompts to a model backend and can switch the
 * active model. It was live with no auth and no rate limit (ISSUES_FOUND.md
 * #53); it now requires a credential with 'heidi:chat'.
 */

const { createHmac } = require('crypto');

const SERVICE_SECRET = 'test-service-secret';

function makeServiceToken(secret = SERVICE_SECRET) {
  const ts = Date.now().toString();
  const sig = createHmac('sha256', secret).update(`${ts}:req-1:jest`).digest('hex');
  return `${ts}.req-1.jest.${sig}`;
}

function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn(() => res);
  res.end = jest.fn(() => res);
  return res;
}

const mockHandleMessage = jest.fn();
const mockSwitchModel = jest.fn();

jest.mock('../../api/local-model', () => ({
  HeidiLocalHandler: jest.fn().mockImplementation(() => ({
    initialize: jest.fn(async () => {}),
    handleMessage: (...args) => mockHandleMessage(...args),
    switchModel: (...args) => mockSwitchModel(...args),
    client: { model: 'llama2', provider: 'ollama' },
  })),
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({ insert: jest.fn(async () => ({ error: null })) })),
  })),
}));

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../pages/api/heidi.js').default;
});

beforeEach(() => {
  mockHandleMessage.mockReset();
  mockSwitchModel.mockReset();
  require('../../lib/rate-limit').__reset();
});

describe('pages/api/heidi.js', () => {
  it('rejects an unauthenticated chat message with 401', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { message: 'hi' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated model switch with 401', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { action: 'switch_model', model: 'other' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSwitchModel).not.toHaveBeenCalled();
  });

  it('rejects a forged service token with 401', async () => {
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken('wrong-secret') },
      body: { message: 'hi' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  it('answers a chat message once a valid service token is presented', async () => {
    mockHandleMessage.mockResolvedValue({ text: 'hello', model: 'llama2', provider: 'ollama' });
    const res = makeRes();
    await handler({
      method: 'POST',
      headers: { 'x-hydi-service-token': makeServiceToken() },
      body: { message: 'hi' },
    }, res);
    expect(mockHandleMessage).toHaveBeenCalledWith('hi', undefined);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ response: 'hello' }));
  });

  it('rejects non-POST methods with 405', async () => {
    const res = makeRes();
    await handler({ method: 'GET', headers: {} }, res);
    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe('rbac heidi:chat', () => {
  const { hasPermission } = require('../../lib/auth/rbac');

  it('is granted to owner and operator only', () => {
    expect(hasPermission('owner', 'heidi:chat')).toBe(true);
    expect(hasPermission('operator', 'heidi:chat')).toBe(true);
    expect(hasPermission('viewer', 'heidi:chat')).toBe(false);
    expect(hasPermission('agent', 'heidi:chat')).toBe(false);
  });
});
