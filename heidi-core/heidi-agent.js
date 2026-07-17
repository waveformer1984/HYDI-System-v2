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

class HeidiAgent {
  constructor(config = {}) {
    this.name = 'frank-heidi-agent';
    this.leaseHolder = 'frank';
    this.leaseTTL = 120; // seconds
    this.leaseRenewalInterval = 90; // renew every 90s
    this.taskPollInterval = 30000; // poll every 30s
    this.reflectionInterval = 3600000; // reflect every hour
    this.decisionBounds = null;

    // Supabase is OPTIONAL — in local-only mode (no SUPABASE_URL/key set) it
    // is disabled entirely: lease coordination is unnecessary for a single
    // solo instance, the task queue is simply empty, and decision/reflection
    // logging degrades to console output instead of a persisted audit trail.
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    this.supabase = (process.env.SUPABASE_URL && SUPABASE_KEY)
      ? createClient(process.env.SUPABASE_URL, SUPABASE_KEY)
      : null;
    if (!this.supabase) {
      console.log('[HEIDI-AGENT] LOCAL-ONLY MODE: Supabase disabled — lease/task-queue/reflection persistence are no-ops');
    }

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
    if (!this.supabase) {
      // No other instance to contend with locally -- grant immediately.
      if (!this.leaseClaimed) {
        console.log('[HEIDI-AGENT] LOCAL-ONLY MODE: lease auto-granted (no coordination needed)');
      }
      this.leaseClaimed = true;
      return true;
    }

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

      // Claim if no holder OR if lease expired
      const isLeaseAvailable = !current.lease_holder || new Date(current.lease_expires) < now;

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
    if (!this.supabase) {
      this.decisionBounds = { auto_approve_threshold: 0.85 };
      console.log('[HEIDI-AGENT] LOCAL-ONLY MODE: using default decision bounds (auto_approve_threshold=0.85)');
      return true;
    }

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
    if (!this.supabase) return []; // no shared queue to poll locally

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
    if (!this.supabase) return []; // no procedural memory table locally

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
   * Make a decision on a task
   * Returns: { verdict: 'AUTO-APPROVE' | 'REVIEW' | 'BLOCK', reason: string, memory_ids: UUID[] }
   */
  async makeDecision(task) {
    try {
      // Never auto-approve without explicit enable flag
      if (!process.env.HEIDI_ALLOW_EXEC) {
        return { verdict: 'REVIEW', reason: 'HEIDI_ALLOW_EXEC not set', memory_ids: [] };
      }

      // Check bounds
      if (!this.decisionBounds) {
        return { verdict: 'REVIEW', reason: 'Decision bounds not loaded', memory_ids: [] };
      }

      // Retrieve relevant procedural memory
      const relevantFacts = await this.retrieveRelevantFacts(task);
      const memoryIds = relevantFacts.map(f => f.id);

      const originalConfidence = task.confidence || 0;
      const threshold = this.decisionBounds.auto_approve_threshold || 0.85;
      let memoryReasoning = '';
      let adjustedConfidence = originalConfidence;

      // Record memory reasoning but DON'T boost confidence before gate evaluation
      if (relevantFacts.length > 0) {
        const avgFactConfidence = relevantFacts.reduce((sum, f) => sum + (f.confidence || 0), 0) / relevantFacts.length;
        memoryReasoning = ` (verified against ${relevantFacts.length} facts, avg ${(avgFactConfidence * 100).toFixed(0)}% confident)`;
      }

      // Sensitive tasks ALWAYS need human review (financial, crypto, vendor decisions)
      const sensitiveDivisions = ['financial', 'crypto', 'vendor'];
      if (sensitiveDivisions.includes(task.division)) {
        return {
          verdict: 'REVIEW',
          reason: `Sensitive (${task.division}) → human approval required${memoryReasoning}`,
          memory_ids: memoryIds
        };
      }

      // Decision logic (triple gate) — evaluate on ORIGINAL confidence, not boosted
      if (originalConfidence >= threshold && task.within_bounds) {
        return {
          verdict: 'AUTO-APPROVE',
          reason: `High confidence (${(originalConfidence * 100).toFixed(0)}%)${memoryReasoning} and within bounds`,
          memory_ids: memoryIds
        };
      }

      if (originalConfidence < 0.5) {
        return {
          verdict: 'BLOCK',
          reason: `Low confidence (${(originalConfidence * 100).toFixed(0)}%)${memoryReasoning}`,
          memory_ids: memoryIds
        };
      }

      // Default to review
      return {
        verdict: 'REVIEW',
        reason: `Confidence ${(originalConfidence * 100).toFixed(0)}%${memoryReasoning} below threshold ${(threshold * 100).toFixed(0)}%`,
        memory_ids: memoryIds
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
      if (decision.verdict !== 'AUTO-APPROVE') {
        // Log review/block decision but don't execute
        await this.logEvent(task, decision.verdict, decision.reason, decision.memory_ids);
        return { success: true, executed: false, verdict: decision.verdict };
      }

      console.log(`[HEIDI-AGENT] Executing task: ${task.id}`);

      // Update task status to executing
      if (this.supabase) {
        await this.supabase
          .from('agent_bus')
          .update({ status: 'executing' })
          .eq('id', task.id);
      }

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
      if (this.supabase) {
        await this.supabase
          .from('agent_bus')
          .update({ status: finalStatus, result })
          .eq('id', task.id);
      }

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
    if (!this.supabase) {
      console.log(`[HEIDI-AGENT] (local) decision event: task=${task.id} verdict=${verdict} reason="${reason}"`);
      return;
    }

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
    if (!this.supabase) {
      console.log(`[HEIDI-AGENT] LOCAL-ONLY MODE: feedback for event ${eventId} not persisted`, feedback);
      return;
    }

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
    if (!this.supabase) return; // no procedural memory table locally

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
    if (!this.supabase) return; // no persisted decision events to reflect on locally

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
    if (!this.supabase) {
      return { success: false, error: 'Advisory actions require Supabase -- no local task queue to act on' };
    }

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
  startAdvisoryServer() {
    // 3459 is heidi-core/server.js's own port (see .ports.json) -- advisory
    // mode must not collide with it when both run at once.
    const port = process.env.HEIDI_ADVISORY_PORT || 3461;

    this.httpServer = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      // GET /api/decisions/pending - List pending REVIEW decisions
      if (req.method === 'GET' && req.url === '/api/decisions/pending') {
        if (!this.supabase) {
          res.writeHead(200);
          res.end(JSON.stringify({ decisions: [], note: 'LOCAL-ONLY MODE: no Supabase-backed task queue' }));
          return;
        }

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

    this.httpServer.listen(port, () => {
      console.log(`[HEIDI-AGENT] Advisory server listening on http://localhost:${port}`);
    });

    this.httpServer.on('error', (error) => {
      if (error.code !== 'EADDRINUSE') {
        console.error('[HEIDI-AGENT] Advisory server error:', error.message);
      }
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
    if (this.leaseClaimed && this.supabase) {
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
