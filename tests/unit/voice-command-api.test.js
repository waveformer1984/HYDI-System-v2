'use strict';

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

const { generateDeviceSecret, deriveSigningKey, signDeviceToken } = require('../../lib/auth/deviceAuth');

let mockDevices = {};
const commandInserts = [];
const actionInserts = [];
const auditInserts = [];

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn((table) => {
      if (table === 'auth_audit_log') return { insert: jest.fn(async (row) => { auditInserts.push(row); return { error: null }; }) };
      if (table === 'devices') {
        return {
          select: () => ({
            eq: (_f, value) => ({ maybeSingle: async () => ({ data: mockDevices[value] || null, error: null }) }),
          }),
        };
      }
      if (table === 'agent_control_commands') {
        return {
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const inserted = { id: 'cmd-1', ...row };
                commandInserts.push(inserted);
                return { data: inserted, error: null };
              },
            }),
          }),
        };
      }
      if (table === 'actions') {
        return {
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const inserted = { id: 'action-1', ...row };
                actionInserts.push(inserted);
                return { data: inserted, error: null };
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  })),
}));

let handler;

beforeAll(() => {
  process.env.HYDI_SERVICE_SECRET = SERVICE_SECRET;
  process.env.SUPABASE_URL = 'http://localhost';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  handler = require('../../api/voice/command.js').default;
});

beforeEach(() => {
  mockDevices = {};
  commandInserts.length = 0;
  actionInserts.length = 0;
  auditInserts.length = 0;
  require('../../lib/rate-limit').__reset();
});

function viewerToken() {
  const secret = generateDeviceSecret();
  const signingKey = deriveSigningKey(secret);
  mockDevices['viewer-phone'] = { device_id: 'viewer-phone', role: 'viewer', status: 'approved', secret_hash: signingKey };
  return signDeviceToken('viewer-phone', signingKey);
}

describe('api/voice/command.js', () => {
  it('rejects unauthenticated requests', async () => {
    const res = makeRes();
    await handler({ method: 'POST', headers: {}, body: { transcript: 'HYDI status report' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects a transcript without the wake word as a bad request, not silently ignored', async () => {
    const res = makeRes();
    await handler({
      method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() }, body: { transcript: 'status report' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('acknowledges a read-only intent without queuing anything', async () => {
    const res = makeRes();
    await handler({
      method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() }, body: { transcript: 'HYDI status report' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].intent).toBe('status_report');
    expect(commandInserts).toHaveLength(0);
  });

  it('queues a restart command as owner', async () => {
    const res = makeRes();
    await handler({
      method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() }, body: { transcript: 'HYDI restart service decision_assist' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(commandInserts).toHaveLength(1);
    expect(commandInserts[0].worker_type).toBe('decision_assist');
    expect(commandInserts[0].command).toBe('restart');
    expect(commandInserts[0].payload.source).toBe('voice');
  });

  it('queues a start command for "HYDI start Rezonette"', async () => {
    const res = makeRes();
    await handler({
      method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() }, body: { transcript: 'HYDI start Rezonette' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(commandInserts[0].worker_type).toBe('Rezonette');
    expect(commandInserts[0].command).toBe('start');
  });

  it('queues an action row for "HYDI prepare report"', async () => {
    const res = makeRes();
    await handler({
      method: 'POST', headers: { 'x-hydi-service-token': makeServiceToken() }, body: { transcript: 'HYDI prepare report' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(actionInserts).toHaveLength(1);
    expect(actionInserts[0].task_name).toBe('prepare_report');
  });

  it('denies a viewer trying to restart a worker via voice — never bypasses authorization', async () => {
    const token = viewerToken();
    const res = makeRes();
    await handler({
      method: 'POST', headers: { 'x-hydi-device-token': token }, body: { transcript: 'HYDI restart service decision_assist' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(commandInserts).toHaveLength(0);
    expect(auditInserts.some((a) => a.event_type === 'permission_denied')).toBe(true);
  });

  it('allows a viewer to ask for a status report (read-only intent)', async () => {
    const token = viewerToken();
    const res = makeRes();
    await handler({
      method: 'POST', headers: { 'x-hydi-device-token': token }, body: { transcript: 'HYDI status report' },
    }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
