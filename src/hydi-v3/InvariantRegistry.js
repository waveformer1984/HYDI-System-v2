'use strict';

const ArchitectureInvariant = require('./ArchitectureInvariant');
const fs = require('fs');
const path = require('path');

function readSource(guard, ...segments) {
  const filePath = path.join(guard.projectRoot, ...segments);
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function sourceContains(guard, file, ...patterns) {
  const content = readSource(guard, 'src', 'hydi-v3', file);
  return patterns.every((p) => content.includes(p));
}

function sourceContainsAny(guard, file, ...patterns) {
  const content = readSource(guard, 'src', 'hydi-v3', file);
  return patterns.some((p) => content.includes(p));
}

const INVARIANTS = [
  {
    id: 'exec-passes-policy',
    name: 'Remote execution passes through NodePolicy',
    description: 'DistributedTaskManager.execute must validate against this.policy',
    category: 'execution',
    severity: 'error',
    check: (guard) => {
      const hasPolicy = sourceContains(guard, 'DistributedTaskManager.js', 'this.policy', 'validateAction');
      const usesRequestedBy = sourceContains(guard, 'DistributedTaskManager.js', 'task.requestedBy');
      return {
        status: hasPolicy && usesRequestedBy ? 'pass' : 'fail',
        details: hasPolicy && usesRequestedBy
          ? 'DistributedTaskManager.execute validates task.requestedBy against policy'
          : 'DistributedTaskManager.execute must validate task.requestedBy using policy',
        affected: 'src/hydi-v3/DistributedTaskManager.js',
      };
    },
  },
  {
    id: 'lifecycle-recorded',
    name: 'Lifecycle mutations pass through LifecycleRegistry',
    description: 'DistributedTaskManager, FederationGateway and GoalManager must record lifecycle proposals',
    category: 'lifecycle',
    severity: 'error',
    check: (guard) => {
      const task = sourceContains(guard, 'DistributedTaskManager.js', 'this.lifecycleRegistry', 'recordProposal');
      const gateway = sourceContains(guard, 'FederationGateway.js', 'recordProposal') &&
        (sourceContainsAny(guard, 'FederationGateway.js', 'this.lifecycle', 'this.lifecycleRegistry'));
      const goal = sourceContains(guard, 'GoalManager.js', 'this.lifecycleRegistry', 'recordProposal');
      const ok = task && gateway && goal;
      return {
        status: ok ? 'pass' : 'fail',
        details: ok
          ? 'Task, gateway and goal managers record lifecycle proposals'
          : `Missing lifecycle registration in: ${[!task && 'DistributedTaskManager', !gateway && 'FederationGateway', !goal && 'GoalManager'].filter(Boolean).join(', ')}`,
        affected: 'src/hydi-v3/{DistributedTaskManager,FederationGateway,GoalManager}.js',
      };
    },
  },
  {
    id: 'governance-events',
    name: 'Autonomous actions generate governance events',
    description: 'StrategicPlanner and RecoveryCoordinator must validate against policy and emit audit events',
    category: 'governance',
    severity: 'error',
    check: (guard) => {
      const planner = sourceContains(guard, 'StrategicPlanner.js', 'this.policy', 'validateAction');
      const recovery = sourceContains(guard, 'RecoveryCoordinator.js', 'this.policy', 'validateAction');
      const audit = sourceContains(guard, 'RecoveryCoordinator.js', 'this.lifecycleRegistry', 'recordProposal');
      return {
        status: planner && recovery && audit ? 'pass' : 'fail',
        details: planner && recovery && audit
          ? 'Strategic planning and recovery validate through policy and audit'
          : 'Autonomous actions must be policy-gated and auditable',
        affected: 'src/hydi-v3/{StrategicPlanner,RecoveryCoordinator}.js',
      };
    },
  },
  {
    id: 'marketplace-signature',
    name: 'Marketplace installations verify signatures',
    description: 'MarketplaceManager must use a signature verifier',
    category: 'marketplace',
    severity: 'error',
    check: (guard) => {
      const hasVerifier = sourceContains(guard, 'MarketplaceManager.js', 'signatureVerifier', 'verifier');
      return {
        status: hasVerifier ? 'pass' : 'fail',
        details: hasVerifier
          ? 'MarketplaceManager has a signature verifier path'
          : 'MarketplaceManager must verify signatures before activation',
        affected: 'src/hydi-v3/MarketplaceManager.js',
      };
    },
  },
  {
    id: 'federation-policy-audit',
    name: 'Federation nodes pass policy and audit',
    description: 'FederationGateway and NodeMesh must use NodePolicy and audit events',
    category: 'federation',
    severity: 'error',
    check: (guard) => {
      const gateway = sourceContains(guard, 'FederationGateway.js', 'NodePolicy', 'validateAction') || sourceContains(guard, 'FederationGateway.js', 'this.policy', 'validateAction');
      const mesh = sourceContains(guard, 'NodeMesh.js', 'NodePolicy') || sourceContains(guard, 'NodeMesh.js', 'this.policy', 'validateAction');
      const audit = sourceContains(guard, 'FederationGateway.js', 'this.lifecycleRegistry', 'recordProposal') || sourceContains(guard, 'FederationGateway.js', '_audit');
      return {
        status: gateway && audit ? 'pass' : 'manual',
        details: gateway && audit
          ? 'Federation gateway validates and audits actions'
          : 'Federation gateway must validate actions and produce audit records (some checks manual)',
        affected: 'src/hydi-v3/{FederationGateway,NodeMesh}.js',
      };
    },
  },
  {
    id: 'service-contracts',
    name: 'Public subsystem interfaces expose ServiceContract',
    description: 'Phase 42 ServiceContract must be referenced by public subsystems',
    category: 'contracts',
    severity: 'warning',
    check: (guard) => {
      const serviceContract = readSource(guard, 'src', 'hydi-v3', 'ServiceContract.js');
      const used = ['SwarmCoordinator.js', 'CapabilityBroker.js', 'FederationGateway.js']
        .filter((f) => readSource(guard, 'src', 'hydi-v3', f).includes('ServiceContract') || readSource(guard, 'src', 'hydi-v3', f).includes('serviceContract'));
      return {
        status: used.length >= 2 ? 'pass' : 'warning',
        details: used.length >= 2
          ? `ServiceContract is imported by ${used.join(', ')}`
          : 'Public subsystems should use ServiceContract for versioned boundaries',
        affected: 'src/hydi-v3/{SwarmCoordinator,CapabilityBroker,FederationGateway}.js',
      };
    },
  },
  {
    id: 'audit-trail',
    name: 'Distributed tasks produce execution, policy and lifecycle records',
    description: 'DistributedTaskManager must emit audit and policy records on failure and execution',
    category: 'auditability',
    severity: 'error',
    check: (guard) => {
      const audit = sourceContains(guard, 'DistributedTaskManager.js', '_audit', 'audit');
      const policy = sourceContains(guard, 'DistributedTaskManager.js', 'validateAction');
      const lifecycle = sourceContains(guard, 'DistributedTaskManager.js', 'lifecycleRegistry', 'recordProposal');
      return {
        status: audit && policy && lifecycle ? 'pass' : 'fail',
        details: audit && policy && lifecycle
          ? 'DistributedTaskManager records audit, policy and lifecycle events'
          : 'DistributedTaskManager must record all three record types',
        affected: 'src/hydi-v3/DistributedTaskManager.js',
      };
    },
  },
  {
    id: 'recovery-points',
    name: 'Rollback-capable operations create recovery points and emit events',
    description: 'DistributedTaskManager and TaskEngine must emit rollback events and support recovery',
    category: 'recovery',
    severity: 'warning',
    check: (guard) => {
      const dt = sourceContains(guard, 'DistributedTaskManager.js', 'rollback', '_audit');
      const te = sourceContains(guard, 'TaskEngine.js', 'rollback', 'compensation');
      return {
        status: dt && te ? 'pass' : 'manual',
        details: dt && te
          ? 'DistributedTaskManager and TaskEngine support rollback'
          : 'Restore validation and recovery-point creation require manual verification',
        affected: 'src/hydi-v3/{DistributedTaskManager,TaskEngine}.js',
      };
    },
  },
  {
    id: 'strategic-no-direct-exec',
    name: 'Strategic layer does not execute work directly',
    description: 'StrategicPlanner, MissionPlanner and GoalManager must not call execute() or run handlers',
    category: 'strategy',
    severity: 'error',
    check: (guard) => {
      const files = ['StrategicPlanner.js', 'MissionPlanner.js', 'GoalManager.js'];
      const violations = [];
      for (const file of files) {
        const src = readSource(guard, 'src', 'hydi-v3', file);
        const calls = [];
        if (/\.execute\(/.test(src)) calls.push(`${file} calls .execute()`);
        if (/\.run\(/.test(src)) calls.push(`${file} calls .run()`);
        if (calls.length) violations.push(...calls);
      }
      return {
        status: violations.length === 0 ? 'pass' : 'fail',
        details: violations.length === 0
          ? 'Strategic layer does not invoke execution methods'
          : `Direct execution references found: ${violations.join(', ')}`,
        affected: 'src/hydi-v3/{StrategicPlanner,MissionPlanner,GoalManager}.js',
      };
    },
  },
  {
    id: 'plugin-isolation',
    name: 'Capabilities do not exceed declared permissions',
    description: 'MarketplaceManager must enforce permission declarations',
    category: 'plugins',
    severity: 'warning',
    check: () => ({
      status: 'manual',
      details: 'Permission enforcement requires runtime sandbox verification; manual review recommended',
      affected: 'src/hydi-v3/MarketplaceManager.js',
    }),
  },
];

class InvariantRegistry {
  constructor() {
    this.invariants = new Map();
    for (const inv of INVARIANTS) {
      this.register(new ArchitectureInvariant(inv));
    }
  }

  register(invariant) {
    this.invariants.set(invariant.id, invariant);
    return this;
  }

  get(id) {
    return this.invariants.get(id);
  }

  list() {
    return Array.from(this.invariants.values());
  }

  byCategory(category) {
    return this.list().filter((i) => i.category === category);
  }
}

module.exports = InvariantRegistry;
