'use strict';

const {
  CapabilityRegistry,
  TaskStateMachine,
  PolicyEngine,
  ApprovalManager,
  SecretBroker,
  AuditLog,
  ControlledExecutor,
  HealthAggregator,
  MissionPlanner,
  DryRunExecutor,
  HeidiExecutive,
} = require('../../../src/heidi-executive');

describe('HEIDI Operational Control Plane v1', () => {
  describe('CapabilityRegistry', () => {
    it('registers and retrieves capabilities', () => {
      const reg = new CapabilityRegistry();
      expect(reg.get('health.read').riskLevel).toBe('READ');
      expect(reg.get('deploy.production').requiresApproval).toBe(true);
      expect(reg.list().length).toBeGreaterThan(10);
    });

    it('rejects invalid risk levels', () => {
      const reg = new CapabilityRegistry();
      expect(() => reg.register({ id: 'bad', riskLevel: 'INSANE' })).toThrow();
    });
  });

  describe('TaskStateMachine', () => {
    const sm = new TaskStateMachine();

    it('allows legal transitions', () => {
      const task = { state: 'PROPOSED' };
      sm.transition(task, 'VALIDATING');
      expect(task.state).toBe('VALIDATING');
    });

    it('prevents illegal transitions', () => {
      const task = { state: 'PROPOSED' };
      expect(() => sm.transition(task, 'EXECUTING')).toThrow('Illegal transition');
    });

    it('records transition history', () => {
      const task = { state: 'PROPOSED' };
      sm.transition(task, 'VALIDATING');
      expect(task.history.length).toBe(1);
    });
  });

  describe('PolicyEngine', () => {
    const reg = new CapabilityRegistry();
    const policy = new PolicyEngine(reg);

    it('allows a local READ with permissions', () => {
      const task = { capabilityId: 'health.read', target: 'local' };
      const actor = { permissions: ['health.read'] };
      const result = policy.evaluate(task, actor);
      expect(result.allowed).toBe(true);
    });

    it('blocks an unregistered capability', () => {
      const task = { capabilityId: 'nope' };
      const result = policy.evaluate(task, {});
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('unregistered_capability');
    });

    it('requires approval for production deployment', () => {
      const task = { capabilityId: 'deploy.production' };
      const actor = { permissions: ['deploy.production'] };
      const result = policy.evaluate(task, actor);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('approval_required');
    });
  });

  describe('ApprovalManager', () => {
    const mgr = new ApprovalManager();

    it('records an approval request and can approve', () => {
      const task = { id: 't1', capabilityId: 'deploy.production', riskLevel: 'CRITICAL', action: 'deploy', parameters: {} };
      mgr.request(task, 'heidi');
      expect(mgr.isApproved('t1')).toBe(false);
      mgr.approve('t1', 'owner');
      expect(mgr.isApproved('t1')).toBe(true);
    });

    it('prevents self-approval for CRITICAL actions', () => {
      const task = { id: 't2', capabilityId: 'database.destructive', riskLevel: 'CRITICAL', action: 'drop', parameters: {} };
      mgr.request(task, 'heidi');
      expect(() => mgr.approve('t2', 'heidi')).toThrow('cannot approve its own');
    });
  });

  describe('SecretBroker', () => {
    const broker = new SecretBroker();

    it('rejects raw secrets as references', () => {
      expect(() => broker.resolve('sk_test_1234567890')).toThrow();
      expect(() => broker.resolve('whsec_1234567890')).toThrow();
    });

    it('redacts secret-shaped strings', () => {
      const redacted = broker.redact('Stripe call failed with sk_live_1234567890abcdef');
      expect(redacted).toContain('[REDACTED]');
      expect(redacted).not.toContain('sk_live_1234567890abcdef');
    });

    it('redacts objects with sensitive keys', () => {
      const redacted = broker.redact({ password: 'hunter2', normal: 'ok' });
      expect(redacted.password).toBe('[REDACTED]');
      expect(redacted.normal).toBe('ok');
    });
  });

  describe('AuditLog', () => {
    const log = new AuditLog();

    it('records an entry', () => {
      log.record({ taskId: 't1', capabilityId: 'health.read', actor: 'heidi', resultingState: 'COMPLETED' });
      expect(log.query({ taskId: 't1' }).length).toBe(1);
    });

    it('filters by capability', () => {
      log.record({ taskId: 't2', capabilityId: 'build.run', actor: 'heidi', resultingState: 'COMPLETED' });
      expect(log.query({ capabilityId: 'build.run' }).length).toBe(1);
    });
  });

  describe('ControlledExecutor', () => {
    const reg = new CapabilityRegistry();
    const exec = new ControlledExecutor(reg);

    it('executes health.read', async () => {
      const result = await exec.execute({ capabilityId: 'health.read' });
      expect(result.success).toBe(true);
    });

    it('refuses destructive production operations', async () => {
      const result = await exec.execute({ capabilityId: 'database.destructive' });
      expect(result.success).toBe(false);
    });

    it('blocks forbidden shell commands', async () => {
      await expect(exec.runShell('rm -rf /')).rejects.toThrow('safety check');
    });
  });

  describe('HealthAggregator', () => {
    const ha = new HealthAggregator();
    ha.register('heidi', async () => ({ status: 'HEALTHY' }));
    ha.register('ursula', async () => ({ status: 'HEALTHY' }));

    it('aggregates health', async () => {
      const results = await ha.inspectAll();
      expect(results.heidi.status).toBe('HEALTHY');
    });

    it('marks unregistered as UNKNOWN', () => {
      expect(ha.get('nonexistent').status).toBe('UNKNOWN');
    });
  });

  describe('MissionPlanner', () => {
    const reg = new CapabilityRegistry();
    const planner = new MissionPlanner(reg);

    it('plans make_operational', () => {
      const plan = planner.plan('make_operational');
      expect(plan.tasks.length).toBeGreaterThan(5);
      expect(plan.tasks[0].capabilityId).toBe('health.read');
    });
  });

  describe('DryRunExecutor', () => {
    const reg = new CapabilityRegistry();
    const dry = new DryRunExecutor(reg);

    it('previews deploy.production as requiring approval', () => {
      const preview = dry.preview({ id: 't', capabilityId: 'deploy.production', parameters: {} });
      expect(preview.requiresApproval).toBe(true);
      expect(preview.wouldExecute).toBe(false);
    });
  });

  describe('HeidiExecutive', () => {
    const heidi = new HeidiExecutive();

    it('auto-executes a health.read task', async () => {
      const task = { id: 'h1', capabilityId: 'health.read', parameters: {} };
      const result = await heidi.run(task, { id: 'test' });
      expect(result.status).toBe('COMPLETED');
    });

    it('returns AWAITING_APPROVAL for production deployment', async () => {
      const task = { id: 'd1', capabilityId: 'deploy.production', parameters: {} };
      const result = await heidi.run(task, { id: 'test' });
      expect(result.status).toBe('AWAITING_APPROVAL');
    });

    it('executes an approved task', async () => {
      const task = { id: 'd2', capabilityId: 'deploy.production', parameters: {} };
      await heidi.run(task, { id: 'test' });
      heidi.approve('d2', 'owner');
      await expect(heidi.executeApproved(task, { id: 'test' })).rejects.toThrow('Production deployment');
    });

    it('blocks unregistered capabilities', async () => {
      const task = { id: 'u1', capabilityId: 'nope', parameters: {} };
      await expect(heidi.run(task, { id: 'test' })).rejects.toThrow('unregistered');
    });
  });
});
