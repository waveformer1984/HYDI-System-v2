/**
 * HEIDI Operational Control Plane — Heidi Executive Agent
 */

const { CapabilityRegistry } = require('./CapabilityRegistry');
const { TaskStateMachine } = require('./TaskStateMachine');
const { PolicyEngine } = require('./PolicyEngine');
const { ApprovalManager } = require('./ApprovalManager');
const { SecretBroker } = require('./SecretBroker');
const { AuditLog } = require('./AuditLog');
const { ControlledExecutor } = require('./ControlledExecutor');
const { HealthAggregator } = require('./HealthAggregator');
const { MissionPlanner } = require('./MissionPlanner');
const { RecoveryEngine } = require('./RecoveryEngine');
const { DryRunExecutor } = require('./DryRunExecutor');
const { WslExecutor } = require('./WslExecutor');
const { RuntimeObserver } = require('./RuntimeObserver');
const { RuntimeObservationAdapter } = require('./RuntimeObservationAdapter');
const { HeidiDecisionEngine } = require('./HeidiDecisionEngine');
const { IncidentStore } = require('./IncidentStore');
const { ImpactAssessor } = require('./ImpactAssessor');

class HeidiExecutive {
  constructor(options = {}) {
    this.dataDir = options.dataDir || null;
    this.registry = new CapabilityRegistry();
    this.stateMachine = new TaskStateMachine();
    this.policy = new PolicyEngine(this.registry);
    this.approvals = new ApprovalManager({ dataDir: this.dataDir });
    this.secrets = new SecretBroker();
    this.audit = new AuditLog({ redactor: this.secrets, dataDir: this.dataDir });
    this.executor = new ControlledExecutor(this.registry);
    this.wsl = WslExecutor.registerWith(this.executor, this.registry, options.wsl);
    this.health = new HealthAggregator();
    this.planner = new MissionPlanner(this.registry);
    this.recovery = new RecoveryEngine(this.executor, this.registry);
    this.dryRun = new DryRunExecutor(this.registry);
    this.runtimeObserver = options.runtimeObserver || new RuntimeObserver();
    this.observationAdapter = new RuntimeObservationAdapter({ manifestPath: options.manifestPath });
    this.decisionEngine = new HeidiDecisionEngine({
      registry: this.registry,
      audit: this.audit,
      redactor: this.secrets,
      dataDir: this.dataDir,
    });
    this.incidentStore = options.incidentStore || new IncidentStore({ redactor: this.secrets, dataDir: this.dataDir });
    this.candidates = options.candidates || this.buildDefaultCandidates();
  }

  buildDefaultCandidates() {
    return [
      { id: 'restart-postgres', capabilityId: 'docker.local', allowedComponents: ['postgres-compose'], parameters: { operation: 'compose_restart', resource: 'postgres' }, blastRadius: 2 },
      { id: 'restart-redis', capabilityId: 'docker.local', allowedComponents: ['redis-compose'], parameters: { operation: 'compose_restart', resource: 'redis' }, blastRadius: 2 },
      { id: 'restart-protohub', capabilityId: 'docker.local', allowedComponents: ['protohub-compose'], parameters: { operation: 'compose_restart', resource: 'protohub-api' }, blastRadius: 2 },
      { id: 'restart-inbucket', capabilityId: 'docker.local', allowedComponents: ['supabase-inbucket-container'], parameters: { operation: 'restart_service', resource: 'supabase_inbucket' }, blastRadius: 1 },
    ];
  }

  async run(task, actor = {}) {
    task.state = task.state || 'PROPOSED';
    this.stateMachine.transition(task, 'VALIDATING');

    const policy = this.policy.evaluate(task, actor);

    if (policy.requiresApproval) {
      this.stateMachine.transition(task, 'AWAITING_APPROVAL');
      this.approvals.request(task, actor.id || 'heidi');
      this.audit.record(this.makeAuditEntry(task, actor, { decision: policy.reason, requiresApproval: true }, null, 'AWAITING_APPROVAL'));
      return { status: 'AWAITING_APPROVAL', taskId: task.id };
    }

    if (!policy.allowed) {
      this.stateMachine.transition(task, 'FAILED');
      this.audit.record(this.makeAuditEntry(task, actor, { decision: policy.reason, approved: false }, null, 'FAILED'));
      throw new Error(`Policy blocked: ${policy.reason}`);
    }

    this.stateMachine.transition(task, 'AUTHORIZED');
    this.stateMachine.transition(task, 'EXECUTING');

    const start = Date.now();
    let execResult;
    try {
      execResult = await this.executor.execute(task);
    } catch (e) {
      execResult = { success: false, error: e.message, duration: Date.now() - start };
    }

    if (execResult.success) {
      this.stateMachine.transition(task, 'VERIFYING');
      const verified = await this.verify(task, execResult);
      this.stateMachine.transition(task, verified ? 'COMPLETED' : 'FAILED');
      this.audit.record(this.makeAuditEntry(task, actor, { decision: 'auto' }, execResult, task.state));
      return { status: task.state, taskId: task.id, result: execResult, duration: execResult.duration };
    } else {
      this.stateMachine.transition(task, 'RECOVERY');
      try {
        const recovery = await this.recovery.attempt(task);
        this.stateMachine.transition(task, 'COMPLETED');
        this.audit.record(this.makeAuditEntry(task, actor, { decision: 'auto' }, recovery, 'COMPLETED'));
        return { status: 'COMPLETED', taskId: task.id, result: recovery };
      } catch (recoveryError) {
        this.stateMachine.transition(task, 'FAILED');
        this.audit.record(this.makeAuditEntry(task, actor, { decision: 'auto' }, null, 'FAILED', recoveryError.message));
        throw new Error(`Execution failed and recovery exhausted: ${recoveryError.message}`);
      }
    }
  }

  async verify(_task, _result) {
    return true;
  }

  approve(taskId, approver) {
    const approval = this.approvals.approve(taskId, approver);
    return approval;
  }

  executeApproved(task, actor = {}) {
    if (!this.approvals.isApproved(task.id)) {
      throw new Error(`Task ${task.id} is not approved`);
    }
    const reset = { ...task, approval: true, state: 'PROPOSED' };
    return this.run(reset, actor);
  }

  async operationalCycle(mode = 'DECISION_ONLY', options = {}) {
    const cycleId = options.cycleId || `cycle-${Date.now()}`;
    const start = Date.now();

    const probes = await this.runtimeObserver.inspectAll();
    const normalized = this.observationAdapter.normalize(probes);
    this.decisionEngine.setDependencyGraph(normalized.dependencyGraph);
    this.decisionEngine.impact = new ImpactAssessor({
      dependencyGraph: normalized.dependencyGraph,
      critical: Array.from(normalized.critical || []),
      userFacing: Array.from(normalized.userFacing || []),
      dataIntegrity: Array.from(normalized.dataIntegrity || []),
    });

    const { correlated, decisions, escalation, state } = await this.decisionEngine.decide(
      normalized.observations,
      this.candidates,
      { execute: false, missionId: cycleId }
    );

    for (const d of decisions) {
      if (d.selected_action && (mode === 'CONTROLLED' || mode === 'AUTONOMY')) {
        const auth = this.decisionEngine.policy.canExecute(d.selected_action.capabilityId);
        if (!auth.ok) {
          d.authorization_result = 'ESCALATE';
          d.execution_result = { status: 'ESCALATE', reason: auth.reason };
          d.verification_result = false;
          continue;
        }

        const task = {
          id: `${cycleId}-${d.incident_id}`,
          capabilityId: d.selected_action.capabilityId,
          target: d.incident_id,
          parameters: { ...d.selected_action.parameters, ...(d.selected_action.parameters || {}) },
          state: 'PROPOSED',
        };

        try {
          const result = await this.run(task, { id: 'heidi' });
          d.execution_result = result;
          d.verification_result = result.status === 'COMPLETED';
          this.incidentStore.append({
            incident_id: `${cycleId}-${d.incident_id}`,
            component: d.incident_id,
            failure_class: d.classification && d.classification.failure_class,
            action: d.selected_action,
            result: result.status,
            recovery_time: Date.now() - start,
            final_state: d.verification_result ? 'RECOVERED' : 'RECOVERY_FAILED',
          });
        } catch (e) {
          d.execution_result = { status: 'FAILED', error: e.message };
          d.verification_result = false;
        }
      } else if (d.selected_action && mode === 'SHADOW') {
        d.authorization_result = 'SHADOW';
        d.execution_result = { status: 'SHADOW', reason: 'execution disabled in shadow mode' };
        d.verification_result = null;
      } else {
        d.authorization_result = d.selected_action ? 'DECISION_ONLY' : 'ESCALATE';
      }
    }

    this.audit.record(this.makeAuditEntry(
      { id: cycleId, capabilityId: 'heidi.operational_cycle', target: 'system' },
      { id: 'heidi' },
      { mode },
      { status: 'COMPLETED', decisions: decisions.length, escalation: !!escalation },
      'COMPLETED'
    ));

    return {
      cycleId,
      mode,
      startTime: new Date(start).toISOString(),
      endTime: new Date().toISOString(),
      durationMs: Date.now() - start,
      observations: probes,
      correlated,
      decisions,
      escalation,
      finalState: state,
    };
  }

  makeAuditEntry(task, actor, approvalState, executionResult, resultingState, error = null) {
    return {
      taskId: task.id,
      capabilityId: task.capabilityId,
      actor: actor.id || 'unknown',
      target: task.target,
      inputs: this.secrets.redact(task.parameters || {}),
      approvalState,
      executionResult,
      verificationResult: null,
      duration: executionResult ? executionResult.duration : 0,
      error,
      resultingState,
    };
  }
}

module.exports = { HeidiExecutive };
