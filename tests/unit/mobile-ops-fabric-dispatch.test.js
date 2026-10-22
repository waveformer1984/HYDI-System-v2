'use strict';

/**
 * POST /api/mobile-ops/fabric request-action dispatch.
 * The ops-responder files approvals with { capability, args, confirm, objective }
 * where `objective` is descriptive metadata for gateway.submit — it must not be
 * mistaken for an objective-template submit (objective_id).
 */

const { normalizeRequestAction } = require('../../api/mobile-ops/fabric.js');

describe('normalizeRequestAction', () => {
  it('routes a capability submit carrying objective metadata to the capability path', () => {
    const body = {
      capability: 'board.request',
      args: { board_message_id: 'a3', request: 'restart heidi-web' },
      confirm: false,
      objective: 'restart heidi-web',
    };
    expect(normalizeRequestAction(body)).toBe('capability');
  });

  it('still routes bare objective strings to the objective path', () => {
    expect(normalizeRequestAction({ objective: 'ops.host-health-snapshot' })).toBe('objective');
  });

  it('routes objective_id submissions to the objective path even with capability metadata', () => {
    const body = { objective_id: 'ops.host-health-snapshot', capability: 'board.request', confirm: false };
    expect(normalizeRequestAction(body)).toBe('objective');
  });

  it('approve/retry/cancel flags still win', () => {
    expect(normalizeRequestAction({ approve: true, task_id: 'x'.repeat(24), capability: 'board.request' })).toBe('approve');
    expect(normalizeRequestAction({ cancel: true, task_id: 'x'.repeat(24) })).toBe('cancel');
    expect(normalizeRequestAction({ retry: true, task_id: 'x'.repeat(24) })).toBe('retry');
  });

  it('returns null for empty or malformed bodies', () => {
    expect(normalizeRequestAction(null)).toBeNull();
    expect(normalizeRequestAction({})).toBeNull();
    expect(normalizeRequestAction({ unrelated: true })).toBeNull();
  });
});
