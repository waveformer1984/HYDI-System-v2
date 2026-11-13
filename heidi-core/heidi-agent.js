#!/usr/bin/env node
/**
 * HEIDI Persistent Agent
 *
 * Runs on Frank as a long-lived process that:
 * 1. Claims an operational lease
 * 2. Polls agent_bus for pending tasks
 * 3. Executes decisions within bounds (or advisory mode: recommends for approval)
 * 4. Reflects on outcomes and learns
 * 5. Monitors system drift
 *
 * Phase 2A: Persistent orchestration + Advisory Mode
 */

// Load ONLY .env.local for development
const dotenv = require('dotenv');
const fs = require('fs');
const envPath = '.env.local';
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const parsed = dotenv.parse(envContent);
  Object.assign(process.env, parsed);
  console.log('[HEIDI-AGENT] Loaded configuration from .env.local');
}

const http = require('http');
const { createClient } = require('@supabase/supabase-js');
const HeidiGoalEngine = require('../evolution/heidi-goals');
const GoalExecutor = require('../evolution/goal-executor');
const ActionExecutor = require('./actions/action-executor');
const { adviseProposal } = require('../lib/governance/action-advisor');
const {
  checkAdvisoryAuth,
  allowedCorsOrigin,
  bindHost,
  authorizeHumanApproval,
} = require('../lib/governance/advisory-auth');

/** Strip CR/LF and other control characters so request-derived values can't forge log lines. */
function logSafe(value) {
  return String(value)
    .replace(/[\r\n]+/g, ' ') // explicit CR/LF so static analysis recognises the sanitiser
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, 200);
}

class HeidiAgent {
  constructor(config = {}) {
    this.name = 'frank-heidi-agent';
    this.leaseHolder = 'frank';
    this.leaseTTL = 120; // seconds
    this.leaseRenewalInterval = 90; // renew every 90s
    this.taskPollInterval = 30000; // poll every 30s
    this.reflectionInterval = 3600000; // reflect every hour
    this.decisionBounds = null;

    // Supabase client
    this.supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    // State tracking
    this.isRunning = false;
    this.leaseClaimed = false;
    this.stats = {
      startTime: Date.now(),
      tasksProcessed: 0,
      tasksApproved: 0,
      tasksBlocked: 0,
      tasksReviewed: 0,
      reflectionsCycled: 0
    };

    // Task event loop
    this.leaseTimer = null;
    this.pollTimer = null;
    this.reflectionTimer = null;

    // Advisory mode (HTTP server for user approvals)
    this.advisoryMode = process.env.HEIDI_ADVISORY_MODE === 'true';
    this.httpServer = null;

    // Goal execution system
    this.goalEngine = null;
    this.goalExecutor = null;
    this.goalExecutionInterval = 60000; // check for goals every minute
    this.goalTimer = null;
  }

  /**
   * Claim or renew operational lease
   * Returns true if lease is held, false if someone else has it
   */
  async claimLease() {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.leaseTTL * 1000);

      // Check current lease status
      const { data: current, error: checkError } = await this.supabase
        .from('heidi_decision_bounds')
        .select('id, lease_holder, lease_expires')
        .single();

      if (checkError) {
        console.error('[HEIDI-AGENT] Lease check error:', checkError.message);
        return false;
      }

      // Claim if no holder, lease expired, or we already hold it (renewal)
      const isLeaseAvailable = !current.lease_holder ||
        current.lease_holder === this.leaseHolder ||
        new Date(current.lease_expires) < now;

      if (!isLeaseAvailable) {
        console.log(`[HEIDI-AGENT] ⚠️ Lease held by ${current.lease_holder} until ${current.lease_expires}`);
        this.leaseClaimed = false;
        return false;
      }

      // Try to claim the lease
      const { error: updateError } = await this.supabase
        .from('heidi_decision_bounds')
        .update({
          lease_holder: this.leaseHolder,
          lease_expires: expiresAt.toISOString()
        })
        .eq('id', current.id);

      if (updateError) {
        console.error('[HEIDI-AGENT] Lease claim error:', updateError.message);
        return false;
      }

      this.leaseClaimed = true;
      console.log(`[HEIDI-AGENT] ✅ Lease claimed (expires: ${expiresAt.toISOString()})`);
      return true;
    } catch (error) {
      console.error('[HEIDI-AGENT] Lease claim failed:', error.message);
      this.leaseClaimed = false;
      return false;
    }
  }

  /**
   * Load decision bounds (AUTO-APPROVE threshold, BLOCK criteria, etc)
   */
  async loadDecisionBounds() {
    try {
      const { data, error } = await this.supabase
        .from('heidi_decision_bounds')
        .select('*')
        .single();

      if (error) {
        console.error('[HEIDI-AGENT] Bounds load error:', error.message);
        return false;
      }

      this.decisionBounds = data;
      console.log(`[HEIDI-AGENT] Decision bounds loaded: confidence_threshold=${data.auto_approve_threshold}`);
      return true;
    } catch (error) {
      console.error('[HEIDI-AGENT] Bounds loading failed:', error.message);
      return false;
    }
  }

  /**
   * Poll agent_bus for pending tasks
   * Return all tasks with status='pending'
   */
  async pollTasks() {
    try {
      const { data, error } = await this.supabase
        .from('agent_bus')
        .select('*')
        .eq('status', 'pending')
        .order('priority', { ascending: false })
        .limit(10);

      if (error) {
        console.error('[HEIDI-AGENT] Task poll error:', error.message);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[HEIDI-AGENT] Task polling failed:', error.message);
      return [];
    }
  }

  /**
   * Retrieve relevant procedural memory facts for a task
   */
  async retrieveRelevantFacts(task) {
    try {
      // Build a search query from task payload
      const taskDescription = JSON.stringify(task.payload).substring(0, 200);
      const divisionPrefix = `${task.division || 'general'} ${task.type || ''}`;
      const searchQuery = `${divisionPrefix} ${taskDescription}`.substring(0, 300);

      // Query procedural memory by division and confidence
      const { data, error } = await this.supabase
        .from('hydi_facts')
        .select('id, content, confidence, division')
        .eq('division', task.division || 'general')
        .order('confidence', { ascending: false })
        .limit(3);

      if (error || !data) {
        return [];
      }

      return data;
    } catch (error) {
      console.warn('[HEIDI-AGENT] Fact retrieval failed:', error.message);
      return [];
    }
  }

  /**
   * Kill switch (Phase 4): env HEIDI_PAUSE always wins; a `paused` flag on
   * the heidi_decision_bounds row is honored when present (forward-compatible
   * with a future migration — absent column simply reads undefined).
   */
  isPaused() {
    if (process.env.HEIDI_PAUSE === 'true' || process.env.HEIDI_PAUSE === '1') return true;
    const b = this.decisionBounds;
    return !!(b && (b.paused === true || b.paused === 'true' || b.paused === 1 || b.paused === '1'));
  }

  /**
   * Make a decision on a task
   * Returns: { verdict: 'AUTO-APPROVE' | 'REVIEW' | 'BLOCK', reason: string, memory_ids: UUID[] }
   */
  async makeDecision(task) {
    try {
      // Retrieve relevant procedural memory (evidence for the audit trail;
      // confidence is evaluated on the ORIGINAL task value, never boosted).
      const relevantFacts = await this.retrieveRelevantFacts(task);
      const memoryIds = relevantFacts.map(f => f.id);

      let memoryReasoning = '';
      if (relevantFacts.length > 0) {
        const avgFactConfidence = relevantFacts.reduce((sum, f) => sum + (f.confidence || 0), 0) / relevantFacts.length;
        memoryReasoning = ` (verified against ${relevantFacts.length} facts, avg ${(avgFactConfidence * 100).toFixed(0)}% confident)`;
      }

      // Contract-layer triple gate (Phase 2): proposal is recorded in
      // heidi_events, the local advisor (qwen2.5:3b) returns a verdict +
      // confidence, and the decision-bounds row is enforced server-side.
      // Fail-closed: advisor timeout/malformed output/missing bounds can
      // only produce REVIEW/BLOCK — never AUTO-APPROVE.
      const gate = await adviseProposal({
        proposal: {
          id: task.id,
          type: task.type,
          division: task.division,
          payload: task.payload,
          proposer: 'agent_bus',
        },
        bounds: this.decisionBounds,
        execEnabled: process.env.HEIDI_ALLOW_EXEC,
        paused: this.isPaused(),
        supabase: this.supabase,
      });

      const verdict = gate.verdict === 'AUTO-APPROVE' && gate.outcome === 'blocked'
        ? 'REVIEW' // model approved but a non-env gate refused — human decides
        : gate.verdict;

      return {
        verdict,
        execEnabled: gate.execEnabled === true,
        outcome: gate.outcome,
        confidence: gate.confidence,
        reason: `${gate.gates.advisor.reason || gate.gates.bounds.reason || 'gate decision'} [advisor:${gate.gates.advisor.status} bounds:${gate.gates.bounds.pass ? 'pass' : 'fail'}]`,
        memory_ids: memoryIds,
      };
    } catch (error) {
      console.error('[HEIDI-AGENT] Decision failed:', error.message);
      return { verdict: 'REVIEW', reason: 'Decision engine error', memory_ids: [] };
    }
  }

  /**
   * Execute a task (if verdict is AUTO-APPROVE)
   */
  async executeTask(task, decision) {
    try {
      // Exec stays closed unless HEIDI_ALLOW_EXEC=true AND the gate outcome
      // is 'authorized'. 'would have executed' is evidence, not a run.
      if (decision.verdict !== 'AUTO-APPROVE' || decision.execEnabled !== true || decision.outcome !== 'authorized') {
        const note = decision.outcome === 'would have executed'
          ? 'would have executed (HEIDI_ALLOW_EXEC off)'
          : decision.verdict;
        await this.logEvent(task, note, decision.reason, decision.memory_ids);
        // Mark the task as resolved so the poller doesn't keep reprocessing it
        await this.supabase
          .from('agent_bus')
          .update({ status: decision.verdict === 'AUTO-APPROVE' ? 'would_have_executed' : decision.verdict.toLowerCase() })
          .eq('id', task.id);
        return { success: true, executed: false, verdict: decision.verdict, outcome: decision.outcome };
      }

      console.log(`[HEIDI-AGENT] Executing task: ${task.id}`);

      // Update task status to executing
      await this.supabase
        .from('agent_bus')
        .update({ status: 'executing' })
        .eq('id', task.id);

      // Execute task (payload contains the action)
      let result = { success: false };
      try {
        // Simulate task execution based on type
        if (task.type === 'financial_approval') {
          result = await this.executeFinancialTask(task);
        } else if (task.type === 'operational_decision') {
          result = await this.executeOperationalTask(task);
        } else {
          result = { success: false, error: 'Unknown task type' };
        }
      } catch (error) {
        result = { success: false, error: error.message };
      }

      // Update task status
      const finalStatus = result.success ? 'completed' : 'failed';
      await this.supabase
        .from('agent_bus')
        .update({ status: finalStatus, result })
        .eq('id', task.id);

      // Log the event with memory traceability
      await this.logEvent(task, 'AUTO-APPROVE', `Executed: ${result.success ? 'success' : 'failed'}`, decision.memory_ids);

      this.stats.tasksApproved++;
      return { success: true, executed: true, verdict: 'AUTO-APPROVE', result };
    } catch (error) {
      console.error('[HEIDI-AGENT] Execution failed:', error.message);
      return { success: false, executed: false, error: error.message };
    }
  }

  /**
   * Placeholder for financial task execution
   */
  async executeFinancialTask(task) {
    // In production: call payment APIs, update ledgers, etc.
    console.log(`[HEIDI-AGENT] Financial task: ${task.payload.type}`);
    return { success: true, executed_at: new Date().toISOString() };
  }

  /**
   * Placeholder for operational task execution
   */
  async executeOperationalTask(task) {
    // In production: trigger workflows, send notifications, etc.
    console.log(`[HEIDI-AGENT] Operational task: ${task.payload.action}`);
    return { success: true, executed_at: new Date().toISOString() };
  }

  /**
   * Log decision event to heidi_events
   */
  async logEvent(task, verdict, reason, memoryIds = []) {
    try {
      const { error } = await this.supabase
        .from('heidi_events')
        .insert({
          event_type: 'decision',
          division: task.division,
          payload: task.payload,
          verdict,
          context_snapshot: {
            task_id: task.id,
            reason,
            lease_holder: this.leaseHolder,
            task_confidence: task.confidence
          },
          memory_ids: memoryIds
        });

      if (error) {
        console.error('[HEIDI-AGENT] Event log error:', error.message);
      }
    } catch (error) {
      console.error('[HEIDI-AGENT] Event logging failed:', error.message);
    }
  }

  /**
   * FEEDBACK LOOP: Process human approval/rejection to update confidence
   * Called when a task receives human feedback (approved, rejected, needs changes)
   */
  async processFeedback(eventId, feedback) {
    try {
      const { approval, outcome, notes } = feedback;
      // approval: 'approved' | 'rejected' | 'needs-changes'
      // outcome: boolean (was the decision correct?)

      // Fetch the event that received feedback
      const { data: event, error: eventError } = await this.supabase
        .from('heidi_events')
        .select('*')
        .eq('id', eventId)
        .single();

      if (eventError || !event) {
        console.error('[HEIDI-AGENT] Feedback event not found');
        return;
      }

      // Update confidence for each memory fact that influenced this decision
      if (event.memory_ids && event.memory_ids.length > 0) {
        for (const memId of event.memory_ids) {
          await this.updateFactConfidence(memId, outcome);
        }
      }

      // Log the feedback for auditing
      const { error: feedbackError } = await this.supabase
        .from('heidi_feedback')
        .insert({
          event_id: eventId,
          approval,
          outcome,
          notes,
          division: event.division
        });

      if (feedbackError) {
        console.warn('[HEIDI-AGENT] Feedback log error:', feedbackError.message);
      }

      console.log(`[HEIDI-AGENT] Feedback processed: event ${eventId} → ${approval} (outcome: ${outcome})`);
    } catch (error) {
      console.error('[HEIDI-AGENT] Feedback processing failed:', error.message);
    }
  }

  /**
   * Update a procedural fact's confidence based on decision outcome
   * Successful decisions → +2% confidence (cap 0.97)
   * Failed decisions → -3% confidence (floor 0.50)
   */
  async updateFactConfidence(factId, wasSuccessful) {
    try {
      // Fetch current confidence
      const { data: fact, error: fetchError } = await this.supabase
        .from('hydi_facts')
        .select('id, confidence, updates_count')
        .eq('id', factId)
        .single();

      if (fetchError || !fact) {
        console.warn('[HEIDI-AGENT] Fact not found for confidence update');
        return;
      }

      // Calculate new confidence with bias toward stability
      let newConfidence = fact.confidence;
      if (wasSuccessful) {
        newConfidence = Math.min(0.97, fact.confidence + 0.02);
      } else {
        newConfidence = Math.max(0.50, fact.confidence - 0.03);
      }

      const updatesCount = (fact.updates_count || 0) + 1;

      // Update fact
      const { error: updateError } = await this.supabase
        .from('hydi_facts')
        .update({
          confidence: newConfidence,
          updates_count: updatesCount,
          last_feedback_at: new Date().toISOString()
        })
        .eq('id', factId);

      if (updateError) {
        console.warn('[HEIDI-AGENT] Confidence update error:', updateError.message);
      } else {
        const direction = wasSuccessful ? '↑' : '↓';
        console.log(`[HEIDI-AGENT] Fact ${factId}: confidence ${(fact.confidence*100).toFixed(0)}% ${direction} ${(newConfidence*100).toFixed(0)}%`);
      }
    } catch (error) {
      console.error('[HEIDI-AGENT] Confidence update failed:', error.message);
    }
  }

  /**
   * Process one task cycle
   */
  async processTaskCycle() {
    if (!this.leaseClaimed) return;
    // Kill switch: paused means observe-only — leave tasks pending.
    if (this.isPaused()) return;

    try {
      const tasks = await this.pollTasks();
      if (tasks.length === 0) return;

      console.log(`[HEIDI-AGENT] Processing ${tasks.length} pending tasks`);

      for (const task of tasks) {
        const decision = await this.makeDecision(task);
        const result = await this.executeTask(task, decision);

        this.stats.tasksProcessed++;
        if (decision.verdict === 'REVIEW') {
          this.stats.tasksReviewed++;
        } else if (decision.verdict === 'BLOCK') {
          this.stats.tasksBlocked++;
        }
      }
    } catch (error) {
      console.error('[HEIDI-AGENT] Task cycle failed:', error.message);
    }
  }

  /**
   * Reflect on recent decisions and store insights
   */
  async reflect() {
    if (!this.leaseClaimed) return;

    try {
      console.log('[HEIDI-AGENT] Running reflection cycle...');

      // Fetch recent events
      const { data: events, error } = await this.supabase
        .from('heidi_events')
        .select('*')
        .eq('event_type', 'decision')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error || !events || events.length === 0) return;

      // Analyze patterns
      const approved = events.filter(e => e.verdict === 'AUTO-APPROVE').length;
      const blocked = events.filter(e => e.verdict === 'BLOCK').length;
      const reviewed = events.filter(e => e.verdict === 'REVIEW').length;

      const reflection = {
        cycle: this.stats.reflectionsCycled + 1,
        event_range: {
          from: events[events.length - 1].id,
          to: events[0].id
        },
        patterns: [
          `Approved ${approved}/${events.length} tasks`,
          `Blocked ${blocked}/${events.length} tasks`,
          `Escalated ${reviewed}/${events.length} tasks for review`
        ],
        uncertainties: blocked > 0 ? ['Low-confidence decisions need human review'] : [],
        improvements: approved > 0.8 * events.length ? ['Increase AUTO-APPROVE threshold'] : [],
        timestamp: new Date().toISOString()
      };

      // Store reflection
      const { error: reflectError } = await this.supabase
        .from('heidi_reflections')
        .insert({
          reflection,
          event_range: reflection.event_range,
          cycle: reflection.cycle
        });

      if (reflectError) {
        console.error('[HEIDI-AGENT] Reflection storage error:', reflectError.message);
      } else {
        console.log(`[HEIDI-AGENT] Reflection cycle ${reflection.cycle} complete`);
        this.stats.reflectionsCycled++;
      }
    } catch (error) {
      console.error('[HEIDI-AGENT] Reflection failed:', error.message);
    }
  }

  /**
   * Handle user approval/rejection in advisory mode
   */
  async handleAdvisoryAction(taskId, action, reason = '') {
    try {
      if (!['approve', 'reject'].includes(action)) {
        return { success: false, error: 'Invalid action (must be approve or reject)' };
      }

      // Fetch the task
      const { data: tasks, error } = await this.supabase
        .from('agent_bus')
        .select('*')
        .eq('id', taskId);

      if (error || !tasks || tasks.length === 0) {
        return { success: false, error: 'Task not found' };
      }

      const task = tasks[0];

      if (action === 'approve') {
        // A human approval replaces the confidence/bounds judgement only.
        // It never overrides HEIDI_ALLOW_EXEC, the pause switch, or the
        // action registry.
        const auth = authorizeHumanApproval({ task, env: process.env, paused: this.isPaused() });
        if (!auth.allowed) {
          console.log(`[HEIDI-AGENT] Approval of ${logSafe(taskId)} refused: ${logSafe(auth.reason)}`);
          await this.logEvent(task, 'APPROVAL-REFUSED', `${auth.reason} [gate:${auth.gate}]`, []);
          return { success: false, executed: false, error: auth.reason, gate: auth.gate };
        }

        // Execute the task
        console.log(`[HEIDI-AGENT] User approved task ${taskId}`);
        await this.supabase
          .from('agent_bus')
          .update({ status: 'approved_by_user', approved_at: new Date().toISOString() })
          .eq('id', taskId);

        const execResult = await this.executeTask(task, { verdict: 'AUTO-APPROVE', reason: 'User approved' });
        return { success: execResult.success, executed: execResult.executed, action: 'approved' };
      } else {
        // Reject the task
        console.log(`[HEIDI-AGENT] User rejected task ${taskId}`);
        await this.supabase
          .from('agent_bus')
          .update({ status: 'rejected_by_user', rejected_reason: reason, rejected_at: new Date().toISOString() })
          .eq('id', taskId);

        await this.logEvent(task, 'USER-REJECTED', reason || 'User rejected task', []);
        return { success: true, executed: false, action: 'rejected' };
      }
    } catch (error) {
      console.error('[HEIDI-AGENT] Advisory action error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Initialize agent
   */
  async initialize() {
    console.log('[HEIDI-AGENT] Initializing...');

    // Try to claim lease
    let leaseAttempts = 0;
    while (!this.leaseClaimed && leaseAttempts < 3) {
      const claimed = await this.claimLease();
      if (claimed) break;
      leaseAttempts++;
      await new Promise(r => setTimeout(r, 2000));
    }

    if (!this.leaseClaimed) {
      console.error('[HEIDI-AGENT] Failed to claim lease after 3 attempts. Running in advisory mode.');
      // Can still run in advisory mode (REVIEW everything)
    }

    // Load decision bounds
    await this.loadDecisionBounds();

    this.isRunning = true;
    console.log('[HEIDI-AGENT] Ready');
  }

  /**
   * Start event loop
   */
  start() {
    console.log('[HEIDI-AGENT] Starting event loop...');

    // Initialize goal execution system
    this.initializeGoalSystem();

    // Lease renewal (every 90s)
    this.leaseTimer = setInterval(async () => {
      if (this.leaseClaimed) {
        await this.claimLease();
      }
    }, this.leaseRenewalInterval * 1000);

    // Task processing (every 30s)
    this.pollTimer = setInterval(async () => {
      await this.processTaskCycle();
    }, this.taskPollInterval);

    // Reflection (every hour)
    this.reflectionTimer = setInterval(async () => {
      await this.reflect();
    }, this.reflectionInterval);

    // Goal execution (every minute)
    this.goalTimer = setInterval(async () => {
      await this.processGoals();
    }, this.goalExecutionInterval);

    console.log('[HEIDI-AGENT] Event loops active');

    try {
      const opsResponder = require('../lib/heidi/ops-responder').createOpsResponder();
      require('../lib/forge-board/listener').startBoardListener({
        sender: 'Heidi',
        skip: opsResponder.handles,
        onMessages: (all) => opsResponder.tick(all),
      });
    } catch (error) {
      console.error('[HEIDI-AGENT] board listener skipped:', error.message);
    }

    // Start HTTP server for advisory mode
    if (this.advisoryMode) {
      this.startAdvisoryServer();
    }
  }

  /**
   * Initialize goal execution system
   */
  async initializeGoalSystem() {
    try {
      // Create a simple brain interface for goal decomposition
      const brain = {
        generate: async (prompt) => {
          // For now, use Ollama directly
          const response = await fetch('http://127.0.0.1:11434/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'llama3.2', prompt, stream: false })
          });
          const result = await response.json();
          return { text: result.response };
        }
      };

      // Create a simple memory interface
      const memory = {
        store: async (content) => {
          console.log(`[GoalSystem] Stored: ${content.substring(0, 50)}...`);
          return true;
        }
      };

      this.goalEngine = new HeidiGoalEngine(brain, memory);
      await this.goalEngine.initialize();

      const actionExecutor = new ActionExecutor();
      this.goalExecutor = new GoalExecutor(this.goalEngine, actionExecutor);

      console.log('[HEIDI-AGENT] Goal execution system initialized');
    } catch (error) {
      console.error('[HEIDI-AGENT] Goal system initialization failed:', error.message);
    }
  }

  /**
   * Process active goals - execute next task for each
   */
  async processGoals() {
    try {
      if (!this.goalExecutor) {
        return;
      }

      const activeGoals = this.goalEngine.getActiveGoals();
      if (activeGoals.length === 0) {
        return;
      }

      console.log(`[HEIDI-AGENT] Processing ${activeGoals.length} active goals`);

      for (const goal of activeGoals) {
        const nextTask = this.goalEngine.nextTask(goal.id);
        if (nextTask) {
          console.log(`[HEIDI-AGENT] Executing task: ${nextTask.description}`);
          await this.goalExecutor.executeNextTask(goal.id);
        }
      }
    } catch (error) {
      console.error('[HEIDI-AGENT] Goal processing failed:', error.message);
    }
  }

  /**
   * Start HTTP server for advisory mode approvals
   */
  /** Overridable for tests. Exits so PM2 records the failure. */
  onFatal(error) {
    console.error('[HEIDI-AGENT] Fatal:', error && error.message);
    process.exit(1);
  }

  startAdvisoryServer() {
    // 3459 is heidi-core/server.js's own port (see .ports.json) -- advisory
    // mode must not collide with it when both run at once.
    const port = process.env.HEIDI_ADVISORY_PORT || 3461;

    this.httpServer = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      // CORS only for explicitly allowed origins (e.g. Ursula); never '*'.
      const corsOrigin = allowedCorsOrigin(req, process.env);
      if (corsOrigin) {
        res.setHeader('Access-Control-Allow-Origin', corsOrigin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(corsOrigin ? 204 : 403);
        res.end();
        return;
      }

      // Every route needs the admin bearer token. No token configured →
      // refuse everything rather than serve open.
      const auth = checkAdvisoryAuth(req, process.env);
      if (!auth.ok) {
        res.writeHead(auth.status);
        res.end(JSON.stringify({ error: auth.error }));
        return;
      }

      // GET /api/decisions/pending - List pending REVIEW decisions
      if (req.method === 'GET' && req.url === '/api/decisions/pending') {
        try {
          const { data, error } = await this.supabase
            .from('agent_bus')
            .select('*')
            .eq('status', 'pending');

          if (error) throw error;

          // Get corresponding decisions from events (last decision for each task)
          const decisions = await Promise.all(
            (data || []).map(async task => {
              const { data: events } = await this.supabase
                .from('heidi_events')
                .select('*')
                .eq('task_id', task.id)
                .order('timestamp', { ascending: false })
                .limit(1);

              return {
                task_id: task.id,
                type: task.type,
                division: task.division,
                payload: task.payload,
                confidence: task.confidence,
                decision: events?.[0] ? { verdict: events[0].verdict, reason: events[0].reason } : null
              };
            })
          );

          res.writeHead(200);
          res.end(JSON.stringify({ decisions }));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // POST /api/decisions/{taskId}/approve - Approve a decision
      if (req.method === 'POST' && req.url.match(/^\/api\/decisions\/[^/]+\/approve$/)) {
        try {
          const taskId = req.url.split('/')[3];
          const result = await this.handleAdvisoryAction(taskId, 'approve');

          res.writeHead(result.success ? 200 : 400);
          res.end(JSON.stringify(result));
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // POST /api/decisions/{taskId}/reject - Reject a decision
      if (req.method === 'POST' && req.url.match(/^\/api\/decisions\/[^/]+\/reject$/)) {
        try {
          const taskId = req.url.split('/')[3];
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body || '{}');
              const result = await this.handleAdvisoryAction(taskId, 'reject', payload.reason);

              res.writeHead(result.success ? 200 : 400);
              res.end(JSON.stringify(result));
            } catch (e) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // POST /api/feedback/{eventId} - Submit feedback on a decision
      if (req.method === 'POST' && req.url.match(/^\/api\/feedback\/[^/]+$/)) {
        try {
          const eventId = req.url.split('/')[3];
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const feedback = JSON.parse(body || '{}');
              // feedback: { approval: 'approved'|'rejected'|'needs-changes', outcome: bool, notes: string }
              await this.processFeedback(eventId, feedback);

              res.writeHead(200);
              res.end(JSON.stringify({ success: true, message: 'Feedback processed' }));
            } catch (e) {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
        } catch (error) {
          res.writeHead(500);
          res.end(JSON.stringify({ error: error.message }));
        }
        return;
      }

      // 404
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    const host = bindHost(process.env);
    if (!process.env.HEIDI_ADMIN_TOKEN) {
      console.error('[HEIDI-AGENT] HEIDI_ADMIN_TOKEN not set — advisory API will refuse every request (503)');
    }

    // Fail loudly on a port conflict (exit non-zero so PM2 shows it) instead
    // of silently running with no approval API.
    this.httpServer.on('error', (error) => {
      console.error(`[HEIDI-AGENT] Advisory server error on ${host}:${port}:`, error.code || '', error.message);
      this.onFatal(error);
    });

    this.httpServer.listen(port, host, () => {
      console.log(`[HEIDI-AGENT] Advisory server listening on http://${host}:${port}`);
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('[HEIDI-AGENT] Shutting down...');

    // Clear timers
    clearInterval(this.leaseTimer);
    clearInterval(this.pollTimer);
    clearInterval(this.reflectionTimer);

    // Close HTTP server
    if (this.httpServer) {
      this.httpServer.close();
      console.log('[HEIDI-AGENT] Advisory server closed');
    }

    // Release lease
    if (this.leaseClaimed) {
      try {
        await this.supabase
          .from('heidi_decision_bounds')
          .update({ lease_holder: null })
          .eq('lease_holder', this.leaseHolder);

        console.log('[HEIDI-AGENT] Lease released');
      } catch (error) {
        console.error('[HEIDI-AGENT] Lease release error:', error.message);
      }
    }

    console.log('[HEIDI-AGENT] Shutdown complete');
    process.exit(0);
  }

  /**
   * Print status report
   */
  statusReport() {
    const uptime = Math.round((Date.now() - this.stats.startTime) / 1000);
    return {
      name: this.name,
      lease_holder: this.leaseHolder,
      lease_claimed: this.leaseClaimed,
      uptime_seconds: uptime,
      stats: this.stats
    };
  }
}

// Start if run directly
if (require.main === module) {
  require('../lib/runtime/provenance').recordProcessProvenance('heidi-agent');
  const agent = new HeidiAgent();

  agent.initialize().then(() => {
    agent.start();

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      console.log('\n[HEIDI-AGENT] SIGTERM received');
      await agent.shutdown();
    });

    process.on('SIGINT', async () => {
      console.log('\n[HEIDI-AGENT] SIGINT received');
      await agent.shutdown();
    });

    // Status report every 5 minutes
    setInterval(() => {
      console.log('[HEIDI-AGENT] Status:', JSON.stringify(agent.statusReport(), null, 2));
    }, 300000);
  }).catch(error => {
    console.error('[HEIDI-AGENT] Initialization failed:', error);
    process.exit(1);
  });
}

module.exports = HeidiAgent;
