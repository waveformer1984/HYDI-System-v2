import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  saveExecutionRecord,
  savePaymentIntentRecord,
  type UrsulaExecutionRecord,
  type UrsulaPaymentIntentRecord,
} from '@/lib/bridge-state-store';
import type { UDPTaskCore } from '@/types/task';

const memoryTasks: UDPTaskCore[] = [];

vi.mock('@/lib/hydi-task-store', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/hydi-task-store')>('@/lib/hydi-task-store');
  return {
    ...actual,
    getHydiTaskById: vi.fn(async (taskId: string) => {
      return memoryTasks.find((task) => task.task_id === taskId) || null;
    }),
    upsertHydiTask: vi.fn(async (task: UDPTaskCore) => {
      const idx = memoryTasks.findIndex((item) => item.task_id === task.task_id);
      if (idx >= 0) {
        memoryTasks[idx] = task;
      } else {
        memoryTasks.push(task);
      }
    }),
  };
});

import { GET as getTaskById } from '@/app/api/hydi/tasks/[id]/route';
import { GET as getExecutionById } from '@/app/api/executions/[id]/route';
import { GET as getBillingById } from '@/app/api/billing/[payment_intent_id]/route';

describe('phase1 authz guards', () => {
  beforeEach(() => {
    memoryTasks.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when task GET has no x-user-id', async () => {
    const taskId = `authz-task-${Date.now()}`;
    const task: UDPTaskCore = {
      task_id: taskId,
      owner_user_id: 'owner-user',
      source: 'manual',
      system: 'general',
      type: 'research',
      title: 'Authz task',
      description: 'task for authz test',
      inputs: {},
      outputs_expected: {},
      dependencies: [],
      priority: 1,
      urgency: 1,
      revenue_impact: { stage: 'blocked', value: 0 },
      status: 'queued',
      retry_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      state_version: 1,
    };
    memoryTasks.push(task);

    const req = new NextRequest(`http://localhost:3000/api/hydi/tasks/${taskId}`, {
      method: 'GET',
      headers: { 'x-trace-id': 'trace-authz-missing-user' },
    });

    const res = await getTaskById(req, { params: Promise.resolve({ id: taskId }) });
    expect(res.status).toBe(401);
    expect(res.headers.get('x-trace-id')).toBe('trace-authz-missing-user');
  });

  it('returns 404 when task owner differs from requester', async () => {
    const taskId = `authz-task-owner-${Date.now()}`;
    const task: UDPTaskCore = {
      task_id: taskId,
      owner_user_id: 'owner-a',
      source: 'manual',
      system: 'general',
      type: 'research',
      title: 'Owned task',
      description: 'task with owner',
      inputs: {},
      outputs_expected: {},
      dependencies: [],
      priority: 1,
      urgency: 1,
      revenue_impact: { stage: 'blocked', value: 0 },
      status: 'queued',
      retry_count: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      state_version: 1,
    };
    memoryTasks.push(task);

    const req = new NextRequest(`http://localhost:3000/api/hydi/tasks/${taskId}`, {
      method: 'GET',
      headers: {
        'x-trace-id': 'trace-authz-task-owner',
        'x-user-id': 'owner-b',
      },
    });

    const res = await getTaskById(req, { params: Promise.resolve({ id: taskId }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for cross-user execution lookup', async () => {
    const executionId = `ursula-exec-authz-${Date.now()}`;
    const execution: UrsulaExecutionRecord = {
      id: executionId,
      user_id: 'exec-owner',
      idempotency_key: `idem-${Date.now()}`,
      type: 'resonate',
      status: 'COMPLETED',
      cost: 2,
      ledger_entry_id: 'ledger-authz',
      result: { ok: true },
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      trace_id: 'trace-exec-owner',
    };
    await saveExecutionRecord(execution);

    const req = new NextRequest(`http://localhost:3000/api/executions/${executionId}`, {
      method: 'GET',
      headers: {
        'x-user-id': 'another-user',
        'x-trace-id': 'trace-authz-execution',
      },
    });

    const res = await getExecutionById(req, { params: Promise.resolve({ id: executionId }) });
    expect(res.status).toBe(404);
  });

  it('returns 404 for cross-user payment lookup', async () => {
    const paymentIntentId = `pi_authz_${Date.now()}`;
    const payment: UrsulaPaymentIntentRecord = {
      id: paymentIntentId,
      user_id: 'payment-owner',
      amount: 2,
      currency: 'usd',
      status: 'created',
      client_secret: 'pi_secret_authz',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      trace_id: 'trace-payment-owner',
    };
    await savePaymentIntentRecord(payment);

    const req = new NextRequest(`http://localhost:3000/api/billing/${paymentIntentId}`, {
      method: 'GET',
      headers: {
        'x-user-id': 'not-owner',
        'x-trace-id': 'trace-authz-payment',
      },
    });

    const res = await getBillingById(req, {
      params: Promise.resolve({ payment_intent_id: paymentIntentId }),
    });
    expect(res.status).toBe(404);
  });
});
