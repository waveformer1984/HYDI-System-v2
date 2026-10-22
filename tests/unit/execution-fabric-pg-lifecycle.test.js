'use strict';

/**
 * Gateway over the Postgres task store must behave identically to the memory
 * store. The store returns fresh row objects on every write, so the gateway
 * must merge them back into its local task before mutating and persisting.
 * Without that sync, responses reported stale state (QUEUED) and persist()
 * dropped writes on version conflicts — e.g. approvals had no expires_at and
 * executions lost their recorded outcomes.
 */

const { ExecutionGateway } = require('../../lib/execution-fabric/gateway');
const { PostgresTaskStore } = require('../../lib/execution-fabric/task-store-postgres');
const { createExecutionFabricPgMock } = require('../helpers/execution-fabric-pg-mock');

function pgGateway() {
  const mock = createExecutionFabricPgMock();
  const store = new PostgresTaskStore({ supabase: mock });
  return { gw: new ExecutionGateway({ store, skipRecovery: true }), mock, store };
}

describe('execution gateway over the postgres store', () => {
  it('reports AWAITING_APPROVAL (not stale QUEUED) for a confirm-required submit', async () => {
    const { gw } = pgGateway();
    const out = await gw.submit({
      capabilityId: 'board.request',
      args: { board_message_id: 'm1', request: 'restart heidi-web' },
      confirm: false,
      role: 'owner',
      objective: 'restart heidi-web',
      idempotencyKey: 'board:m1',
    });
    expect(out.awaiting_approval).toBe(true);
    expect(out.task.state).toBe('AWAITING_APPROVAL');
  });

  it('persists authorization.expires_at on the approval row', async () => {
    const { gw, mock } = pgGateway();
    const out = await gw.submit({
      capabilityId: 'board.request',
      args: { request: 'restart heidi-web' },
      confirm: false,
      role: 'owner',
    });
    const row = mock.rows.get(out.task.id);
    expect(row.state).toBe('AWAITING_APPROVAL');
    expect(row.authorization.expires_at).toBeTruthy();
  });

  it('task survives a gateway restart: state stays AWAITING_APPROVAL', async () => {
    const { gw, mock } = pgGateway();
    const filed = await gw.submit({
      capabilityId: 'board.request',
      args: { request: 'restart heidi-web' },
      confirm: false,
      role: 'owner',
    });
    // Simulate heidi-web restart: brand-new gateway + store over the same rows.
    const gw2 = new ExecutionGateway({
      store: new PostgresTaskStore({ supabase: mock }),
      skipRecovery: true,
    });
    const got = await gw2.getTask(filed.task.id, 'operator');
    expect(got.task.state).toBe('AWAITING_APPROVAL');
  });

  it('approval through postgres records the outcome end to end', async () => {
    const { gw, mock } = pgGateway();
    const filed = await gw.submit({
      capabilityId: 'board.request',
      args: { request: 'restart heidi-web' },
      confirm: false,
      role: 'owner',
    });
    const approved = await gw.approveTask(filed.task.id, 'operator', true);
    expect(approved.task.state).toBe('COMPLETED');
    const row = mock.rows.get(filed.task.id);
    expect(row.state).toBe('COMPLETED');
    expect(row.outcome.executed).toBe(true);
    expect(row.outcome.result.result.approved).toBe(true);
  });
});
