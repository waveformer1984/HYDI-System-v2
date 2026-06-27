import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as userStatusGet } from '@/app/api/user/status/route';
import { POST as createIntentPost } from '@/app/api/billing/create-intent/route';
import { POST as executePost } from '@/app/api/execute/route';
import { GET as executionStatusGet } from '@/app/api/executions/[id]/route';
import { GET as billingStatusGet } from '@/app/api/billing/[payment_intent_id]/route';

describe('phase1 smoke flow', () => {
  beforeEach(() => {
    vi.stubEnv('HYDI_EXECUTION_KILL_SWITCH', 'false');
    vi.stubEnv('URSULA_API_URL', 'http://localhost:3000');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('runs canonical Ursula bridge contract flow end-to-end', async () => {
    const traceId = 'trace-phase1-smoke';
    const userId = 'phase1-smoke-user';
    await executePost(
      new NextRequest('http://localhost:3000/api/execute', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': userId,
          'x-trace-id': traceId,
        },
        body: JSON.stringify({
          type: 'resonate',
          params: { prompt: 'warmup' },
          idempotencyKey: 'warmup-idempotency',
        }),
      })
    );

    const statusReq = new NextRequest('http://localhost:3000/api/user/status', {
      method: 'GET',
      headers: {
        'x-user-id': userId,
        'x-trace-id': traceId,
      },
    });
    const statusRes = await userStatusGet(statusReq);
    expect(statusRes.status).toBe(200);
    expect(statusRes.headers.get('x-trace-id')).toBe(traceId);
    const statusPayload = await statusRes.json();
    expect(statusPayload?.userId).toBe(userId);
    expect(typeof statusPayload?.creditsRemaining).toBe('number');
    expect(typeof statusPayload?.subscriptionActive).toBe('boolean');

    const intentReq = new NextRequest('http://localhost:3000/api/billing/create-intent', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': userId,
        'x-trace-id': traceId,
      },
      body: JSON.stringify({ amount: 2 }),
    });
    const intentRes = await createIntentPost(intentReq);
    expect(intentRes.status).toBe(200);
    expect(intentRes.headers.get('x-trace-id')).toBe(traceId);
    const intentPayload = await intentRes.json();
    const paymentIntentId = intentPayload?.paymentIntentId;
    expect(typeof paymentIntentId).toBe('string');
    expect(typeof intentPayload?.clientSecret).toBe('string');

    const execReq = new NextRequest('http://localhost:3000/api/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': userId,
        'x-trace-id': traceId,
      },
      body: JSON.stringify({
        type: 'resonate',
        params: { prompt: 'phase1 smoke execution' },
        idempotencyKey: 'phase1-smoke-idempotency',
      }),
    });
    const execRes = await executePost(execReq);
    expect(execRes.status).toBe(200);
    expect(execRes.headers.get('x-trace-id')).toBe(traceId);
    const execPayload = await execRes.json();
    expect(execPayload?.success).toBe(true);
    const executionId = execPayload?.executionId;
    expect(typeof executionId).toBe('string');
    expect(typeof execPayload?.ledgerEntryId).toBe('string');

    const executionStatusReq = new NextRequest(`http://localhost:3000/api/executions/${executionId}`, {
      method: 'GET',
      headers: { 'x-trace-id': traceId, 'x-user-id': userId },
    });
    const executionStatusRes = await executionStatusGet(executionStatusReq, {
      params: Promise.resolve({ id: executionId }),
    });
    expect(executionStatusRes.status).toBe(200);
    expect(executionStatusRes.headers.get('x-trace-id')).toBe(traceId);
    const executionStatusPayload = await executionStatusRes.json();
    expect(executionStatusPayload?.execution?.id).toBe(executionId);
    expect(executionStatusPayload?.execution?.status).toBe('COMPLETED');

    const billingStatusReq = new NextRequest(`http://localhost:3000/api/billing/${paymentIntentId}`, {
      method: 'GET',
      headers: { 'x-trace-id': traceId, 'x-user-id': userId },
    });
    const billingStatusRes = await billingStatusGet(billingStatusReq, {
      params: Promise.resolve({ payment_intent_id: paymentIntentId }),
    });
    expect(billingStatusRes.status).toBe(200);
    expect(billingStatusRes.headers.get('x-trace-id')).toBe(traceId);
    const billingStatusPayload = await billingStatusRes.json();
    expect(billingStatusPayload?.payment?.id).toBe(paymentIntentId);
    expect(billingStatusPayload?.payment?.status).toBe('created');
  });

  it('returns same execution on sequential duplicate idempotency key', async () => {
    const traceId = 'trace-phase1-idempotency';
    const userId = 'phase1-idempotency-user';
    const idempotencyKey = 'phase1-idempotency-key';

    const firstReq = new NextRequest('http://localhost:3000/api/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': userId,
        'x-trace-id': traceId,
      },
      body: JSON.stringify({
        type: 'resonate',
        params: { prompt: 'run once' },
        idempotencyKey,
      }),
    });
    const firstRes = await executePost(firstReq);
    expect(firstRes.status).toBe(200);
    const firstPayload = await firstRes.json();

    const secondReq = new NextRequest('http://localhost:3000/api/execute', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': userId,
        'x-trace-id': traceId,
      },
      body: JSON.stringify({
        type: 'resonate',
        params: { prompt: 'run twice' },
        idempotencyKey,
      }),
    });
    const secondRes = await executePost(secondReq);
    expect(secondRes.status).toBe(200);
    const secondPayload = await secondRes.json();

    expect(firstPayload?.executionId).toBeTruthy();
    expect(secondPayload?.executionId).toBe(firstPayload?.executionId);
    expect(secondPayload?.ledgerEntryId).toBe(firstPayload?.ledgerEntryId);
  });

  it('returns same execution on parallel duplicate idempotency key', async () => {
    const traceId = 'trace-phase1-idempotency-parallel';
    const userId = 'phase1-idempotency-user-parallel';
    const idempotencyKey = 'phase1-idempotency-key-parallel';

    const makeReq = (prompt: string) =>
      new NextRequest('http://localhost:3000/api/execute', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-user-id': userId,
          'x-trace-id': traceId,
        },
        body: JSON.stringify({
          type: 'resonate',
          params: { prompt },
          idempotencyKey,
        }),
      });

    const [resA, resB] = await Promise.all([executePost(makeReq('parallel-a')), executePost(makeReq('parallel-b'))]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const [payloadA, payloadB] = await Promise.all([resA.json(), resB.json()]);
    expect(payloadA?.executionId).toBeTruthy();
    expect(payloadB?.executionId).toBe(payloadA?.executionId);
    expect(payloadB?.ledgerEntryId).toBe(payloadA?.ledgerEntryId);
  });
});
