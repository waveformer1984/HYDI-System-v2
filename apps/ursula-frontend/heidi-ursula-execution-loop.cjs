#!/usr/bin/env node

/**
 * HEIDI <-> URSULA EXECUTION LOOP
 * 
 * Closed economic control system
 * If money doesn't move or tasks don't complete, the system is lying
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

// HEIDI - INTENT GENERATOR (MONEY HUNTER)
class HeidiIntentGenerator {
  constructor() {
    this.taskCounter = 0;
    this.activeTasks = new Map(); // taskId -> task
    this.maxActiveTasks = 5; // Hard cap to prevent idea addiction
  }

  // Generate revenue-anchored tasks only
  generateTask(concept, estimatedRevenue, actions, completionProof) {
    // Discard if no revenue path
    if (!estimatedRevenue || estimatedRevenue <= 0) {
      console.log(`[HEIDI] Discarded concept: ${concept} (no revenue path)`);
      return null;
    }

    // Check active task limit
    if (this.activeTasks.size >= this.maxActiveTasks) {
      console.log(`[HEIDI] Task generation blocked: ${this.activeTasks.size}/${this.maxActiveTasks} active tasks`);
      return null;
    }

    const task = {
      id: `task_${++this.taskCounter}`,
      title: concept,
      revenueTarget: estimatedRevenue,
      revenueType: estimatedRevenue < 50 ? 'direct' : 'lead',
      requiredActions: actions,
      completionProof: completionProof,
      deadline: Date.now() + (2 * 60 * 60 * 1000), // 2 hours
      priority: estimatedRevenue > 20 ? 'high' : 'medium',
      status: 'pending',
      createdAt: Date.now()
    };

    this.activeTasks.set(task.id, task);
    console.log(`[HEIDI] Generated task: ${task.title} ($${task.revenueTarget})`);
    
    return task;
  }

  // Sample pack generation (real example)
  generateSamplePackTask() {
    return this.generateTask(
      'Create 10-sample teaser pack',
      25, // $25 direct revenue
      [
        'select 10 samples',
        'normalize audio', 
        'export pack',
        'upload to Gumroad',
        'create listing'
      ],
      [
        'download link exists',
        'product page live',
        'payment enabled'
      ]
    );
  }

  // Tutorial generation
  generateTutorialTask() {
    return this.generateTask(
      'Create quick start tutorial',
      15, // $15 direct revenue
      [
        'outline tutorial steps',
        'record walkthrough',
        'edit video',
        'upload to platform',
        'set pricing'
      ],
      [
        'video uploaded',
        'pricing set',
        'payment enabled'
      ]
    );
  }

  // Template generation
  generateTemplateTask() {
    return this.generateTask(
      'Create project template pack',
      35, // $35 direct revenue
      [
        'design template structure',
        'create documentation',
        'package templates',
        'create demo',
        'list for sale'
      ],
      [
        'package downloadable',
        'demo available',
        'payment enabled'
      ]
    );
  }

  // Feedback learning
  processExecutionResult(executionReport) {
    const task = this.activeTasks.get(executionReport.taskId);
    if (!task) return;

    if (executionReport.status === 'success') {
      console.log(`[HEIDI] Task succeeded: ${task.title} - will replicate pattern`);
      // Success: increase scale next time
      task.priority = 'high';
    } else {
      console.log(`[HEIDI] Task failed: ${task.title} - blockers: ${executionReport.blockers.join(', ')}`);
      // Failure: reduce scope next time
      task.priority = 'low';
    }
  }

  getActiveTasks() {
    return Array.from(this.activeTasks.values());
  }
}

// URSULA - REALITY EXECUTOR (COMPLIANCE OFFICER)
class UrsulaRealityExecutor {
  constructor(ledger) {
    this.ledger = ledger;
    this.executionHistory = new Map(); // taskId -> execution record
  }

  // Execute task with strict compliance
  async executeTask(task) {
    console.log(`[URSULA] Executing task: ${task.title}`);
    
    const executionReport = {
      taskId: task.id,
      status: 'in_progress',
      evidence: [],
      revenueCaptured: 0,
      blockers: [],
      timestamp: Date.now()
    };

    try {
      // Validate required actions are possible
      for (const action of task.requiredActions) {
        console.log(`[URSULA] Executing action: ${action}`);
        
        // Simulate action execution
        await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 800));
        
        // Collect evidence
        const evidence = this.executeAction(action);
        executionReport.evidence.push(evidence);
        
        // Random failure simulation (20% chance)
        if (Math.random() < 0.2) {
          throw new Error(`Action failed: ${action}`);
        }
      }

      // Validate completion proof
      const proofValidation = this.validateCompletionProof(task.completionProof, executionReport.evidence);
      
      if (proofValidation.valid) {
        executionReport.status = 'success';
        
        // Trigger revenue capture
        const revenueResult = await this.captureRevenue(task);
        executionReport.revenueCaptured = revenueResult.amount;
        
        console.log(`[URSULA] Task completed: ${task.title} - Revenue captured: $${revenueResult.amount}`);
      } else {
        executionReport.status = 'failed';
        executionReport.blockers = proofValidation.missingProof;
        console.log(`[URSULA] Task failed: ${task.title} - Missing proof: ${proofValidation.missingProof.join(', ')}`);
      }

    } catch (error) {
      executionReport.status = 'failed';
      executionReport.blockers.push(error.message);
      console.log(`[URSULA] Task failed: ${task.title} - ${error.message}`);
    }

    this.executionHistory.set(task.id, executionReport);
    return executionReport;
  }

  executeAction(action) {
    // Simulate action execution with evidence
    return {
      action: action,
      completed: true,
      evidence: `Evidence of ${action} completion`,
      timestamp: Date.now()
    };
  }

  validateCompletionProof(requiredProof, evidence) {
    const missingProof = [];
    
    for (const proof of requiredProof) {
      const hasProof = evidence.some(e => 
        e.evidence.toLowerCase().includes(proof.toLowerCase()) ||
        e.action.toLowerCase().includes(proof.toLowerCase())
      );
      
      if (!hasProof) {
        missingProof.push(proof);
      }
    }

    return {
      valid: missingProof.length === 0,
      missingProof: missingProof
    };
  }

  async captureRevenue(task) {
    // Pre-authorization check
    const authResult = await this.ledger.preAuthorize(task.id, task.revenueTarget);
    
    if (!authResult.authorized) {
      throw new Error(`Pre-authorization failed: ${authResult.reason}`);
    }

    // Capture revenue
    const captureResult = await this.ledger.capture(task.id, task.revenueTarget);
    
    return {
      amount: captureResult.amount,
      transactionId: captureResult.transactionId
    };
  }

  getExecutionReport(taskId) {
    return this.executionHistory.get(taskId);
  }
}

// LEDGER - GROUND TRUTH (SURVIVAL METRIC)
class EconomicLedger {
  constructor() {
    this.entries = new Map(); // entryId -> ledger entry
    this.authorizations = new Map(); // taskId -> authorization
    this.sequence = 0;
  }

  // Pre-authorization (intent to charge)
  async preAuthorize(taskId, amount) {
    const authId = `auth_${++this.sequence}`;
    
    const authorization = {
      id: authId,
      taskId: taskId,
      amount: amount,
      type: 'authorization',
      status: 'authorized',
      timestamp: Date.now(),
      expires: Date.now() + (30 * 60 * 1000) // 30 minutes
    };

    this.authorizations.set(taskId, authorization);
    console.log(`[LEDGER] Pre-authorized: $${amount} for task ${taskId}`);
    
    return { authorized: true, authId: authId };
  }

  // Capture revenue (actual money movement)
  async capture(taskId, amount) {
    const authorization = this.authorizations.get(taskId);
    
    if (!authorization) {
      throw new Error('No authorization found');
    }

    if (authorization.status !== 'authorized') {
      throw new Error('Authorization not valid');
    }

    if (Date.now() > authorization.expires) {
      throw new Error('Authorization expired');
    }

    // Create capture entry
    const captureId = `capture_${++this.sequence}`;
    const capture = {
      id: captureId,
      taskId: taskId,
      type: 'capture',
      amount: amount,
      verified: true,
      timestamp: Date.now(),
      authId: authorization.id
    };

    this.entries.set(captureId, capture);
    
    // Mark authorization as used
    authorization.status = 'captured';
    
    console.log(`[LEDGER] Captured: $${amount} for task ${taskId}`);
    
    return {
      amount: amount,
      transactionId: captureId,
      verified: true
    };
  }

  // Expire authorization (failure path)
  expireAuthorization(taskId) {
    const authorization = this.authorizations.get(taskId);
    if (authorization && authorization.status === 'authorized') {
      authorization.status = 'expired';
      console.log(`[LEDGER] Expired authorization for task ${taskId}`);
    }
  }

  // Get ledger entries for task
  getTaskEntries(taskId) {
    return Array.from(this.entries.values()).filter(entry => entry.taskId === taskId);
  }

  // Get total revenue
  getTotalRevenue() {
    return Array.from(this.entries.values())
      .filter(entry => entry.type === 'capture' && entry.verified)
      .reduce((sum, entry) => sum + entry.amount, 0);
  }

  // Get metrics
  getMetrics() {
    const totalAuthorizations = this.authorizations.size;
    const totalCaptures = this.entries.size;
    const totalRevenue = this.getTotalRevenue();
    
    return {
      totalAuthorizations,
      totalCaptures,
      totalRevenue,
      captureRate: totalAuthorizations > 0 ? totalCaptures / totalAuthorizations : 0
    };
  }
}

// MAIN EXECUTION LOOP
class HeidiUrsulaLoop extends EventEmitter {
  constructor() {
    super();
    this.heidi = new HeidiIntentGenerator();
    this.ursula = new UrsulaRealityExecutor(new EconomicLedger());
    this.loopMetrics = {
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      totalRevenue: 0,
      loopCount: 0
    };
  }

  // Run minimum viable loop
  async runLoop() {
    console.log('=== HEIDI-URSULA EXECUTION LOOP ===\n');
    
    // Step 1: Heidi generates 3 tasks only
    console.log('Step 1: Heidi generating tasks...\n');
    const tasks = [
      this.heidi.generateSamplePackTask(),
      this.heidi.generateTutorialTask(),
      this.heidi.generateTemplateTask()
    ].filter(task => task !== null); // Filter out null tasks

    this.loopMetrics.totalTasks = tasks.length;
    console.log(`Generated ${tasks.length} tasks\n`);

    // Step 2: Ursula executes immediately
    console.log('Step 2: Ursula executing tasks...\n');
    const executionResults = [];
    
    for (const task of tasks) {
      try {
        const result = await this.ursula.executeTask(task);
        executionResults.push(result);
        
        if (result.status === 'success') {
          this.loopMetrics.successfulTasks++;
          this.loopMetrics.totalRevenue += result.revenueCaptured;
        } else {
          this.loopMetrics.failedTasks++;
        }
        
        // Feed back to Heidi
        this.heidi.processExecutionResult(result);
        
      } catch (error) {
        console.log(`[LOOP] Execution error: ${error.message}`);
        this.loopMetrics.failedTasks++;
      }
    }

    // Step 3: Review after execution
    console.log('\nStep 3: Execution Review\n');
    this.reviewExecution(executionResults);

    // Step 4: Show final metrics
    console.log('\n=== FINAL LOOP METRICS ===\n');
    this.showMetrics();
  }

  reviewExecution(executionResults) {
    for (const result of executionResults) {
      console.log(`Task ${result.taskId}: ${result.status.toUpperCase()}`);
      
      if (result.status === 'success') {
        console.log(`  Revenue captured: $${result.revenueCaptured}`);
        console.log(`  Evidence: ${result.evidence.length} items`);
      } else {
        console.log(`  Blockers: ${result.blockers.join(', ')}`);
      }
      
      // Show ledger entries
      const ledgerEntries = this.ursula.ledger.getTaskEntries(result.taskId);
      console.log(`  Ledger entries: ${ledgerEntries.length}`);
      
      console.log();
    }
  }

  showMetrics() {
    const ledgerMetrics = this.ursula.ledger.getMetrics();
    
    console.log('Loop Performance:');
    console.log(`  Total tasks: ${this.loopMetrics.totalTasks}`);
    console.log(`  Successful: ${this.loopMetrics.successfulTasks}`);
    console.log(`  Failed: ${this.loopMetrics.failedTasks}`);
    console.log(`  Success rate: ${(this.loopMetrics.successfulTasks / this.loopMetrics.totalTasks * 100).toFixed(1)}%`);
    console.log();
    
    console.log('Financial Performance:');
    console.log(`  Total revenue: $${this.loopMetrics.totalRevenue.toFixed(2)}`);
    console.log(`  Revenue per task: $${(this.loopMetrics.totalRevenue / this.loopMetrics.totalTasks).toFixed(2)}`);
    console.log();
    
    console.log('Ledger Performance:');
    console.log(`  Authorizations: ${ledgerMetrics.totalAuthorizations}`);
    console.log(`  Captures: ${ledgerMetrics.totalCaptures}`);
    console.log(`  Capture rate: ${(ledgerMetrics.captureRate * 100).toFixed(1)}%`);
    console.log();
    
    console.log('Heidi Learning:');
    const activeTasks = this.heidi.getActiveTasks();
    const highPriorityTasks = activeTasks.filter(t => t.priority === 'high').length;
    console.log(`  Active tasks: ${activeTasks.length}`);
    console.log(`  High priority tasks: ${highPriorityTasks}`);
  }
}

// DEMONSTRATION
async function demonstrateExecutionLoop() {
  const loop = new HeidiUrsulaLoop();
  
  // Run the minimum viable loop
  await loop.runLoop();
}

// Run demonstration
if (require.main === module) {
  demonstrateExecutionLoop().catch(console.error);
}

module.exports = { HeidiUrsulaLoop, HeidiIntentGenerator, UrsulaRealityExecutor, EconomicLedger };
