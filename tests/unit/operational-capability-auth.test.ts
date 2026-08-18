/**
 * Phase 3 — Capability Authorizer Tests
 *
 * Tests:
 * - health.read is always authorized
 * - process.restart is only authorized for known boot modules
 * - process.restart is denied for unknown targets
 * - denied actions are counted and logged
 * - diagnostic.snapshot is always safe
 */

import { CapabilityAuthorizer } from '../../lib/operational/CapabilityAuthorizer';
import { SystemStateModel } from '../../lib/operational/SystemStateModel';

describe('Phase 3 — CapabilityAuthorizer', () => {
  let model: SystemStateModel;
  let auth: CapabilityAuthorizer;

  beforeEach(() => {
    model = new SystemStateModel();
    auth = new CapabilityAuthorizer(model);
  });

  it('authorizes health.read for anyone', () => {
    const result = auth.authorize('health.read', { requester: 'test' });
    expect(result.authorized).toBe(true);
  });

  it('authorizes diagnostic.snapshot for anyone', () => {
    const result = auth.authorize('diagnostic.snapshot', { requester: 'test' });
    expect(result.authorized).toBe(true);
  });

  it('authorizes process.restart for known boot modules', () => {
    const result = auth.authorize('process.restart', {
      requester: 'test',
      target: 'protoforge-core',
    });
    expect(result.authorized).toBe(true);
  });

  it('denies process.restart for unknown targets', () => {
    const result = auth.authorize('process.restart', {
      requester: 'test',
      target: 'arbitrary-process',
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toContain('not in allowed restart set');
  });

  it('denies process.restart with no target', () => {
    const result = auth.authorize('process.restart', { requester: 'test' });
    expect(result.authorized).toBe(false);
  });

  it('counts denied actions', () => {
    auth.authorize('process.restart', { requester: 'test', target: 'bad' });
    auth.authorize('process.restart', { requester: 'test', target: 'bad' });
    expect(auth.getDeniedCount()).toBe(2);
  });

  it('logs denied actions as operational events', () => {
    auth.authorize('process.restart', { requester: 'test', target: 'bad' });
    const denied = model.getEventsByType('capability_denied');
    expect(denied).toHaveLength(1);
    expect(denied[0].actionResult).toBe('denied');
  });

  it('authorizes runtime.probe (read-only)', () => {
    const result = auth.authorize('runtime.probe', { requester: 'test' });
    expect(result.authorized).toBe(true);
  });

  it('authorizes configuration.validate (read-only)', () => {
    const result = auth.authorize('configuration.validate', { requester: 'test' });
    expect(result.authorized).toBe(true);
  });

  it('getAllCapabilities returns all capability states', () => {
    const caps = auth.getAllCapabilities();
    expect(caps.length).toBe(8);
    expect(caps.map((c) => c.capability)).toContain('health.read');
    expect(caps.map((c) => c.capability)).toContain('process.restart');
  });

  it('isRestartable checks the restartable set', () => {
    expect(auth.isRestartable('protoforge-core')).toBe(true);
    expect(auth.isRestartable('arbitrary')).toBe(false);
  });
});
