/**
 * ProtoForge dispatcher gating (R2 contract item 2).
 *
 * executeApprovedActions is dormant (no live callers) but a real security
 * surface: it dispatches trigger_redeploy (a real Vercel redeploy), clear_queue
 * (mass delete) and restart_service. Before the gate it ran on the caller-
 * supplied `risk`/`reversible` fields on the action itself -- asserted, never
 * verified.
 *
 * Under test: every action must carry a verified authorization bound to
 * (action.type, sha256(payload)). Fabricated approvals, risk, reversible flags,
 * and decisions are all refused. A correctly-minted approval dispatches.
 */

process.env.HYDI_APPROVAL_SECRET = process.env.HYDI_APPROVAL_SECRET || 'hydi-test-approval-secret';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';

import { executeApprovedActions, type DispatchAction } from '../../lib/protoforge/dispatcher';
import { mintSignedAuthorization } from '../helpers/signTestAuth';

function action(overrides: Partial<DispatchAction>): DispatchAction {
  return {
    type: 'create_task',
    payload: { task_name: 'x' },
    risk: 'low',
    reversible: true,
    ...overrides,
  };
}

describe('ProtoForge dispatcher — fabricated authority is refused', () => {
  test('no authorization at all is refused even with a friendly risk claim', async () => {
    const [res] = await executeApprovedActions([action({ type: 'create_task' })]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not authorized/i);
  });

  test('a fabricated risk field does not authorize anything', async () => {
    const [res] = await executeApprovedActions([action({ type: 'create_task', risk: 'low' })]);
    expect(res.success).toBe(false);
  });

  test('a fabricated reversible flag does not authorize a high-risk action', async () => {
    const [res] = await executeApprovedActions([action({ type: 'trigger_redeploy', payload: { project: 'hydi' }, risk: 'high', reversible: true })]);
    expect(res.success).toBe(false);
  });

  test('a fabricated approval object (bare strings) is refused', async () => {
    const a = action({ type: 'create_task' });
    a.authorization = { approvedBy: 'mallory', approvalRef: 'fake', grantedAt: new Date().toISOString() } as any;
    const [res] = await executeApprovedActions([a]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not authorized/i);
  });

  test('an approval minted for a different payload is refused — the binding is to the payload', async () => {
    const a = action({ type: 'create_task', payload: { task_name: 'evil' } });
    a.authorization = mintSignedAuthorization({ type: 'create_task', payload: { task_name: 'legit' } });
    const [res] = await executeApprovedActions([a]);
    expect(res.success).toBe(false);
  });
});

describe('ProtoForge dispatcher — high-impact ops are gated', () => {
  test('unauthorized trigger_redeploy is refused', async () => {
    const [res] = await executeApprovedActions([action({ type: 'trigger_redeploy', payload: { project: 'hydi' }, risk: 'high', reversible: true })]);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not authorized/i);
  });

  test('unauthorized clear_queue is refused', async () => {
    const [res] = await executeApprovedActions([action({ type: 'clear_queue', payload: {} })]);
    expect(res.success).toBe(false);
  });

  test('unauthorized restart_service is refused', async () => {
    const [res] = await executeApprovedActions([action({ type: 'restart_service', payload: { service: 'hydi' } })]);
    expect(res.success).toBe(false);
  });
});

describe('ProtoForge dispatcher — a genuinely-authorized action dispatches', () => {
  test('a correctly-signed create_task is dispatched', async () => {
    // create_task inserts into the actions table; stub supabase to prove the
    // dispatch path is reachable once authorization verifies. The point here
    // is that a valid signature moves the action PAST the gate to the handler.
    const a = action({ type: 'create_task', payload: { task_name: 'real' } });
    a.authorization = mintSignedAuthorization({ type: 'create_task', payload: a.payload });
    const [res] = await executeApprovedActions([a]);
    // The gate must not be what fails it. If it fails, it must be downstream
    // (e.g. a stubbed supabase insert error), never 'not authorized'.
    expect(res.error ?? '').not.toMatch(/not authorized/i);
  });
});
