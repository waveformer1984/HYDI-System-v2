/**
 * Unit tests for DelegatedIdentity + ResourceBoundaries + SideEffectPolicies
 */

import {
  DelegatedIdentityManager,
  createDefaultSideEffectPolicies,
  createDefaultResourceBoundaries,
  capabilityToSideEffectCategory,
  capabilityToResourceType,
} from '../../lib/delegated-operator/DelegatedIdentity';
import type { DelegatedIdentity, AuthorityEvaluationContext } from '../../lib/delegated-operator/DelegatedIdentity';
import { STRICT_CONFIRMATION } from '../../lib/human-action/AuthorityManager';
import type { DelegatedAuthority } from '../../lib/human-action/AuthorityManager';

function makeAuthority(): DelegatedAuthority {
  return {
    authorityId: 'auth_test_001',
    delegatedBy: 'user:owner',
    delegatedTo: 'heidi',
    scopes: ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION', 'CREDENTIAL_MANAGEMENT', 'DESTRUCTIVE'],
    riskLimit: 'HIGH',
    riskLevelLimit: 'R4',
    resourcePatterns: [{ type: 'any', pattern: '*', description: 'All' }],
    timeConstraint: { type: 'session_bounded', sessionId: 'test_session' },
    requiresConfirmation: STRICT_CONFIRMATION,
    purpose: 'testing',
    createdAt: new Date().toISOString(),
    metadata: {},
  };
}

function makeIdentity(manager: DelegatedIdentityManager, overrides?: Partial<DelegatedIdentity>): DelegatedIdentity {
  const now = Date.now();
  return manager.delegate({
    userId: 'user:owner',
    sessionId: 'test_session',
    authority: makeAuthority(),
    expiresAt: new Date(now + 3600000).toISOString(),
    includedCapabilities: [],
    excludedCapabilities: [],
    alwaysConfirmActions: [],
    resourceBoundaries: createDefaultResourceBoundaries('C:\\Users\\Owner\\HYDI-System-v2'),
    sideEffectPolicies: createDefaultSideEffectPolicies(),
    purpose: 'testing',
    ...overrides,
  });
}

function makeContext(identity: DelegatedIdentity, overrides?: Partial<AuthorityEvaluationContext>): AuthorityEvaluationContext {
  return {
    identity,
    capability: 'filesystem.write_file',
    category: 'SYSTEM',
    target: 'C:\\Users\\Owner\\HYDI-System-v2\\test.txt',
    risk: 'R1',
    scope: 'LOCAL_WRITE',
    mode: 'autonomous',
    resourceType: 'filesystem_path',
    sideEffectCategory: 'CREATE',
    ...overrides,
  };
}

describe('DelegatedIdentityManager', () => {
  let manager: DelegatedIdentityManager;

  beforeEach(() => {
    manager = new DelegatedIdentityManager();
  });

  test('delegates and retrieves identity', () => {
    const identity = makeIdentity(manager);
    expect(identity.identityId).toBeDefined();
    expect(manager.getIdentity(identity.identityId)).toBe(identity);
    expect(manager.getIdentityBySession('test_session')).toBe(identity);
  });

  test('isIdentityValid returns true for fresh identity', () => {
    const identity = makeIdentity(manager);
    const validity = manager.isIdentityValid(identity.identityId);
    expect(validity.valid).toBe(true);
  });

  test('isIdentityValid returns false for expired identity', () => {
    const identity = makeIdentity(manager, {
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const validity = manager.isIdentityValid(identity.identityId);
    expect(validity.valid).toBe(false);
    expect(validity.reason).toContain('expired');
  });

  test('isIdentityValid returns false for revoked identity', () => {
    const identity = makeIdentity(manager);
    manager.revoke(identity.identityId, 'user:owner');
    const validity = manager.isIdentityValid(identity.identityId);
    expect(validity.valid).toBe(false);
    expect(validity.reason).toContain('revoked');
  });

  test('evaluate authorizes valid workspace file write', () => {
    const identity = makeIdentity(manager);
    const result = manager.evaluate(makeContext(identity));
    expect(result.authorized).toBe(true);
    expect(result.requiresConfirmation).toBe(false);
  });

  test('evaluate denies write to C:\\Windows (protected path)', () => {
    const identity = makeIdentity(manager);
    const result = manager.evaluate(makeContext(identity, {
      target: 'C:\\Windows\\System32\\evil.bat',
    }));
    expect(result.authorized).toBe(false);
    expect(result.deniedBy).toBe('resource_boundary');
    expect(result.reason).toContain('denied by boundary');
  });

  test('evaluate denies write to .env files', () => {
    const identity = makeIdentity(manager);
    const result = manager.evaluate(makeContext(identity, {
      target: 'C:\\Users\\Owner\\HYDI-System-v2\\.env',
    }));
    expect(result.authorized).toBe(false);
    expect(result.deniedBy).toBe('resource_boundary');
  });

  test('evaluate denies excluded capability', () => {
    const identity = makeIdentity(manager, {
      excludedCapabilities: ['filesystem.delete_file'],
    });
    const result = manager.evaluate(makeContext(identity, {
      capability: 'filesystem.delete_file',
      target: 'C:\\Users\\Owner\\HYDI-System-v2\\test.txt',
      risk: 'R3',
      scope: 'DESTRUCTIVE',
      sideEffectCategory: 'DELETE',
    }));
    expect(result.authorized).toBe(false);
    expect(result.deniedBy).toBe('excluded_capability');
  });

  test('evaluate requires confirmation for DELETE side effect', () => {
    const identity = makeIdentity(manager);
    const result = manager.evaluate(makeContext(identity, {
      capability: 'filesystem.delete_file',
      target: 'C:\\Users\\Owner\\HYDI-System-v2\\test.txt',
      risk: 'R3',
      scope: 'DESTRUCTIVE',
      sideEffectCategory: 'DELETE',
    }));
    expect(result.authorized).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
  });

  test('evaluate requires confirmation for FINANCIAL side effect', () => {
    const identity = makeIdentity(manager);
    const result = manager.evaluate(makeContext(identity, {
      capability: 'financial.create_charge',
      target: 'stripe',
      risk: 'R5',
      scope: 'FINANCIAL',
      resourceType: 'service',
      sideEffectCategory: 'FINANCIAL',
    }));
    expect(result.requiresConfirmation).toBe(true);
  });

  test('evaluate respects alwaysConfirmActions', () => {
    const identity = makeIdentity(manager, {
      alwaysConfirmActions: ['filesystem.write_file'],
    });
    const result = manager.evaluate(makeContext(identity));
    expect(result.authorized).toBe(true);
    expect(result.requiresConfirmation).toBe(true);
    expect(result.deniedBy).toBe('always_confirm');
  });

  test('evaluate denies browser navigation to chrome:// pages', () => {
    const identity = makeIdentity(manager);
    const result = manager.evaluate(makeContext(identity, {
      capability: 'browser.navigate',
      target: 'chrome://settings',
      risk: 'R1',
      scope: 'READ_ONLY',
      resourceType: 'browser_origin',
      sideEffectCategory: 'MODIFY',
    }));
    expect(result.authorized).toBe(false);
    expect(result.deniedBy).toBe('resource_boundary');
  });

  test('evaluate denies dangerous commands', () => {
    const identity = makeIdentity(manager);
    const result = manager.evaluate(makeContext(identity, {
      capability: 'process.execute',
      target: 'rm -rf /',
      risk: 'R2',
      scope: 'SERVICE_OPERATION',
      resourceType: 'command',
      sideEffectCategory: 'DELETE',
    }));
    expect(result.authorized).toBe(false);
    expect(result.deniedBy).toBe('resource_boundary');
  });

  test('delegation does not silently expand', () => {
    const identity = makeIdentity(manager, {
      includedCapabilities: ['filesystem.read_file', 'filesystem.write_file'],
    });
    // Try to use a capability not in the included list
    const result = manager.evaluate(makeContext(identity, {
      capability: 'process.execute',
      target: 'npm test',
      risk: 'R2',
      scope: 'SERVICE_OPERATION',
      resourceType: 'command',
      sideEffectCategory: 'MODIFY',
    }));
    expect(result.authorized).toBe(false);
    expect(result.deniedBy).toBe('excluded_capability');
  });
});

describe('capabilityToSideEffectCategory', () => {
  test('maps read operations to READ', () => {
    expect(capabilityToSideEffectCategory('filesystem.read_file')).toBe('READ');
    expect(capabilityToSideEffectCategory('browser.inspect_page')).toBe('READ');
    expect(capabilityToSideEffectCategory('credential.discover')).toBe('READ');
    expect(capabilityToSideEffectCategory('infra.health_check')).toBe('READ');
  });

  test('maps delete operations to DELETE', () => {
    expect(capabilityToSideEffectCategory('filesystem.delete_file')).toBe('DELETE');
    expect(capabilityToSideEffectCategory('credential.revoke')).toBe('DELETE');
  });

  test('maps financial operations to FINANCIAL', () => {
    expect(capabilityToSideEffectCategory('financial.create_charge')).toBe('FINANCIAL');
    expect(capabilityToSideEffectCategory('financial.refund')).toBe('FINANCIAL');
  });

  test('maps communication operations to COMMUNICATE', () => {
    expect(capabilityToSideEffectCategory('comm.send_email')).toBe('COMMUNICATE');
    expect(capabilityToSideEffectCategory('comm.send_message')).toBe('COMMUNICATE');
  });

  test('maps deploy operations to DEPLOY', () => {
    expect(capabilityToSideEffectCategory('dev.deploy')).toBe('DEPLOY');
    expect(capabilityToSideEffectCategory('dev.git_push')).toBe('DEPLOY');
  });
});

describe('capabilityToResourceType', () => {
  test('maps filesystem capabilities to filesystem_path', () => {
    expect(capabilityToResourceType('filesystem.write_file', 'C:\\test.txt')).toBe('filesystem_path');
  });

  test('maps browser capabilities to browser_origin', () => {
    expect(capabilityToResourceType('browser.navigate', 'https://example.com')).toBe('browser_origin');
  });

  test('maps network capabilities to api_endpoint', () => {
    expect(capabilityToResourceType('network.http_request', 'https://api.stripe.com')).toBe('api_endpoint');
  });

  test('maps dev.git capabilities to repository', () => {
    expect(capabilityToResourceType('dev.git_status', 'C:\\repo')).toBe('repository');
  });
});

describe('InterventionQueue', () => {
  test('enqueue and get pending', async () => {
    const { InterventionQueue } = await import('../../lib/delegated-operator/InterventionQueue');
    const queue = new InterventionQueue();
    const req = queue.enqueue({
      goalId: 'goal_001',
      identityId: 'identity_001',
      userId: 'user:owner',
      currentObjective: 'LOGIN',
      blocker: 'MFA required',
      requiredHumanAction: 'Approve the login on the authentication device',
      whyRequired: 'MFA cannot be bypassed',
      expectedResultingState: 'Authenticated browser session',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      resumeCondition: 'Authenticated browser session detected',
      auditId: 'audit_001',
      interventionType: 'MFA_REQUIRED',
      originalRequest: {
        requestId: 'req_001',
        actionId: 'action_001',
        goalId: 'goal_001',
        reason: 'MFA required',
        whatWasAttempted: 'Login',
        whatSucceeded: 'Username and password accepted',
        whatFailed: 'MFA challenge',
        whyCannotContinue: 'Cannot bypass MFA',
        requiredHumanAction: 'Approve MFA',
        whatHappensAfter: 'Continue with authenticated session',
        interventionType: 'MFA_REQUIRED',
        timestamp: new Date().toISOString(),
      },
    });
    expect(req.requestId).toBeDefined();
    expect(req.status).toBe('pending');
    expect(queue.getPending()).toHaveLength(1);
    expect(queue.getPendingByGoal('goal_001')).toHaveLength(1);
  });

  test('resolve marks as resolved', async () => {
    const { InterventionQueue } = await import('../../lib/delegated-operator/InterventionQueue');
    const queue = new InterventionQueue();
    const req = queue.enqueue({
      goalId: 'goal_001',
      identityId: 'identity_001',
      userId: 'user:owner',
      currentObjective: 'LOGIN',
      blocker: 'MFA required',
      requiredHumanAction: 'Approve MFA',
      whyRequired: 'Cannot bypass',
      expectedResultingState: 'Authenticated',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      resumeCondition: 'Authenticated session',
      auditId: 'audit_001',
      interventionType: 'MFA_REQUIRED',
      originalRequest: {
        requestId: 'req_001', actionId: 'action_001', goalId: 'goal_001',
        reason: 'MFA', whatWasAttempted: 'Login', whatSucceeded: 'Creds',
        whatFailed: 'MFA', whyCannotContinue: 'Cannot bypass',
        requiredHumanAction: 'Approve', whatHappensAfter: 'Continue',
        interventionType: 'MFA_REQUIRED', timestamp: new Date().toISOString(),
      },
    });
    expect(queue.resolve(req.requestId, 'User approved MFA')).toBe(true);
    expect(queue.get(req.requestId)?.status).toBe('resolved');
    expect(queue.getPending()).toHaveLength(0);
  });

  test('expireStale marks expired interventions', async () => {
    const { InterventionQueue } = await import('../../lib/delegated-operator/InterventionQueue');
    const queue = new InterventionQueue();
    queue.enqueue({
      goalId: 'goal_001', identityId: 'identity_001', userId: 'user:owner',
      currentObjective: 'LOGIN', blocker: 'MFA', requiredHumanAction: 'Approve',
      whyRequired: 'Cannot bypass', expectedResultingState: 'Auth',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      resumeCondition: 'Auth session', auditId: 'audit_001',
      interventionType: 'MFA_REQUIRED',
      originalRequest: {
        requestId: 'req_001', actionId: 'action_001', goalId: 'goal_001',
        reason: 'MFA', whatWasAttempted: 'Login', whatSucceeded: 'Creds',
        whatFailed: 'MFA', whyCannotContinue: 'Cannot bypass',
        requiredHumanAction: 'Approve', whatHappensAfter: 'Continue',
        interventionType: 'MFA_REQUIRED', timestamp: new Date().toISOString(),
      },
    });
    expect(queue.expireStale()).toBe(1);
    expect(queue.getPending()).toHaveLength(0);
  });
});

describe('VerificationContractRegistry', () => {
  test('verifies filesystem.write_file with correct state', async () => {
    const { VerificationContractRegistry, createDefaultVerificationContracts } = await import('../../lib/delegated-operator/VerificationContract');
    const registry = new VerificationContractRegistry();
    for (const contract of createDefaultVerificationContracts()) {
      registry.register(contract);
    }
    const result = registry.verify('filesystem.write_file', {
      exists: true,
      size: 42,
    });
    expect(result.verified).toBe(true);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  test('fails verification when file does not exist', async () => {
    const { VerificationContractRegistry, createDefaultVerificationContracts } = await import('../../lib/delegated-operator/VerificationContract');
    const registry = new VerificationContractRegistry();
    for (const contract of createDefaultVerificationContracts()) {
      registry.register(contract);
    }
    const result = registry.verify('filesystem.write_file', {
      exists: false,
      size: 0,
    });
    expect(result.verified).toBe(false);
    expect(result.failedConditions.length).toBeGreaterThan(0);
  });

  test('verifies HTTP request with 2xx status', async () => {
    const { VerificationContractRegistry, createDefaultVerificationContracts } = await import('../../lib/delegated-operator/VerificationContract');
    const registry = new VerificationContractRegistry();
    for (const contract of createDefaultVerificationContracts()) {
      registry.register(contract);
    }
    const result = registry.verify('network.http_request', {
      statusCode: 200,
      body: { ok: true },
    });
    expect(result.verified).toBe(true);
  });

  test('fails verification for HTTP 401', async () => {
    const { VerificationContractRegistry, createDefaultVerificationContracts } = await import('../../lib/delegated-operator/VerificationContract');
    const registry = new VerificationContractRegistry();
    for (const contract of createDefaultVerificationContracts()) {
      registry.register(contract);
    }
    const result = registry.verify('network.http_request', {
      statusCode: 401,
      body: { error: 'Unauthorized' },
    });
    expect(result.verified).toBe(false);
  });
});

describe('GoalCheckpointManager', () => {
  test('creates and retrieves checkpoint', async () => {
    const { GoalCheckpointManager } = await import('../../lib/delegated-operator/GoalCheckpoint');
    const manager = new GoalCheckpointManager();
    const cp = manager.checkpoint({
      goalId: 'goal_001',
      identityId: 'identity_001',
      goalStatement: 'Test goal',
      planVersion: 1,
      completedObjectives: ['CODE_HEALTHY'],
      failedObjectives: [],
      inProgressObjectives: ['SERVICES_RUNNING'],
      pendingObjectives: ['ENDPOINT_VERIFIED'],
      executedActions: [],
      verifiedState: { 'health:localhost:3000': { healthy: true } },
      status: 'RUNNING',
      resumeCondition: 'Service is still running',
      executedSideEffects: [],
      summary: '1 completed, 1 in progress, 1 pending',
    });
    expect(cp.checkpointId).toBeDefined();
    expect(manager.getCheckpoint('goal_001')).toBe(cp);
  });

  test('getResumePoint resumes from in_progress', async () => {
    const { GoalCheckpointManager } = await import('../../lib/delegated-operator/GoalCheckpoint');
    const manager = new GoalCheckpointManager();
    const cp = manager.checkpoint({
      goalId: 'goal_001',
      identityId: 'identity_001',
      goalStatement: 'Test goal',
      planVersion: 1,
      completedObjectives: ['CODE_HEALTHY'],
      failedObjectives: [],
      inProgressObjectives: ['SERVICES_RUNNING'],
      pendingObjectives: ['ENDPOINT_VERIFIED'],
      executedActions: [],
      verifiedState: {},
      status: 'PAUSED',
      resumeCondition: 'Service is running',
      executedSideEffects: [],
      summary: 'Paused',
    });
    const resume = manager.getResumePoint(cp);
    expect(resume.resumeFrom).toBe('in_progress');
    expect(resume.objectivesToExecute).toContain('SERVICES_RUNNING');
    expect(resume.objectivesToSkip).toContain('CODE_HEALTHY');
  });

  test('revalidate detects state changes', async () => {
    const { GoalCheckpointManager } = await import('../../lib/delegated-operator/GoalCheckpoint');
    const manager = new GoalCheckpointManager();
    const cp = manager.checkpoint({
      goalId: 'goal_001',
      identityId: 'identity_001',
      goalStatement: 'Test goal',
      planVersion: 1,
      completedObjectives: ['CODE_HEALTHY'],
      failedObjectives: [],
      inProgressObjectives: [],
      pendingObjectives: ['SERVICES_RUNNING'],
      executedActions: [],
      verifiedState: { 'health:localhost:3000': { healthy: true } },
      status: 'PAUSED',
      resumeCondition: 'Service is running',
      executedSideEffects: [],
      summary: 'Paused',
    });
    const result = manager.revalidate(cp, new Map([
      ['health:localhost:3000', { healthy: false }],
    ]));
    expect(result.consistent).toBe(false);
    expect(result.invalidatedObjectives).toContain('health:localhost:3000');
  });
});

describe('InterventionPersistence', () => {
  test('create persists intervention to Supabase', async () => {
    const { InterventionPersistence } = await import('../../lib/delegated-operator/InterventionPersistence');
    const insert = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      from: jest.fn().mockReturnValue({ insert, select: jest.fn(), update: jest.fn() }),
    };
    const persistence = new InterventionPersistence(supabase as any);
    const request = {
      requestId: 'intervention_test_001',
      goalId: 'goal_001',
      identityId: 'identity_001',
      userId: 'user:owner',
      currentObjective: 'LOGIN',
      blocker: 'MFA required',
      requiredHumanAction: 'Approve MFA',
      whyRequired: 'Cannot bypass',
      expectedResultingState: 'Authenticated',
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      resumeCondition: 'Auth session',
      auditId: 'audit_001',
      interventionType: 'MFA_REQUIRED',
      status: 'pending' as const,
      originalRequest: {
        requestId: 'intervention_test_001', actionId: 'action_001', goalId: 'goal_001',
        reason: 'MFA', whatWasAttempted: 'Login', whatSucceeded: 'Creds',
        whatFailed: 'MFA', whyCannotContinue: 'Cannot bypass',
        requiredHumanAction: 'Approve', whatHappensAfter: 'Continue',
        interventionType: 'MFA_REQUIRED' as any, timestamp: new Date().toISOString(),
      },
    };
    const result = await persistence.create(request);
    expect(result).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('human_intervention_requests');
    expect(insert).toHaveBeenCalled();
  });

  test('complete marks intervention as resolved', async () => {
    const { InterventionPersistence } = await import('../../lib/delegated-operator/InterventionPersistence');
    const update = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      }),
    });
    const supabase = {
      from: jest.fn().mockReturnValue({ update, insert: jest.fn(), select: jest.fn() }),
    };
    const persistence = new InterventionPersistence(supabase as any);
    const result = await persistence.complete('intervention_test_001', 'User approved MFA');
    expect(result).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith('human_intervention_requests');
    expect(update).toHaveBeenCalled();
  });

  test('expireStale expires past-due interventions', async () => {
    const { InterventionPersistence } = await import('../../lib/delegated-operator/InterventionPersistence');
    // expireStale chain: .update(...).eq('status','pending').lt('expires_at',...).select('id')
    const selectMock = jest.fn().mockResolvedValue({ error: null, data: [{ id: '1' }, { id: '2' }] });
    const ltMock = jest.fn().mockReturnValue({ select: selectMock });
    const eqMock = jest.fn().mockReturnValue({ lt: ltMock });
    const update = jest.fn().mockReturnValue({ eq: eqMock });
    const supabase = {
      from: jest.fn().mockReturnValue({ update, insert: jest.fn() }),
    };
    const persistence = new InterventionPersistence(supabase as any);
    const count = await persistence.expireStale();
    expect(count).toBe(2);
  });

  test('redacts secrets before persisting', async () => {
    const { InterventionPersistence } = await import('../../lib/delegated-operator/InterventionPersistence');
    let insertedRow: any = null;
    const insert = jest.fn().mockImplementation((row) => {
      insertedRow = row;
      return { error: null };
    });
    const supabase = {
      from: jest.fn().mockReturnValue({ insert, select: jest.fn(), update: jest.fn() }),
    };
    const persistence = new InterventionPersistence(supabase as any);
    const request = {
      requestId: 'intervention_test_002',
      goalId: 'goal_002',
      identityId: 'identity_002',
      userId: 'user:owner',
      currentObjective: 'LOGIN',
      blocker: 'MFA required',
      requiredHumanAction: 'Approve MFA',
      whyRequired: 'Cannot bypass',
      expectedResultingState: 'Authenticated',
      requestedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      resumeCondition: 'Auth session',
      auditId: 'audit_002',
      interventionType: 'MFA_REQUIRED',
      status: 'pending' as const,
      originalRequest: {
        requestId: 'intervention_test_002', actionId: 'action_002', goalId: 'goal_002',
        reason: 'MFA', whatWasAttempted: 'Login with password=sk_live_12345secret',
        whatSucceeded: 'Creds', whatFailed: 'MFA',
        whyCannotContinue: 'Cannot bypass', requiredHumanAction: 'Approve',
        whatHappensAfter: 'Continue', interventionType: 'MFA_REQUIRED' as any,
        timestamp: new Date().toISOString(),
      },
    };
    await persistence.create(request);
    expect(insertedRow).not.toBeNull();
    const serialized = JSON.stringify(insertedRow);
    expect(serialized).not.toContain('sk_live_12345');
    expect(serialized).not.toContain('password=');
  });
});

describe('InterventionQueue with persistence', () => {
  test('attachPersistence and restoreFromPersistence', async () => {
    const { InterventionQueue } = await import('../../lib/delegated-operator/InterventionQueue');
    const { InterventionPersistence } = await import('../../lib/delegated-operator/InterventionPersistence');

    const insert = jest.fn().mockResolvedValue({ error: null });
    const select = jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          lt: jest.fn().mockResolvedValue({ error: null, data: [] }),
        }),
      }),
      order: jest.fn().mockResolvedValue({ error: null, data: [] }),
    });
    const supabase = {
      from: jest.fn().mockReturnValue({ insert, select, update: jest.fn() }),
    };

    const persistence = new InterventionPersistence(supabase as any);
    const queue = new InterventionQueue();
    queue.attachPersistence(persistence);

    // Enqueue should trigger Supabase insert
    const req = queue.enqueue({
      goalId: 'goal_persist_001',
      identityId: 'identity_001',
      userId: 'user:owner',
      currentObjective: 'LOGIN',
      blocker: 'MFA required',
      requiredHumanAction: 'Approve MFA',
      whyRequired: 'Cannot bypass',
      expectedResultingState: 'Authenticated',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      resumeCondition: 'Auth session',
      auditId: 'audit_001',
      interventionType: 'MFA_REQUIRED',
      originalRequest: {
        requestId: 'req_001', actionId: 'action_001', goalId: 'goal_persist_001',
        reason: 'MFA', whatWasAttempted: 'Login', whatSucceeded: 'Creds',
        whatFailed: 'MFA', whyCannotContinue: 'Cannot bypass',
        requiredHumanAction: 'Approve', whatHappensAfter: 'Continue',
        interventionType: 'MFA_REQUIRED' as any, timestamp: new Date().toISOString(),
      },
    });

    // Wait for async persistence
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(insert).toHaveBeenCalled();

    // Restore from persistence
    const restored = await queue.restoreFromPersistence();
    expect(restored).toBeGreaterThanOrEqual(0);
  });
});

describe('GoalStateMachine', () => {
  test('initializes and transitions correctly', async () => {
    const { GoalStateMachine } = await import('../../lib/delegated-operator/GoalStateMachine');
    const sm = new GoalStateMachine();
    sm.initialize('goal_001', 'RUNNING');
    expect(sm.getState('goal_001')).toBe('RUNNING');

    const result = sm.transition('goal_001', 'WAITING_FOR_HUMAN', 'MFA required');
    expect(result.success).toBe(true);
    expect(sm.getState('goal_001')).toBe('WAITING_FOR_HUMAN');
  });

  test('rejects invalid transitions', async () => {
    const { GoalStateMachine } = await import('../../lib/delegated-operator/GoalStateMachine');
    const sm = new GoalStateMachine();
    sm.initialize('goal_001', 'RUNNING');
    sm.transition('goal_001', 'COMPLETED', 'All objectives done');

    // COMPLETED is terminal — no transitions out
    const result = sm.transition('goal_001', 'RUNNING', 'Try to resume');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('terminal state');
  });

  test('rejects transition from WAITING_FOR_HUMAN to RECOVERING', async () => {
    const { GoalStateMachine } = await import('../../lib/delegated-operator/GoalStateMachine');
    const sm = new GoalStateMachine();
    sm.initialize('goal_001', 'RUNNING');
    sm.transition('goal_001', 'WAITING_FOR_HUMAN', 'MFA required');

    const result = sm.transition('goal_001', 'RECOVERING', 'Try to recover');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Invalid transition');
  });

  test('WAITING_FOR_HUMAN can transition to RUNNING (human completed)', async () => {
    const { GoalStateMachine } = await import('../../lib/delegated-operator/GoalStateMachine');
    const sm = new GoalStateMachine();
    sm.initialize('goal_001', 'RUNNING');
    sm.transition('goal_001', 'WAITING_FOR_HUMAN', 'MFA required');

    const result = sm.transition('goal_001', 'RUNNING', 'Human completed MFA');
    expect(result.success).toBe(true);
    expect(sm.getState('goal_001')).toBe('RUNNING');
  });

  test('WAITING_FOR_PROVIDER can transition to RUNNING (provider recovered)', async () => {
    const { GoalStateMachine } = await import('../../lib/delegated-operator/GoalStateMachine');
    const sm = new GoalStateMachine();
    sm.initialize('goal_001', 'RUNNING');
    sm.transition('goal_001', 'WAITING_FOR_PROVIDER', 'Ollama unavailable');

    const result = sm.transition('goal_001', 'RUNNING', 'Provider recovered');
    expect(result.success).toBe(true);
  });

  test('PAUSED can transition to RUNNING (user resumed)', async () => {
    const { GoalStateMachine } = await import('../../lib/delegated-operator/GoalStateMachine');
    const sm = new GoalStateMachine();
    sm.initialize('goal_001', 'RUNNING');
    sm.transition('goal_001', 'PAUSED', 'User paused');

    const result = sm.transition('goal_001', 'RUNNING', 'User resumed');
    expect(result.success).toBe(true);
  });

  test('tracks transition history', async () => {
    const { GoalStateMachine } = await import('../../lib/delegated-operator/GoalStateMachine');
    const sm = new GoalStateMachine();
    sm.initialize('goal_001', 'RUNNING');
    sm.transition('goal_001', 'WAITING_FOR_HUMAN', 'MFA required');
    sm.transition('goal_001', 'RUNNING', 'Human completed');

    const history = sm.getHistory('goal_001');
    expect(history.length).toBeGreaterThanOrEqual(3); // init + 2 transitions
    expect(history[1].from).toBe('RUNNING');
    expect(history[1].to).toBe('WAITING_FOR_HUMAN');
    expect(history[2].from).toBe('WAITING_FOR_HUMAN');
    expect(history[2].to).toBe('RUNNING');
  });

  test('isTerminal returns true for terminal states', async () => {
    const { GoalStateMachine } = await import('../../lib/delegated-operator/GoalStateMachine');
    const sm = new GoalStateMachine();
    sm.initialize('goal_001', 'RUNNING');
    sm.transition('goal_001', 'COMPLETED', 'Done');
    expect(sm.isTerminal('goal_001')).toBe(true);
  });

  test('isWaiting returns true for waiting states', async () => {
    const { GoalStateMachine } = await import('../../lib/delegated-operator/GoalStateMachine');
    const sm = new GoalStateMachine();
    sm.initialize('goal_001', 'RUNNING');
    sm.transition('goal_001', 'WAITING_FOR_HUMAN', 'MFA');
    expect(sm.isWaiting('goal_001')).toBe(true);
  });

  test('serialize and restore', async () => {
    const { GoalStateMachine } = await import('../../lib/delegated-operator/GoalStateMachine');
    const sm1 = new GoalStateMachine();
    sm1.initialize('goal_001', 'RUNNING');
    sm1.transition('goal_001', 'WAITING_FOR_HUMAN', 'MFA');
    const serialized = sm1.serialize();

    const sm2 = new GoalStateMachine();
    sm2.restore(serialized);
    expect(sm2.getState('goal_001')).toBe('WAITING_FOR_HUMAN');
    expect(sm2.getHistory('goal_001').length).toBeGreaterThanOrEqual(2);
  });
});
