/**
 * HYDI Workflow Orchestrator
 *
 * The Event System handles messages.
 * The Workflow Orchestrator turns events into multi-agent pipelines:
 *
 *   EVENT -> Workflow Definition -> Multiple Agents -> Approval -> Completion
 *
 * Example:
 *   "Grant Opportunity Found"
 *     -> Funding Agent -> Finance Agent -> Document Agent -> Approval -> Submission
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class WorkflowOrchestrator extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      maxConcurrentWorkflows: 20,
      defaultTimeout: 300000,      // 5 minutes default
      approvalTimeout: 86400000,   // 24 hours for human approval
      retryFailedSteps: true,
      ...config
    };

    this.registry = null;
    this.eventSystem = null;
    this.heidi = null;            // HeidiExecutiveOrchestrator

    this.workflows = new Map();   // workflowId -> workflow instance
    this.definitions = new Map(); // definitionName -> definition template
    this.activeCount = 0;
    this.history = [];

    this.initializeDefaultDefinitions();

    console.log('[WORKFLOW ORCHESTRATOR] Initialized');
  }

  setRegistry(registry) {
    this.registry = registry;
  }

  setEventSystem(eventSystem) {
    this.eventSystem = eventSystem;
  }

  setHeidi(heidi) {
    this.heidi = heidi;
  }

  setStateManager(stateManager) {
    this.stateManager = stateManager;
  }

  async persist(instance) {
    if (this.stateManager) {
      await this.stateManager.persistWorkflow(instance);
    }
  }

  async persistApproval(approval) {
    if (this.stateManager) {
      await this.stateManager.persistApproval(approval);
    }
  }

  /**
   * Define built-in workflow templates
   */
  initializeDefaultDefinitions() {
    this.registerDefinition('grant_application', {
      name: 'Grant Application Pipeline',
      description: 'End-to-end grant opportunity processing',
      steps: [
        { id: 'discover', agent: 'funding_agent', action: 'validate_opportunity', timeout: 60000 },
        { id: 'budget', agent: 'finance_agent', action: 'create_budget', dependsOn: ['discover'], timeout: 120000 },
        { id: 'documents', agent: 'workflow_agent', action: 'assemble_documents', dependsOn: ['budget'], timeout: 300000 },
        { id: 'review', type: 'approval', approvers: ['heidi_executive'], dependsOn: ['documents'], timeout: 86400000 },
        { id: 'submit', agent: 'funding_agent', action: 'submit_application', dependsOn: ['review'], timeout: 120000 }
      ]
    });

    this.registerDefinition('revenue_pipeline', {
      name: 'Revenue Opportunity Pipeline',
      description: 'Qualify and process revenue opportunities',
      steps: [
        { id: 'qualify', agent: 'revenue_agent', action: 'qualify_lead', timeout: 60000 },
        { id: 'pricing', agent: 'finance_agent', action: 'generate_pricing', dependsOn: ['qualify'], timeout: 120000 },
        { id: 'proposal', agent: 'outreach_agent', action: 'generate_proposal', dependsOn: ['pricing'], timeout: 300000 },
        { id: 'approval', type: 'approval', approvers: ['heidi_executive'], dependsOn: ['proposal'], timeout: 86400000 },
        { id: 'close', agent: 'revenue_agent', action: 'close_deal', dependsOn: ['approval'], timeout: 120000 }
      ]
    });

    this.registerDefinition('infrastructure_alert', {
      name: 'Infrastructure Alert Response',
      description: 'Handle infrastructure alerts automatically',
      steps: [
        { id: 'diagnose', agent: 'facility_agent', action: 'diagnose_alert', timeout: 30000 },
        { id: 'remediate', agent: 'workflow_agent', action: 'execute_remediation', dependsOn: ['diagnose'], timeout: 300000 },
        { id: 'verify', agent: 'facility_agent', action: 'verify_resolution', dependsOn: ['remediate'], timeout: 60000 }
      ],
      autoApproval: true
    });

    this.registerDefinition('security_incident', {
      name: 'Security Incident Response',
      description: 'Respond to security alerts',
      steps: [
        { id: 'assess', agent: 'security_agent', action: 'assess_threat', timeout: 30000 },
        { id: 'contain', agent: 'security_agent', action: 'contain_threat', dependsOn: ['assess'], timeout: 120000 },
        { id: 'eradicate', agent: 'security_agent', action: 'eradicate_threat', dependsOn: ['contain'], timeout: 300000 },
        { id: 'recovery', agent: 'workflow_agent', action: 'restore_service', dependsOn: ['eradicate'], timeout: 300000 },
        { id: 'lessons', agent: 'security_agent', action: 'document_lessons', dependsOn: ['recovery'], timeout: 300000 }
      ]
    });
  }

  /**
   * Register a workflow definition template
   */
  registerDefinition(name, definition) {
    this.definitions.set(name, {
      name: definition.name || name,
      description: definition.description || '',
      steps: definition.steps || [],
      autoApproval: definition.autoApproval || false
    });
    console.log(`[WORKFLOW ORCHESTRATOR] Registered definition: ${name}`);
  }

  /**
   * Start a workflow instance from a definition
   */
  startWorkflow(definitionName, payload = {}, options = {}) {
    const definition = this.definitions.get(definitionName);
    if (!definition) {
      throw new Error(`Workflow definition not found: ${definitionName}`);
    }

    if (this.activeCount >= this.config.maxConcurrentWorkflows) {
      throw new Error('Max concurrent workflows reached');
    }

    const workflowId = `wf_${uuidv4()}`;

    const instance = {
      id: workflowId,
      definition: definitionName,
      name: definition.name,
      status: 'running',
      createdAt: Date.now(),
      payload,
      steps: definition.steps.map(s => ({
        ...s,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        result: null,
        error: null
      })),
      currentStepIndex: 0,
      autoApproval: options.autoApproval !== undefined ? options.autoApproval : definition.autoApproval
    };

    this.workflows.set(workflowId, instance);
    this.activeCount++;

    this.emit('workflow_started', { workflowId, definition: definitionName });
    this.publishEvent('workflow_started', { workflowId, definition: definitionName, payload });

    // Persist immediately on creation
    this.persist(instance);

    // Begin execution
    this.executeWorkflow(workflowId).catch(err => {
      console.error(`[WORKFLOW ORCHESTRATOR] Workflow ${workflowId} crashed:`, err.message);
      this.failWorkflow(workflowId, err.message);
    });

    return workflowId;
  }

  /**
   * Execute a workflow instance step by step
   */
  async executeWorkflow(workflowId) {
    const instance = this.workflows.get(workflowId);
    if (!instance) return;

    while (instance.status === 'running' && instance.currentStepIndex < instance.steps.length) {
      const step = instance.steps[instance.currentStepIndex];

      // Check dependencies
      if (step.dependsOn && step.dependsOn.length > 0) {
        const depsReady = step.dependsOn.every(depId => {
          const depStep = instance.steps.find(s => s.id === depId);
          return depStep && depStep.status === 'completed';
        });

        if (!depsReady) {
          // Dependencies not met yet — wait
          await this.sleep(1000);
          continue;
        }
      }

      // Execute the step
      await this.executeStep(workflowId, step);

      if (instance.status === 'failed') {
        break;
      }

      instance.currentStepIndex++;
    }

    if (instance.status === 'running') {
      this.completeWorkflow(workflowId);
    }
  }

  /**
   * Execute a single workflow step
   */
  async executeStep(workflowId, step) {
    const instance = this.workflows.get(workflowId);
    if (!instance || instance.status !== 'running') return;

    step.status = 'running';
    step.startedAt = Date.now();

    this.emit('step_started', { workflowId, stepId: step.id, agent: step.agent });

    try {
      let result;

      if (step.type === 'approval') {
        result = await this.executeApprovalStep(workflowId, step);
      } else {
        result = await this.executeAgentStep(workflowId, step);
      }

      step.status = 'completed';
      step.completedAt = Date.now();
      step.result = result;
      await this.persist(instance);

      this.emit('step_completed', { workflowId, stepId: step.id, result });
      this.publishEvent('workflow_step_completed', { workflowId, stepId: step.id, result });

    } catch (error) {
      step.status = 'failed';
      step.error = error.message;
      step.completedAt = Date.now();
      await this.persist(instance);

      this.emit('step_failed', { workflowId, stepId: step.id, error: error.message });
      this.publishEvent('workflow_step_failed', { workflowId, stepId: step.id, error: error.message });

      if (!this.config.retryFailedSteps) {
        await this.failWorkflow(workflowId, error.message);
      } else {
        // Simple retry once
        console.log(`[WORKFLOW ORCHESTRATOR] Retrying step ${step.id} in workflow ${workflowId}`);
        await this.sleep(5000);
        step.status = 'pending';
        step.error = null;
        // Don't increment currentStepIndex; the loop will retry
        instance.currentStepIndex--; // Hack: loop will increment back
      }
    }
  }

  /**
   * Execute an agent step via Heidi / Event System
   */
  async executeAgentStep(workflowId, step) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Step ${step.id} timed out after ${step.timeout || this.config.defaultTimeout}ms`));
      }, step.timeout || this.config.defaultTimeout);

      // Try Heidi first
      if (this.heidi && this.heidi.submitTask) {
        this.heidi.submitTask({
          type: step.action,
          payload: { workflowId, stepId: step.id, ...this.workflows.get(workflowId).payload },
          agentId: step.agent,
          priority: 'HIGH'
        }).then(taskId => {
          clearTimeout(timeout);

          // Listen for task completion via event system
          const onComplete = (data) => {
            if (data.taskId === taskId) {
              clearTimeout(timeout);
              if (this.eventSystem) {
                this.eventSystem.off('task_completed', onComplete);
              }
              resolve(data.result);
            }
          };

          if (this.eventSystem) {
            this.eventSystem.on('task_completed', onComplete);
          } else {
            // Fallback: resolve immediately if no event system
            resolve({ taskId, status: 'submitted' });
          }
        }).catch(reject);
      } else {
        // No Heidi — simulate step execution
        clearTimeout(timeout);
        resolve({ simulated: true, step: step.id, agent: step.agent, action: step.action });
      }
    });
  }

  /**
   * Execute an approval step
   */
  async executeApprovalStep(workflowId, step) {
    const instance = this.workflows.get(workflowId);

    if (instance.autoApproval) {
      console.log(`[WORKFLOW ORCHESTRATOR] Auto-approving step ${step.id} in ${workflowId}`);
      return { approved: true, auto: true };
    }

    // Emit approval request
    const approvalRequest = {
      workflowId,
      stepId: step.id,
      approvers: step.approvers || ['heidi_executive'],
      requestedAt: Date.now(),
      timeout: step.timeout || this.config.approvalTimeout
    };

    this.emit('approval_requested', approvalRequest);
    this.publishEvent('workflow_approval_requested', approvalRequest);

    // Wait for approval (simplified: auto-resolve after timeout for now)
    return new Promise((resolve, reject) => {
      const timeoutMs = step.timeout || this.config.approvalTimeout;

      const timer = setTimeout(() => {
        reject(new Error(`Approval step ${step.id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      // Listen for approval response
      const onResponse = (data) => {
        if (data.workflowId === workflowId && data.stepId === step.id) {
          clearTimeout(timer);
          this.off('approval_response', onResponse);

          if (data.approved) {
            resolve({ approved: true, by: data.approver });
          } else {
            reject(new Error(`Approval denied for step ${step.id}`));
          }
        }
      };

      this.on('approval_response', onResponse);
    });
  }

  /**
   * Handle an external approval response
   */
  handleApprovalResponse(workflowId, stepId, approved, approver) {
    this.emit('approval_response', { workflowId, stepId, approved, approver });
  }

  /**
   * Complete a workflow successfully
   */
  async completeWorkflow(workflowId) {
    const instance = this.workflows.get(workflowId);
    if (!instance) return;

    instance.status = 'completed';
    instance.completedAt = Date.now();
    this.activeCount--;
    await this.persist(instance);

    this.history.push({
      id: workflowId,
      status: 'completed',
      definition: instance.definition,
      duration: instance.completedAt - instance.createdAt,
      completedAt: instance.completedAt
    });

    this.emit('workflow_completed', { workflowId, instance });
    this.publishEvent('workflow_completed', { workflowId, definition: instance.definition, duration: instance.completedAt - instance.createdAt });

    console.log(`[WORKFLOW ORCHESTRATOR] Workflow completed: ${workflowId}`);
  }

  /**
   * Fail a workflow
   */
  async failWorkflow(workflowId, reason) {
    const instance = this.workflows.get(workflowId);
    if (!instance) return;

    instance.status = 'failed';
    instance.error = reason;
    instance.completedAt = Date.now();
    this.activeCount--;
    await this.persist(instance);

    this.history.push({
      id: workflowId,
      status: 'failed',
      definition: instance.definition,
      reason,
      completedAt: instance.completedAt
    });

    this.emit('workflow_failed', { workflowId, reason, instance });
    this.publishEvent('workflow_failed', { workflowId, definition: instance.definition, reason });

    console.error(`[WORKFLOW ORCHESTRATOR] Workflow failed: ${workflowId} (${reason})`);
  }

  /**
   * Cancel a running workflow
   */
  async cancelWorkflow(workflowId, reason = 'cancelled') {
    const instance = this.workflows.get(workflowId);
    if (!instance || instance.status !== 'running') return false;

    instance.status = 'cancelled';
    instance.error = reason;
    instance.completedAt = Date.now();
    await this.persist(instance);
    this.activeCount--;

    this.emit('workflow_cancelled', { workflowId, reason });
    this.publishEvent('workflow_cancelled', { workflowId, reason });

    return true;
  }

  /**
   * Get workflow status
   */
  getWorkflowStatus(workflowId) {
    const instance = this.workflows.get(workflowId);
    if (!instance) return null;

    return {
      id: instance.id,
      name: instance.name,
      definition: instance.definition,
      status: instance.status,
      createdAt: instance.createdAt,
      completedAt: instance.completedAt,
      currentStep: instance.currentStepIndex < instance.steps.length
        ? instance.steps[instance.currentStepIndex].id
        : null,
      steps: instance.steps.map(s => ({
        id: s.id,
        status: s.status,
        agent: s.agent,
        action: s.action,
        type: s.type,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        error: s.error
      }))
    };
  }

  /**
   * List active and recent workflows
   */
  listWorkflows(options = {}) {
    const includeHistory = options.includeHistory !== false;
    const active = Array.from(this.workflows.values())
      .filter(w => w.status === 'running')
      .map(w => this.getWorkflowStatus(w.id));

    if (!includeHistory) return { active, history: [] };

    return {
      active,
      history: this.history.slice(-(options.limit || 50)),
      definitions: Array.from(this.definitions.keys())
    };
  }

  /**
   * Publish event to event system if available
   */
  publishEvent(topic, payload) {
    if (this.eventSystem && this.eventSystem.publishSystemEvent) {
      this.eventSystem.publishSystemEvent(topic, payload, { priority: 'medium' });
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear all workflow state, release event listeners, and reset activity.
   */
  destroy() {
    this.workflows.clear();
    this.definitions.clear();
    this.history = [];
    this.activeCount = 0;
    this.registry = null;
    this.eventSystem = null;
    this.heidi = null;
    this.stateManager = null;
    this.removeAllListeners();
  }
}

module.exports = WorkflowOrchestrator;
