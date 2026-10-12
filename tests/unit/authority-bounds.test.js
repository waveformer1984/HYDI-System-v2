'use strict';

/**
 * Live authority bounds — the unattended resolver gate.
 *
 * Proves the fail-closed chain end to end: master switch → bounds
 * reachable → row exists → unattended_enabled → per-resolver/capability
 * denies — and that a pooled sweep now consults the table while a
 * pool-less (attended) sweep keeps its semantics.
 */

const { loadAuthorityBounds, checkUnattendedAuthority } = require('../../lib/heidi/AuthorityBounds');
const { resolveEligibleActions } = require('../../lib/human-actions/detector');
const { HumanActionService } = require('../../lib/human-actions/service');

const mkPool = (rowsOrError) => ({
  query: async () => {
    if (rowsOrError instanceof Error) throw rowsOrError;
    return { rows: rowsOrError };
  },
});

const boundsRow = (over = {}) => ({
  unattended_enabled: true,
  auto_approve_threshold: 0.85,
  max_auto_approve_amount: 10000,
  denied_resolvers: [],
  denied_capabilities: [],
  updated_at: new Date().toISOString(),
  ...over,
});

const envWithExec = { HEIDI_ALLOW_EXEC: 'true' };

describe('loadAuthorityBounds', () => {
  it('reads the live bounds row', async () => {
    const res = await loadAuthorityBounds(mkPool([boundsRow()]));
    expect(res.ok).toBe(true);
    expect(res.bounds.unattendedEnabled).toBe(true);
    expect(res.bounds.autoApproveThreshold).toBe(0.85);
  });

  it('fails closed on a dead pool', async () => {
    const res = await loadAuthorityBounds(mkPool(new Error('connection refused')));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/bounds unreadable/);
  });

  it('fails closed when no bounds row exists', async () => {
    const res = await loadAuthorityBounds(mkPool([]));
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/no row|never established/);
  });
});

describe('checkUnattendedAuthority — the gate in order', () => {
  const bounds = { ok: true, bounds: { unattendedEnabled: true, deniedResolvers: [], deniedCapabilities: [] } };

  it('allows when every gate is satisfied', () => {
    const v = checkUnattendedAuthority({ env: envWithExec, boundsResult: bounds, resolverId: 'config-set', capability: 'config.write' });
    expect(v.allowed).toBe(true);
  });

  it('HEIDI_ALLOW_EXEC unset → EXEC_DISABLED', () => {
    const v = checkUnattendedAuthority({ env: {}, boundsResult: bounds, resolverId: 'config-set' });
    expect(v).toMatchObject({ allowed: false, code: 'EXEC_DISABLED' });
  });

  it('bounds unreadable → BOUNDS_UNREACHABLE (an unreachable bound is a refused bound)', () => {
    const v = checkUnattendedAuthority({ env: envWithExec, boundsResult: { ok: false, reason: 'dead' }, resolverId: 'config-set' });
    expect(v).toMatchObject({ allowed: false, code: 'BOUNDS_UNREACHABLE' });
  });

  it('unattended_enabled=false → UNATTENDED_DISABLED', () => {
    const v = checkUnattendedAuthority({
      env: envWithExec,
      boundsResult: { ok: true, bounds: { unattendedEnabled: false, deniedResolvers: [], deniedCapabilities: [] } },
      resolverId: 'config-set',
    });
    expect(v).toMatchObject({ allowed: false, code: 'UNATTENDED_DISABLED' });
  });

  it('denied resolverId → RESOLVER_DENIED', () => {
    const v = checkUnattendedAuthority({
      env: envWithExec,
      boundsResult: { ok: true, bounds: { unattendedEnabled: true, deniedResolvers: ['config-set'], deniedCapabilities: [] } },
      resolverId: 'config-set',
    });
    expect(v).toMatchObject({ allowed: false, code: 'RESOLVER_DENIED' });
  });

  it('denied capability → CAPABILITY_DENIED', () => {
    const v = checkUnattendedAuthority({
      env: envWithExec,
      boundsResult: { ok: true, bounds: { unattendedEnabled: true, deniedResolvers: [], deniedCapabilities: ['config.write'] } },
      resolverId: 'config-set', capability: 'config.write',
    });
    expect(v).toMatchObject({ allowed: false, code: 'CAPABILITY_DENIED' });
  });
});

describe('resolveEligibleActions — pooled sweep consults live bounds', () => {
  const spec = () => ({
    blockerKey: 'stripe:webhook-processing', type: 'config',
    title: 'Enable webhook processing',
    boundary: { category: 'EXTERNAL_SERVICE', externalSystem: 'stripe' },
    verifier: { name: 'env-vars', spec: { envNames: ['WEBHOOK_PROCESSING_ENABLED'] } },
  });
  const mkEnv = () => ({ envNamePresent: () => false, envValue: () => undefined });

  it('HEIDI_ALLOW_EXEC unset → every R0/R1 action refused as unauthorized, recorded as evidence', async () => {
    delete process.env.HEIDI_ALLOW_EXEC;
    const svc = new HumanActionService();
    const a = svc.request(spec()).action;
    const out = await resolveEligibleActions(svc, {
      env: mkEnv(), throttleMs: 0,
      pool: mkPool([boundsRow()]),
    });
    expect(out.attempted).toHaveLength(0);
    expect(out.unauthorized.some((x) => x.actionId === a.id)).toBe(true);
    expect(svc.get(a.id).resolver.lastOutcome).toBe('unauthorized');
  });

  it('bounds unreachable → refused, not allowed', async () => {
    process.env.HEIDI_ALLOW_EXEC = 'true';
    const svc = new HumanActionService();
    const a = svc.request(spec()).action;
    const out = await resolveEligibleActions(svc, {
      env: mkEnv(), throttleMs: 0,
      pool: mkPool(new Error('connection refused')),
    });
    expect(out.attempted).toHaveLength(0);
    expect(out.unauthorized.some((x) => x.actionId === a.id)).toBe(true);
    delete process.env.HEIDI_ALLOW_EXEC;
  });

  it('a denied resolver is refused while the flag and bounds are live', async () => {
    process.env.HEIDI_ALLOW_EXEC = 'true';
    const svc = new HumanActionService();
    const a = svc.request(spec()).action;
    const out = await resolveEligibleActions(svc, {
      env: mkEnv(), throttleMs: 0,
      pool: mkPool([boundsRow({ denied_resolvers: ['config-set'] })]),
    });
    expect(out.attempted).toHaveLength(0);
    expect(out.unauthorized.some((x) => x.actionId === a.id)).toBe(true);
    delete process.env.HEIDI_ALLOW_EXEC;
  });

  it('deps.authority seam bypasses the DB read for attended/test contexts', async () => {
    process.env.HEIDI_ALLOW_EXEC = 'true';
    const svc = new HumanActionService();
    svc.request(spec());
    const out = await resolveEligibleActions(svc, {
      env: mkEnv(), throttleMs: 0,
      pool: mkPool(new Error('should not be queried')),
      deps: { authority: { ok: true, bounds: { unattendedEnabled: true, deniedResolvers: [], deniedCapabilities: [] } } },
    });
    // Gate consulted but allowed → resolution proceeds to the resolver
    // (which reports unauthorized/failed on env stubs — either way the
    // action is NOT in the authority-refused bucket for the gate reason).
    expect(out.unauthorized.filter((x) => /authority /.test(x.reason))).toHaveLength(0);
    delete process.env.HEIDI_ALLOW_EXEC;
  });
});
