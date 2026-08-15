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
    this.health = new HealthAggregator();
    this.planner = new MissionPlanner(this.registry);
    this.recovery = new RecoveryEngine(this.executor, this.registry);
    this.dryRun = new DryRunExecutor(this.registry);
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
