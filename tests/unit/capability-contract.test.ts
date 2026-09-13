/**
 * Capability contract layer — behavioural tests.
 *
 * These assert the properties the layer exists for, not its implementation
 * details. Each block names the failure mode it prevents.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  defineContract,
  defaultState,
  computeAuthority,
  authorizeAgainstDelegation,
  assessBlastRadius,
  matchesPattern,
  validateContract,
  ContractRegistry,
  VerificationRunner,
  CommitGate,
  propose,
  RepairPlaybookRegistry,
  SafetyInterlockController,
  DecisionRecorder,
  checkBudget,
  liftLegacyDescriptor,
  liftAll,
  FDM_PRINT_INTERLOCKS,
  REFERENCE_CONTRACTS,
  RUN_TESTS_CONTRACT,
  PRINT_JOB_CONTRACT,
  CausalCorrelator,
  tierIndex,
} from '../../lib/capability-contract';
import type {
  CapabilityContract,
  EffectSpec,
  SystemStateSnapshot,
} from '../../lib/capability-contract';
import type { StandingDelegation } from '../../lib/capability-contract';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function deleteEffect(patterns: string[]): EffectSpec {
  return {
    verb: 'delete',
    resourceKind: 'file_path',
    resourcePatterns: patterns,
    worstCaseScope: 'single_resource',
    crossesTrustBoundary: false,
  };
}

function fileDeleteContract(patterns: string[]): CapabilityContract {
  return defineContract({
    identity: {
      id: 'files.delete',
      version: '1.0.0',
      owner: 'owner@hydi',
      provider: 'filesystem',
      description: 'Delete a file',
    },
    effects: [deleteEffect(patterns)],
    reversibility: {
      kind: 'snapshot_restore',
      windowMs: 3_600_000,
      caveat: 'Restores content, not mtime.',
    },
    verification: {
      description: 'File no longer exists',
      observation: { source: 'filesystem', target: '{path}', extractFields: ['exists'], settleMs: 0 },
      conditions: [{ field: 'exists', operator: 'eq', expected: false }],
      onFailure: 'escalate',
      maxRetries: 1,
      requiresHumanConfirmation: false,
    },
    contract: {
      signature: {
        params: [
          {
            name: 'path',
            type: 'string',
            required: true,
            description: 'File to delete',
            resourceRef: 'file_path',
          },
        ],
        returns: '{ deleted: boolean }',
      },
      maxTier: 'R4',
    },
  });
}

const FULL_DELEGATION: StandingDelegation = {
  authorityId: 'auth-1',
  delegatedBy: 'user:owner',
  autonomousCeiling: 'R2',
  excludedCapabilities: [],
  expiresAt: null,
};

// ---------------------------------------------------------------------------

describe('blast radius', () => {
  it('matches glob patterns across segments', () => {
    expect(matchesPattern('/tmp/build/x.log', '/tmp/**')).toBe(true);
    expect(matchesPattern('/tmp/x.log', '/tmp/*')).toBe(true);
    expect(matchesPattern('/tmp/build/x.log', '/tmp/*')).toBe(false);
    expect(matchesPattern('/etc/passwd', '/tmp/**')).toBe(false);
  });

  it('treats arguments outside declared patterns as system scope', () => {
    const contract = fileDeleteContract(['/tmp/**']);
    const inBounds = assessBlastRadius(contract, { path: '/tmp/a.log' }, defaultState());
    const escaped = assessBlastRadius(contract, { path: '/etc/passwd' }, defaultState());

    expect(inBounds.escapedTargets).toHaveLength(0);
    expect(escaped.escapedTargets).toHaveLength(1);
    expect(escaped.scope).toBe('system');
  });

  it('treats a mutating effect with no declared patterns as system scope', () => {
    const contract = fileDeleteContract([]);
    const blast = assessBlastRadius(contract, { path: '/tmp/a.log' }, defaultState());
    expect(blast.scope).toBe('system');
    expect(blast.reasons.join(' ')).toContain('no resource patterns');
  });
});

describe('authority is a function, not a constant', () => {
  // The failure mode: a static `riskLevel: 'R2'` on `delete` is a lie the
  // moment the same capability is pointed at a different target.
  it('rates the same verb differently by target', () => {
    const contract = fileDeleteContract(['/tmp/**']);
    const safe = computeAuthority(contract, { path: '/tmp/build.log' }, defaultState());
    const dangerous = computeAuthority(contract, { path: '/etc/passwd' }, defaultState());

    expect(safe.tier).toBe('R2');
    expect(dangerous.tier).not.toBe(safe.tier);
    expect(['R3', 'R4']).toContain(dangerous.tier);
    expect(dangerous.factors.map((f) => f.name)).toContain('target_escaped_bounds');
  });

  it('escalates in production and during an incident', () => {
    const contract = fileDeleteContract(['/tmp/**']);
    const dev = computeAuthority(contract, { path: '/tmp/a' }, defaultState());
    const prod = computeAuthority(
      contract,
      { path: '/tmp/a' },
      defaultState({ environment: 'production', incidentActive: true }),
    );
    expect(prod.tier).not.toBe(dev.tier);
    const names = prod.factors.map((f) => f.name);
    expect(names).toContain('environment');
    expect(names).toContain('incident_active');
  });

  it('records unattended operation without double-counting it as danger', () => {
    // Being unattended does not make an action more dangerous; it makes
    // approval unavailable. The stop is already enforced by requiresApproval
    // + the delegation check. Escalating the tier as well double-counted the
    // same fact and pushed ordinary writes into R4 — caught by advisory
    // telemetry on goal.advance.
    const contract = fileDeleteContract(['/tmp/**']);
    const attended = computeAuthority(
      contract,
      { path: '/etc/passwd' },
      defaultState({ humanPresent: true }),
    );
    const unattended = computeAuthority(
      contract,
      { path: '/etc/passwd' },
      defaultState({ humanPresent: false }),
    );

    expect(unattended.tier).toBe(attended.tier);
    const factor = unattended.factors.find((f) => f.name === 'unattended');
    expect(factor).toBeDefined();
    expect(factor!.escalation).toBe(0);

    // The refusal still happens, via the mechanism that owns it.
    expect(unattended.requiresApproval).toBe(true);
    expect(attended.tier).not.toBe('R5');
  });

  it('explains every escalation', () => {
    const contract = fileDeleteContract(['/tmp/**']);
    const decision = computeAuthority(contract, { path: '/etc/passwd' }, defaultState());
    expect(decision.rationale).toContain('files.delete');
    expect(decision.factors.length).toBeGreaterThan(1);
    for (const factor of decision.factors) {
      expect(factor.escalation).toBeGreaterThanOrEqual(0);
    }
  });

  it('refuses R5 regardless of delegation', () => {
    const contract = defineContract({
      identity: {
        id: 'printer.actuate',
        version: '1.0.0',
        owner: 'owner@hydi',
        provider: 'protoforge',
        description: 'Start a print',
      },
      effects: [
        {
          verb: 'actuate',
          resourceKind: 'physical_machine',
          resourcePatterns: ['printer/*'],
          worstCaseScope: 'irreversible_physical',
          crossesTrustBoundary: false,
        },
      ],
      contract: { interlocks: FDM_PRINT_INTERLOCKS },
    });

    // Interlocks declared but none armed → R5.
    const decision = computeAuthority(contract, {}, defaultState({ armedInterlocks: [] }));
    expect(decision.tier).toBe('R5');

    const outcome = authorizeAgainstDelegation(decision, contract, {
      ...FULL_DELEGATION,
      autonomousCeiling: 'R4',
    });
    expect(outcome.allowed).toBe(false);
    expect(outcome.reason).toContain('R5');
  });
});

describe('validation is the forcing function', () => {
  it('caps a capability with no verification predicate at R1', () => {
    const contract = defineContract({
      identity: {
        id: 'ops.mystery',
        version: '1.0.0',
        owner: 'owner@hydi',
        provider: 'ops',
        description: 'Does something',
      },
      effects: [
        {
          verb: 'update',
          resourceKind: 'service',
          resourcePatterns: ['svc/*'],
          worstCaseScope: 'subsystem',
          crossesTrustBoundary: false,
        },
      ],
    });

    const result = validateContract(contract);
    expect(result.valid).toBe(false);
    expect(result.effectiveMaxTier).toBe('R1');
    expect(result.issues.map((i) => i.code)).toContain('VERIFICATION_ABSENT');
  });

  it('rejects a claimed inverse with no named capability', () => {
    const contract = fileDeleteContract(['/tmp/**']);
    contract.reversibility = { kind: 'inverse_capability', windowMs: 1000, caveat: '' };
    const result = validateContract(contract);
    expect(result.issues.map((i) => i.code)).toContain('REVERSIBILITY_NO_INVERSE');
  });

  it('rejects unredacted secret parameters', () => {
    const contract = fileDeleteContract(['/tmp/**']);
    contract.signature.params.push({
      name: 'api_key',
      type: 'string',
      required: false,
      description: 'key',
    });
    const result = validateContract(contract);
    expect(result.issues.map((i) => i.code)).toContain('OBSERVABILITY_UNREDACTED_SECRET');
  });

  it('caps a physical capability with no independent interlock at R1', () => {
    const contract = defineContract({
      identity: {
        id: 'printer.heat',
        version: '1.0.0',
        owner: 'owner@hydi',
        provider: 'protoforge',
        description: 'Heat the nozzle',
      },
      effects: [
        {
          verb: 'actuate',
          resourceKind: 'physical_machine',
          resourcePatterns: ['printer/k1'],
          worstCaseScope: 'irreversible_physical',
          crossesTrustBoundary: false,
        },
      ],
      contract: {
        interlocks: [
          {
            id: 'host_temp_watch',
            description: 'HYDI polls the temperature and aborts',
            mechanism: 'software_only',
            verification: { source: 'api_response', target: '/t', extractFields: ['t'], settleMs: 0 },
          },
        ],
      },
    });

    const result = validateContract(contract);
    expect(result.effectiveMaxTier).toBe('R1');
    expect(result.issues.map((i) => i.code)).toContain('SAFETY_NO_INDEPENDENT_INTERLOCK');
  });
});

describe('verification fails closed', () => {
  const state = defaultState();

  it('reports unverifiable, not verified, when no observer is registered', async () => {
    const runner = new VerificationRunner();
    const contract = fileDeleteContract(['/tmp/**']);
    const result = await runner.verify(contract, { path: '/tmp/a' }, {
      sessionId: 's',
      actorId: 'heidi',
      authorityId: null,
      state,
    });

    expect(result.outcome).toBe('unverifiable');
    expect(result.verified).toBe(false);
  });

  it('evaluates conditions against a real observation', async () => {
    const runner = new VerificationRunner();
    runner.registerObserver('filesystem', async () => ({ exists: false }));
    const contract = fileDeleteContract(['/tmp/**']);

    const result = await runner.verify(contract, { path: '/tmp/a' }, {
      sessionId: 's',
      actorId: 'heidi',
      authorityId: null,
      state,
    });
    expect(result.outcome).toBe('verified');
  });

  it('reports failure when the world disagrees with the claim', async () => {
    const runner = new VerificationRunner();
    runner.registerObserver('filesystem', async () => ({ exists: true }));
    const contract = fileDeleteContract(['/tmp/**']);

    const result = await runner.verify(contract, { path: '/tmp/a' }, {
      sessionId: 's',
      actorId: 'heidi',
      authorityId: null,
      state,
    });
    expect(result.outcome).toBe('failed');
    expect(result.failedConditions[0]).toContain('exists');
  });

  it('treats an observer that throws as an error, never a pass', async () => {
    const runner = new VerificationRunner();
    runner.registerObserver('filesystem', async () => {
      throw new Error('probe down');
    });
    const contract = fileDeleteContract(['/tmp/**']);
    const result = await runner.verify(contract, { path: '/tmp/a' }, {
      sessionId: 's',
      actorId: 'heidi',
      authorityId: null,
      state,
    });
    expect(result.outcome).toBe('error');
    expect(result.verified).toBe(false);
  });
});

describe('registry execution', () => {
  it('reports an unverifiable success as unverified, not success', async () => {
    const registry = new ContractRegistry();
    const contract = fileDeleteContract(['/tmp/**']);
    registry.register(contract, async () => ({ deleted: true }));
    // No observer registered for `filesystem`.

    const record = await registry.execute(
      'files.delete',
      { path: '/tmp/a' },
      { sessionId: 's', actorId: 'heidi', authorityId: 'auth-1', state: defaultState() },
      FULL_DELEGATION,
    );

    expect(record.outcome).toBe('unverified');
    expect(record.verification?.outcome).toBe('unverifiable');
  });

  it('refuses to execute above the delegated ceiling', async () => {
    const registry = new ContractRegistry();
    registry.register(fileDeleteContract(['/tmp/**']), async () => ({ deleted: true }));
    registry.registerObserver('filesystem', async () => ({ exists: false }));

    const record = await registry.execute(
      'files.delete',
      { path: '/etc/passwd' },
      { sessionId: 's', actorId: 'heidi', authorityId: 'auth-1', state: defaultState() },
      FULL_DELEGATION,
    );

    expect(record.outcome).toBe('refused');
    expect(record.authorityRationale).toContain('ceiling');
  });

  it('redacts declared secrets from the journal record', async () => {
    const registry = new ContractRegistry({ strict: false });
    const contract = fileDeleteContract(['/tmp/**']);
    contract.observability.redactParams = ['token'];
    registry.register(contract, async () => ({ deleted: true }));
    registry.registerObserver('filesystem', async () => ({ exists: false }));

    const record = await registry.execute(
      'files.delete',
      { path: '/tmp/a', token: 'sk_live_secret' },
      { sessionId: 's', actorId: 'heidi', authorityId: 'auth-1', state: defaultState() },
      FULL_DELEGATION,
    );

    expect(record.redactedArgs.token).toBe('[REDACTED]');
    expect(JSON.stringify(record)).not.toContain('sk_live_secret');
  });

  it('surfaces capabilities that can act but cannot be observed', () => {
    const registry = new ContractRegistry();
    registry.register(fileDeleteContract(['/tmp/**']), async () => ({ deleted: true }));
    const audit = registry.audit();
    expect(audit.unobservable.map((u) => u.capabilityId)).toContain('files.delete');
  });
});

describe('commit gate: sub-agents propose, the control plane commits', () => {
  const registry = new ContractRegistry();
  registry.register(fileDeleteContract(['/tmp/**']), async () => ({ deleted: true }));

  const gate = new CommitGate((id) => registry.get(id), {
    trustedProposers: ['engineering-agent', 'research-agent'],
    proposerCeilings: { 'research-agent': 'R1' },
  });

  const ctx = { sessionId: 's', actorId: 'heidi' };

  it('rejects a proposal from an unknown agent', () => {
    const decision = gate.evaluate(
      propose({
        proposedBy: 'rogue-agent',
        capabilityId: 'files.delete',
        args: { path: '/tmp/a' },
        reasoning: 'trust me',
        confidence: 1,
      }),
      defaultState(),
      FULL_DELEGATION,
      ctx,
    );
    expect(decision.verdict).toBe('rejected_untrusted_proposer');
  });

  it('rejects an expired proposal', () => {
    const stale = propose({
      proposedBy: 'engineering-agent',
      capabilityId: 'files.delete',
      args: { path: '/tmp/a' },
      reasoning: 'cleanup',
      confidence: 1,
      ttlMs: -1,
    });
    const decision = gate.evaluate(stale, defaultState(), FULL_DELEGATION, ctx);
    expect(decision.verdict).toBe('rejected_expired');
  });

  it('enforces a per-proposer ceiling independent of the human delegation', () => {
    const decision = gate.evaluate(
      propose({
        proposedBy: 'research-agent',
        capabilityId: 'files.delete',
        args: { path: '/tmp/a' },
        reasoning: 'tidy up',
        confidence: 0.9,
      }),
      defaultState(),
      FULL_DELEGATION,
      ctx,
    );
    expect(decision.verdict).toBe('awaiting_approval');
    expect(decision.reason).toContain('research-agent');
  });

  it('commits a proposal within both ceilings', () => {
    const decision = gate.evaluate(
      propose({
        proposedBy: 'engineering-agent',
        capabilityId: 'files.delete',
        args: { path: '/tmp/build.log' },
        reasoning: 'stale build artifact',
        confidence: 0.9,
      }),
      defaultState(),
      FULL_DELEGATION,
      ctx,
    );
    expect(decision.verdict).toBe('committed');
    expect(decision.approvedContext?.authorityId).toBe('auth-1');
  });

  it('gives a proposal no path to execution of its own', () => {
    const proposal = propose({
      proposedBy: 'engineering-agent',
      capabilityId: 'files.delete',
      args: { path: '/tmp/a' },
      reasoning: 'x',
      confidence: 1,
    });
    // The structural guarantee: nothing callable is reachable from a proposal.
    for (const key of Object.keys(proposal)) {
      expect(typeof (proposal as Record<string, unknown>)[key]).not.toBe('function');
    }
  });
});

describe('self-repair whitelists plans, not primitives', () => {
  function buildRegistry(): ContractRegistry {
    const registry = new ContractRegistry({ strict: false });

    registry.register(
      defineContract({
        identity: {
          id: 'config.edit',
          version: '1.0.0',
          owner: 'owner@hydi',
          provider: 'config',
          description: 'Edit a config file',
        },
        effects: [
          {
            verb: 'update',
            resourceKind: 'file_path',
            resourcePatterns: ['config/**'],
            worstCaseScope: 'single_resource',
            crossesTrustBoundary: false,
          },
        ],
        reversibility: { kind: 'snapshot_restore', windowMs: 600_000, caveat: '' },
        verification: {
          description: 'config parses',
          observation: { source: 'filesystem', target: 'config', extractFields: ['valid'], settleMs: 0 },
          conditions: [{ field: 'valid', operator: 'eq', expected: true }],
          onFailure: 'rollback',
          maxRetries: 1,
          requiresHumanConfirmation: false,
        },
      }),
      async () => ({}),
    );

    registry.register(
      defineContract({
        identity: {
          id: 'service.restart',
          version: '1.0.0',
          owner: 'owner@hydi',
          provider: 'runtime',
          description: 'Restart a service',
        },
        effects: [
          {
            verb: 'restart',
            resourceKind: 'service',
            resourcePatterns: ['heidi-web'],
            worstCaseScope: 'subsystem',
            crossesTrustBoundary: false,
          },
        ],
        reversibility: { kind: 'self_healing', windowMs: 60_000, caveat: '' },
        verification: {
          description: 'health endpoint returns ok',
          observation: { source: 'http_probe', target: '/health', extractFields: ['status'], settleMs: 0 },
          conditions: [{ field: 'status', operator: 'eq', expected: 'ok' }],
          onFailure: 'escalate',
          maxRetries: 2,
          requiresHumanConfirmation: false,
        },
      }),
      async () => ({}),
    );

    return registry;
  }

  it('escalates a sequence above the tier of its steps', () => {
    // The failure mode: two R2 primitives compose into an unreviewed
    // deployment that never leaves R2.
    const registry = buildRegistry();
    const playbooks = new RepairPlaybookRegistry({ lookup: (id) => registry.get(id) });

    const assessment = playbooks.register({
      id: 'repair.config-then-restart',
      version: '1.0.0',
      owner: 'owner@hydi',
      description: 'Fix a bad config value and restart the service',
      trigger: 'service unhealthy after config change',
      steps: [
        { capabilityId: 'config.edit', args: { path: 'config/app.json' }, description: 'revert value', abortOnFailure: true },
        { capabilityId: 'service.restart', args: { service: 'heidi-web' }, description: 'restart', abortOnFailure: true },
      ],
      expectedOutcome: 'health endpoint returns ok for 60s',
      abortConditions: ['health still failing after 2 restarts'],
      maxAttempts: 2,
      attemptWindowMs: 600_000,
    });

    const stepMax = assessment.stepTiers
      .map((s) => ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'].indexOf(s.tier))
      .reduce((a, b) => Math.max(a, b), 0);
    const composed = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'].indexOf(assessment.composedTier);

    expect(composed).toBeGreaterThan(stepMax);
    expect(assessment.escalations.join(' ')).toContain('composition escalation');
  });

  it('prohibits a repair loop with no exit', () => {
    const registry = buildRegistry();
    const playbooks = new RepairPlaybookRegistry({ lookup: (id) => registry.get(id) });
    const assessment = playbooks.assess(
      {
        id: 'repair.forever',
        version: '1.0.0',
        owner: 'owner@hydi',
        description: 'restart until it works',
        trigger: 'anything',
        steps: [{ capabilityId: 'service.restart', args: {}, description: 'restart', abortOnFailure: false }],
        expectedOutcome: 'ok',
        abortConditions: ['never'],
        maxAttempts: 0,
        attemptWindowMs: 1000,
      },
      defaultState(),
    );
    expect(assessment.composedTier).toBe('R5');
    expect(assessment.escalations.join(' ')).toContain('no exit');
  });

  it('rejects an improvised sequence of individually-permitted steps', () => {
    const registry = buildRegistry();
    const playbooks = new RepairPlaybookRegistry({ lookup: (id) => registry.get(id) });
    playbooks.register({
      id: 'repair.restart-only',
      version: '1.0.0',
      owner: 'owner@hydi',
      description: 'restart',
      trigger: 'unhealthy',
      steps: [{ capabilityId: 'service.restart', args: {}, description: 'restart', abortOnFailure: true }],
      expectedOutcome: 'healthy',
      abortConditions: ['two failures'],
      maxAttempts: 2,
      attemptWindowMs: 600_000,
    });

    const improvised = playbooks.isWhitelistedSequence(['config.edit', 'service.restart']);
    expect(improvised.allowed).toBe(false);
    expect(improvised.reason).toContain('do not compose');

    const known = playbooks.isWhitelistedSequence(['service.restart']);
    expect(known.allowed).toBe(true);
    expect(known.matchedPlaybook).toBe('repair.restart-only');
  });

  it('stops a playbook that keeps firing', () => {
    const registry = buildRegistry();
    const playbooks = new RepairPlaybookRegistry({ lookup: (id) => registry.get(id) });
    playbooks.register({
      id: 'repair.flaky',
      version: '1.0.0',
      owner: 'owner@hydi',
      description: 'restart',
      trigger: 'unhealthy',
      steps: [{ capabilityId: 'service.restart', args: {}, description: 'restart', abortOnFailure: true }],
      expectedOutcome: 'healthy',
      abortConditions: ['two failures'],
      maxAttempts: 2,
      attemptWindowMs: 600_000,
    });

    const now = Date.now();
    playbooks.recordAttempt('repair.flaky', now);
    playbooks.recordAttempt('repair.flaky', now);
    const verdict = playbooks.canAttempt('repair.flaky', now);
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toContain('symptom');
  });
});

describe('physical interlocks', () => {
  it('refuses actuation when the only interlock is software', () => {
    const controller = new SafetyInterlockController();
    const status = controller.evaluate([
      {
        id: 'host_watch',
        description: 'host polls temperature',
        mechanism: 'software_only',
        verification: { source: 'api_response', target: '/t', extractFields: ['t'], settleMs: 0 },
      },
    ]);
    expect(status.safeToActuate).toBe(false);
    expect(status.reason).toContain('independently');
  });

  it('refuses actuation on a stale reading', async () => {
    const controller = new SafetyInterlockController({ freshnessMs: 1000 });
    const requirement = FDM_PRINT_INTERLOCKS[1];
    controller.registerProbe(requirement.id, async () => ({
      interlockId: requirement.id,
      armed: true,
      at: new Date(Date.now() - 10_000).toISOString(),
      evidence: 'continuity ok',
    }));
    await controller.poll([requirement]);

    const status = controller.evaluate([requirement]);
    expect(status.safeToActuate).toBe(false);
    expect(status.stale).toContain(requirement.id);
  });

  it('treats a failing probe as not armed', async () => {
    const controller = new SafetyInterlockController();
    const requirement = FDM_PRINT_INTERLOCKS[2];
    controller.registerProbe(requirement.id, async () => {
      throw new Error('sensor offline');
    });
    await controller.poll([requirement]);
    const status = controller.evaluate([requirement]);
    expect(status.safeToActuate).toBe(false);
    expect(status.unarmed).toContain(requirement.id);
  });

  it('permits actuation only when every independent interlock is armed and fresh', async () => {
    const controller = new SafetyInterlockController({ freshnessMs: 60_000 });
    const independent = FDM_PRINT_INTERLOCKS.filter((i) => i.mechanism !== 'software_only');
    for (const requirement of independent) {
      controller.registerProbe(requirement.id, async () => ({
        interlockId: requirement.id,
        armed: true,
        at: new Date().toISOString(),
        evidence: 'ok',
      }));
    }
    await controller.poll(independent);
    const status = controller.evaluate(independent);
    expect(status.safeToActuate).toBe(true);
    expect(controller.armedIds()).toHaveLength(independent.length);
  });
});

describe('decision records are written at decision time', () => {
  it('refuses a record with fewer than two alternatives', () => {
    const recorder = new DecisionRecorder({ persist: false });
    expect(() =>
      recorder.record({
        kind: 'tradeoff',
        subject: 'x',
        question: 'q',
        alternatives: [{ label: 'a', summary: '', rejectedBecause: '', evidence: [] }],
        selected: 'a',
        rationale: 'because',
        revisitIf: '',
        decidedBy: 'owner',
        confidence: 0.8,
        links: [],
        metadata: {},
      }),
    ).toThrow(/not a decision/);
  });

  it('refuses a record with no rationale', () => {
    const recorder = new DecisionRecorder({ persist: false });
    expect(() =>
      recorder.record({
        kind: 'tradeoff',
        subject: 'x',
        question: 'q',
        alternatives: [
          { label: 'a', summary: '', rejectedBecause: '', evidence: [] },
          { label: 'b', summary: '', rejectedBecause: 'slow', evidence: [] },
        ],
        selected: 'a',
        rationale: '   ',
        revisitIf: '',
        decidedBy: 'owner',
        confidence: 0.8,
        links: [],
        metadata: {},
      }),
    ).toThrow(/rationale/);
  });

  it('answers "why did we abandon that approach?" months later', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-dr-'));
    const recorder = new DecisionRecorder({ directory: dir });

    recorder.record({
      kind: 'abandonment',
      subject: 'protoforge.bracket-mount',
      question: 'Which bracket revision goes to production?',
      alternatives: [
        {
          label: 'v3',
          summary: 'Thinner web, faster print',
          rejectedBecause: '17% failure rate under thermal load test',
          evidence: ['thermal-load-2026-03: 17/100 failures'],
        },
        {
          label: 'v4',
          summary: 'Reinforced web',
          rejectedBecause: '31% longer manufacturing time',
          evidence: ['print-time: 6h12m vs 4h44m'],
        },
        {
          label: 'v5',
          summary: 'Compromise geometry',
          rejectedBecause: '',
          evidence: ['thermal-load-2026-04: 2/100 failures', 'print-time: 5h05m'],
        },
      ],
      selected: 'v5',
      rationale:
        'v3 failed thermal load at 17%. v4 fixed it but cost 31% more manufacturing time. ' +
        'v5 trades a small geometry compromise for both.',
      revisitIf: 'a higher-temperature filament removes the thermal constraint',
      decidedBy: 'owner',
      confidence: 0.8,
      links: ['protoforge.thermal-load-test'],
      metadata: {},
    });

    // A fresh recorder over the same log — i.e. a later session.
    const later = new DecisionRecorder({ directory: dir });
    const recalled = later.recall('protoforge.bracket-mount');
    expect(recalled).toHaveLength(1);
    expect(recalled[0].alternatives.find((a) => a.label === 'v3')?.rejectedBecause).toContain('17%');

    expect(later.search('thermal')).toHaveLength(1);
    expect(later.needsRevisit(['higher-temperature filament'])).toHaveLength(1);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('cost budgets', () => {
  it('flags a job that exceeds material and time budgets', () => {
    const verdict = checkBudget(
      {
        estimatedMs: 6 * 3600_000,
        timeoutMs: 8 * 3600_000,
        estimatedCostCents: 240,
        materials: { grams: 840 },
        wearFraction: 0.2,
      },
      {
        maxDurationMs: 4 * 3600_000,
        maxCostCents: 500,
        maxWearFraction: 0.5,
        maxMaterials: { grams: 500 },
      },
    );
    expect(verdict.withinBudget).toBe(false);
    expect(verdict.violations).toHaveLength(2);
  });
});

describe('legacy migration surfaces debt instead of hiding it', () => {
  const legacy = {
    capabilityId: 'tool.create_task',
    capabilityName: 'Create Task',
    description: 'Create a task in the actions table',
    provider: 'action_executor',
    riskLevel: 'R1',
    autonomyRequirement: 2,
    dependencies: [],
    verificationStrategy: 'Verify task exists in actions table by ID',
    reversible: true,
    timeoutMs: 10000,
    metadata: { actionType: 'create_task' },
  };

  it('preserves the prose strategy but contributes no predicate', () => {
    const contract = liftLegacyDescriptor(legacy);
    expect(contract.verification.description).toContain('actions table');
    expect(contract.verification.conditions).toHaveLength(0);
    expect(validateContract(contract).effectiveMaxTier).toBe('R1');
  });

  it('does not launder a `reversible: true` boolean into a proven undo', () => {
    const contract = liftLegacyDescriptor(legacy);
    expect(contract.reversibility.kind).toBe('snapshot_restore');
    expect(contract.reversibility.caveat).toContain('unproven');
  });

  it('reports which legacy risk levels were optimistic', () => {
    const { report } = liftAll(
      [legacy, { ...legacy, capabilityId: 'comm.send_message', riskLevel: 'R1', reversible: false }],
      (contract) =>
        computeAuthority(
          contract,
          {},
          defaultState({ environment: 'production', incidentActive: true, humanPresent: false }),
        ).tier,
    );

    expect(report.needsVerificationPredicate).toHaveLength(2);
    expect(report.underratedByLegacy.length).toBeGreaterThan(0);
    const sendMessage = report.underratedByLegacy.find(
      (u) => u.capabilityId === 'comm.send_message',
    );
    expect(sendMessage).toBeDefined();
    expect(sendMessage?.legacy).toBe('R1');
  });
});

describe('state snapshot helper', () => {
  it('produces an attended development default', () => {
    const state: SystemStateSnapshot = defaultState();
    expect(state.environment).toBe('development');
    expect(state.humanPresent).toBe(true);
    expect(state.incidentActive).toBe(false);
  });
});

describe('reference contracts: fabrication and npm test are the same object', () => {
  // The whole thesis, asserted. Both go through identical code paths; only
  // the field values differ.
  it('both validate as complete contracts', () => {
    for (const contract of REFERENCE_CONTRACTS) {
      const result = validateContract(contract);
      const errors = result.issues.filter((i) => i.severity === 'error');
      expect({ id: contract.identity.id, errors }).toEqual({
        id: contract.identity.id,
        errors: [],
      });
    }
  });

  it('rates them by their numbers, not by special-casing hardware', () => {
    const state = defaultState();
    const tests = computeAuthority(RUN_TESTS_CONTRACT, { testPath: 'tests/unit' }, state);
    const print = computeAuthority(
      PRINT_JOB_CONTRACT,
      { printerId: 'k1-01', jobPath: 'jobs/bracket.3mf', estimatedGrams: 84 },
      defaultState({ armedInterlocks: FDM_PRINT_INTERLOCKS.map((i) => i.id) }),
    );

    expect(tests.tier).toBe('R2');
    expect(['R3', 'R4']).toContain(print.tier);
  });

  it('prohibits the print when interlocks are not armed, whatever the delegation', () => {
    const decision = computeAuthority(
      PRINT_JOB_CONTRACT,
      { printerId: 'k1-01', jobPath: 'jobs/bracket.3mf', estimatedGrams: 84 },
      defaultState({ armedInterlocks: ['thermal_runaway_firmware'] }),
    );
    expect(decision.tier).toBe('R5');
  });

  it('dry-runs both through one interface', async () => {
    const registry = new ContractRegistry();
    for (const contract of REFERENCE_CONTRACTS) {
      registry.register(contract, async () => ({}));
    }

    const testSim = await registry.simulate('repo.run_tests', {}, defaultState());
    const printSim = await registry.simulate(
      'protoforge.print_job',
      { printerId: 'k1-01', jobPath: 'jobs/bracket.3mf', estimatedGrams: 84 },
      defaultState({ extra: { 'printer.k1-01.grams': 40 } }),
    );

    expect(testSim?.status).toBe('simulated');
    expect(printSim?.status).toBe('simulated');
    expect(printSim?.outcome?.wouldSucceed).toBe(false);
    expect(printSim?.outcome?.warnings.join(' ')).toContain('material margin');
  });

  it('blocks the print on an unmet precondition rather than denying it', () => {
    const registry = new ContractRegistry();
    registry.register(PRINT_JOB_CONTRACT, async () => ({}));

    const resolved = registry.resolve(
      'protoforge.print_job',
      { printerId: 'k1-01', jobPath: 'jobs/bracket.3mf', estimatedGrams: 84 },
      defaultState({
        armedInterlocks: FDM_PRINT_INTERLOCKS.map((i) => i.id),
        extra: { 'printer.k1-01.state': 'printing', 'printer.k1-01.grams': 900 },
      }),
      { ...FULL_DELEGATION, autonomousCeiling: 'R4' },
    );

    expect(resolved?.executable).toBe(false);
    expect(resolved?.unmetPreconditions.join(' ')).toContain('printer_idle');
  });
});

describe('causal correlation collapses alert storms', () => {
  function stack(): CausalCorrelator {
    const correlator = new CausalCorrelator();
    correlator.addEdges([
      { from: 'api', to: 'database', kind: 'hard', description: 'reads/writes' },
      { from: 'frontend', to: 'api', kind: 'hard', description: 'fetches' },
      { from: 'mobile', to: 'api', kind: 'hard', description: 'fetches' },
      { from: 'search', to: 'database', kind: 'soft', description: 'index refresh' },
    ]);
    return correlator;
  }

  const at = (m: number) => new Date(Date.UTC(2026, 8, 8, 3, m)).toISOString();

  it('reports one root cause instead of four failures', () => {
    const result = stack().correlate([
      { component: 'database', observedAt: at(0), symptom: 'connection refused', severity: 'down' },
      { component: 'api', observedAt: at(1), symptom: '500s', severity: 'down' },
      { component: 'frontend', observedAt: at(1), symptom: 'blank page', severity: 'down' },
      { component: 'mobile', observedAt: at(2), symptom: 'timeout', severity: 'degraded' },
    ]);

    expect(result.rootCauses).toHaveLength(1);
    expect(result.rootCauses[0].component).toBe('database');
    expect(result.rootCauses[0].explains.map((c) => c.component).sort()).toEqual([
      'api',
      'frontend',
      'mobile',
    ]);
    expect(result.suppression).toEqual({ rawFailures: 4, reportedCauses: 1 });
    expect(result.summary).toContain('Root cause appears to be database');
  });

  it('attributes to the deepest failing dependency, not the nearest hop', () => {
    const result = stack().correlate([
      { component: 'database', observedAt: at(0), symptom: 'down', severity: 'down' },
      { component: 'api', observedAt: at(1), symptom: '500s', severity: 'down' },
      { component: 'frontend', observedAt: at(2), symptom: 'blank', severity: 'down' },
    ]);
    const frontend = result.rootCauses[0].explains.find((c) => c.component === 'frontend');
    expect(frontend?.path).toEqual(['frontend', 'api', 'database']);
  });

  it('keeps genuinely independent failures separate', () => {
    const result = stack().correlate([
      { component: 'database', observedAt: at(0), symptom: 'down', severity: 'down' },
      { component: 'api', observedAt: at(1), symptom: '500s', severity: 'down' },
      { component: 'printer-farm', observedAt: at(1), symptom: 'offline', severity: 'down' },
    ]);
    expect(result.rootCauses.map((r) => r.component).sort()).toEqual([
      'database',
      'printer-farm',
    ]);
  });

  it('lowers confidence when the ordering contradicts the graph', () => {
    const result = stack().correlate([
      { component: 'database', observedAt: at(5), symptom: 'down', severity: 'down' },
      { component: 'api', observedAt: at(0), symptom: '500s', severity: 'down' },
    ]);
    expect(result.rootCauses[0].component).toBe('database');
    expect(result.rootCauses[0].confidence).toBeLessThan(0.9);
    expect(result.rootCauses[0].reasoning).toContain('ordering is inconsistent');
  });

  it('derives graph edges from contract dependencies', () => {
    const correlator = new CausalCorrelator();
    correlator.addFromContracts([
      { identity: { id: 'protoforge.print_job', provider: 'protoforge' }, dependencies: ['protoforge.slice_model'] },
      { identity: { id: 'protoforge.slice_model', provider: 'slicer' }, dependencies: [] },
    ]);
    expect(correlator.dependenciesOf('protoforge')).toEqual(['slicer']);
  });
});

describe('an undo may not be gated harder than the act it reverses', () => {
  // Found by measurement: registering an inverse correctly dropped the forward
  // capability's tier, and left the inverse itself requiring approval. That
  // grants autonomy on the strength of a rollback the system will not run.
  function buildPair(): ContractRegistry {
    const registry = new ContractRegistry({ strict: false });

    registry.register(
      defineContract({
        identity: {
          id: 'queue.enqueue',
          version: '1.0.0',
          owner: 'owner@hydi',
          provider: 'queue',
          description: 'Add a pending job',
        },
        effects: [
          {
            verb: 'create',
            resourceKind: 'database',
            resourcePatterns: ['jobs'],
            worstCaseScope: 'single_resource',
            crossesTrustBoundary: false,
          },
        ],
        reversibility: {
          kind: 'inverse_capability',
          inverseCapabilityId: 'queue.dequeue',
          windowMs: Number.POSITIVE_INFINITY,
          caveat: 'only while pending',
        },
        verification: {
          description: 'row exists',
          observation: { source: 'database', target: 'jobs', extractFields: ['id'], settleMs: 0 },
          conditions: [{ field: 'found', operator: 'eq', expected: true }],
          onFailure: 'escalate',
          maxRetries: 1,
          requiresHumanConfirmation: false,
        },
      }),
      async () => ({}),
    );

    registry.register(
      defineContract({
        identity: {
          id: 'queue.dequeue',
          version: '1.0.0',
          owner: 'owner@hydi',
          provider: 'queue',
          description: 'Remove a pending job',
        },
        // `delete` carries a higher verb floor, and the undo has no undo of its
        // own — which is what pushes it above the act it reverses.
        effects: [
          {
            verb: 'delete',
            resourceKind: 'database',
            resourcePatterns: ['jobs'],
            worstCaseScope: 'single_resource',
            crossesTrustBoundary: false,
          },
        ],
        reversibility: { kind: 'none', windowMs: 0, caveat: 'no undo of the undo' },
        verification: {
          description: 'row absent',
          observation: { source: 'database', target: 'jobs', extractFields: ['id'], settleMs: 0 },
          conditions: [{ field: 'found', operator: 'eq', expected: false }],
          onFailure: 'escalate',
          maxRetries: 1,
          requiresHumanConfirmation: false,
        },
      }),
      async () => ({}),
    );

    return registry;
  }

  const state = defaultState({ humanPresent: false });

  it('rates the undo above the act before the rule is applied', () => {
    const registry = buildPair();
    const forward = computeAuthority(registry.get('queue.enqueue')!, {}, state);
    const inverse = computeAuthority(registry.get('queue.dequeue')!, {}, state);
    expect(tierIndex(inverse.tier)).toBeGreaterThan(tierIndex(forward.tier));
  });

  it('caps the undo to the tier of what it reverses', () => {
    const registry = buildPair();
    const forward = registry.authorityFor('queue.enqueue', {}, state)!;
    const inverse = registry.authorityFor('queue.dequeue', {}, state)!;

    expect(inverse.tier).toBe(forward.tier);
    expect(inverse.requiresApproval).toBe(forward.requiresApproval);
    expect(inverse.factors.map((f) => f.name)).toContain('inverse_coherence');
    expect(inverse.rationale).toContain('queue.enqueue');
  });

  it('leaves capabilities that reverse nothing untouched', () => {
    const registry = buildPair();
    registry.register(fileDeleteContract(['/tmp/**']), async () => ({}));
    const decision = registry.authorityFor('files.delete', { path: '/tmp/a' }, state)!;
    expect(decision.factors.map((f) => f.name)).not.toContain('inverse_coherence');
  });

  it('reports a reversibility claim whose inverse is not registered', () => {
    const registry = new ContractRegistry({ strict: false });
    const contract = fileDeleteContract(['/tmp/**']);
    contract.reversibility = {
      kind: 'inverse_capability',
      inverseCapabilityId: 'files.restore',
      windowMs: 1000,
      caveat: '',
    };
    registry.register(contract, async () => ({}));

    // A claim resting on a capability that does not exist is the boolean
    // `reversible: true` problem in a better costume.
    expect(registry.danglingInverses()).toEqual([
      { capabilityId: 'files.delete', missingInverse: 'files.restore' },
    ]);
  });
});
