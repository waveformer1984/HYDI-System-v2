import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  approveOrchestrationAction,
  executeOrchestrationAction,
  getOrchestrationActionLogs,
  listOrchestrationActions,
  rejectOrchestrationAction,
  requestOrchestrationAction,
} from './api';

describe('orchestration API helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists orchestration actions with status filter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          actions: [],
          count: 0,
          max_execution_risk: 'high',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await listOrchestrationActions('pending_approval');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3100/api/orchestration/actions?status=pending_approval',
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
    );
    expect(res.error).toBeNull();
    expect(res.data?.max_execution_risk).toBe('high');
  });

  it('requests an orchestration action and sends JSON payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ action: { id: 'orch-1', status: 'pending_approval' } }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await requestOrchestrationAction({
      title: 'test action',
      adapter: 'cli_command',
      payload: { command: 'python', args: ['tool.py'] },
      requested_by: 'ursula',
      risk_level: 'medium',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3100/api/orchestration/actions',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'test action',
          adapter: 'cli_command',
          payload: { command: 'python', args: ['tool.py'] },
          requested_by: 'ursula',
          risk_level: 'medium',
        }),
      }),
    );
  });

  it('handles non-2xx responses as errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'forbidden' }), { status: 403, statusText: 'Forbidden' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await executeOrchestrationAction('orch-9');

    expect(res.data).toBeNull();
    expect(res.error).toContain('HTTP 403');
  });

  it('supports approve/reject/log endpoints', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ action: { id: 'orch-1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ action: { id: 'orch-1' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'orch-1', status: 'approved', logs: [], result: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await approveOrchestrationAction('orch-1', 'owner', 'ok');
    await rejectOrchestrationAction('orch-1', 'owner', 'no');
    const logs = await getOrchestrationActionLogs('orch-1');

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:3100/api/orchestration/actions/orch-1/approve',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:3100/api/orchestration/actions/orch-1/reject',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:3100/api/orchestration/actions/orch-1/logs',
      expect.objectContaining({ headers: expect.objectContaining({ 'Content-Type': 'application/json' }) }),
    );
    expect(logs.error).toBeNull();
  });
});
