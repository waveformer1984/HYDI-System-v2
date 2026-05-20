// HEIDI Core — index.js (port 3458)
// Uses lowdb (pure JS) instead of sqlite3. No native build required.

const express = require('express');
const axios = require('axios');
const path = require('path');
const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');

const app = express();
app.use(express.json());

const PORT = 3458; // Changed to 3458
const OLLAMA_URL = 'http://127.0.0.1:11434';
const MODEL = 'llama3.2:latest'; // change to qwen2.5-coder:1.5b if preferred

// ── DB setup ────────────────────────────────────────────────────────────────
const dbFile = path.join(__dirname, 'heidi-memory.json');
const adapter = new JSONFile(dbFile);
const db = new Low(adapter, { sessions: [], tasks: [] });

async function initDB() {
  await db.read();
  db.data ||= { sessions: [], tasks: [] };
  await db.write();
  console.log(`[DB] Memory file: ${dbFile}`);
}

// ── Helper: call Ollama ──────────────────────────────────────────────────────
async function callOllama(prompt, systemPrompt = '') {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const response = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: MODEL,
    messages,
    stream: false,
  }, { timeout: 60000 });

  return response.data.message?.content || '';
}

// ── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    model: MODEL,
    sessions: db.data.sessions.length,
    tasks: db.data.tasks.length,
    time: new Date().toISOString(),
  });
});

// Main think endpoint
app.post('/think', async (req, res) => {
  const { input, sessionId = 'default' } = req.body;
  if (!input) return res.status(400).json({ error: 'input required' });

  const startTime = Date.now();

  try {
    // Load session history
    await db.read();
    let session = db.data.sessions.find(s => s.id === sessionId);
    if (!session) {
      session = { id: sessionId, history: [], createdAt: new Date().toISOString() };
      db.data.sessions.push(session);
    }

    // Build context from last 10 exchanges
    const recentHistory = session.history.slice(-10)
      .map(h => `User: ${h.input}\nHEIDI: ${h.response}`)
      .join('\n');

    const systemPrompt = `You are HEIDI, the intelligent core of the ProtoForge system.
You are a task router and assistant. Be concise and direct.
Recent conversation:\n${recentHistory}`;

    const response = await callOllama(input, systemPrompt);
    const executionTime = Date.now() - startTime;

    // Save to memory
    session.history.push({
      input,
      response,
      timestamp: new Date().toISOString(),
    });
    await db.write();

    // Feed meta-cognition evaluator asynchronously — does not block response
    const thinkResult = {
      query: input,
      response,
      sessionId,
      model: MODEL,
      executionTime,
      thinkingProcess: [], // llama3.2 doesn't expose chain-of-thought
      cascadeLookups: [],  // not wired to CASCADE yet
      confidence: 0.7,     // default prior
    };
    metaCognition.evaluateReasoningQuality(thinkResult).catch(() => {});

    res.json({ response, sessionId, model: MODEL, executionTime });
  } catch (err) {
    console.error('[think] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create task
app.post('/task', async (req, res) => {
  const { title, description, priority = 'normal', source = 'api' } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });

  await db.read();
  const task = {
    id: `task_${Date.now()}`,
    title,
    description,
    priority,
    source,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  db.data.tasks.push(task);
  await db.write();

  console.log(`[task] Created: ${task.id} — ${title}`);
  res.json({ success: true, task });
});

// List tasks
app.get('/tasks', async (req, res) => {
  await db.read();
  res.json({ tasks: db.data.tasks });
});

// Update task status
app.patch('/task/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  await db.read();
  const task = db.data.tasks.find(t => t.id === id);
  if (!task) return res.status(404).json({ error: 'task not found' });

  task.status = status;
  task.updatedAt = new Date().toISOString();
  await db.write();

  res.json({ success: true, task });
});

// Clear session memory
app.delete('/session/:id', async (req, res) => {
  await db.read();
  db.data.sessions = db.data.sessions.filter(s => s.id !== req.params.id);
  await db.write();
  res.json({ success: true });
});

// CASCADE AGENT v3 - Anti-Misalignment Layer
const CascadeEngineV3 = require('./cascade-v3-clean');
const cascade = new CascadeEngineV3();

// ── Autonomous Task Queue (Phase 5.1) ───────────────────────────────────────
const AutonomousTaskQueue = require('./autonomous-task-queue');
const atq = new AutonomousTaskQueue(db, cascade);
atq.enqueueTask = (type, ctx, priority) => atq.enqueue(type, ctx, priority); // alias for Phase 5.2+
atq.start(6000); // background tick every 6 seconds

// ── Meta-Cognition + Knowledge Synthesis (Phase 5.2 / 5.3) ─────────────────
const MetaCognitiveLoop = require('./meta-cognition');
const KnowledgeSynthesisEngine = require('./knowledge-synthesis');

const metaCognition = new MetaCognitiveLoop({ cascadeSystem: cascade, autonomousQueue: atq });
const synthesis = new KnowledgeSynthesisEngine({
  cascadeSystem: cascade,
  autonomousQueue: atq,
  metaCognition,
});

metaCognition.on('pattern-extracted', ({ patternId, qualityScore }) =>
  console.log(`[MC] Pattern extracted: ${patternId} (score: ${qualityScore.toFixed(2)})`));
metaCognition.on('reasoning-failure-detected', ({ primaryIssue }) =>
  console.warn(`[MC] Reasoning gap: ${primaryIssue}`));
synthesis.on('insight-synthesized', ({ relationshipType, confidence }) =>
  console.log(`[KS] Insight: ${relationshipType} (confidence: ${confidence.toFixed(2)})`));
synthesis.on('synthesis-complete', ({ patternCount, insightCount, executionTime }) =>
  console.log(`[KS] Synthesis: ${patternCount} patterns → ${insightCount} insights (${executionTime}ms)`));

// Inspect the autonomous queue state
app.get('/queue', (req, res) => {
  res.json(atq.snapshot());
});

// Manually enqueue an autonomous task
app.post('/queue/enqueue', (req, res) => {
  const { type, context = {}, priority = 'normal' } = req.body;
  const allowed = ['introspect_health', 'validate_cascade', 'check_task_backlog',
                   'check_ollama', 'synthesize_insight', 'summarize_history'];
  if (!allowed.includes(type)) {
    return res.status(400).json({ error: `Unknown task type. Allowed: ${allowed.join(', ')}` });
  }
  const id = atq.enqueue(type, context, priority);
  res.json({ success: true, id });
});

// ── Phase 5 Meta-Cognition + Knowledge Synthesis endpoints ──────────────────

// Overall Phase 5 status
app.get('/phase5/status', (req, res) => {
  res.json({
    meta_cognition: metaCognition.getInsights(),
    knowledge_synthesis: synthesis.getStatistics(),
    evolution: synthesis.getEvolutionAnalysis(),
  });
});

// Recent reasoning evaluations
app.get('/phase5/evaluations', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  res.json({
    evaluations: metaCognition.evaluationHistory.slice(-limit),
    total: metaCognition.evaluationHistory.length,
  });
});

// Recent synthesized insights
app.get('/phase5/insights', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const insights = Array.from(synthesis.discoveredInsights.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);
  res.json({ insights, total: synthesis.discoveredInsights.size });
});

// Find insights relevant to a query
app.post('/phase5/insights/search', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query required' });
  const relevant = await synthesis.findRelevantInsights(query);
  res.json({ results: relevant });
});

// Trigger a synthesis cycle on demand
app.post('/phase5/synthesize', async (req, res) => {
  try {
    const result = await synthesis.synthesizeNewInsights();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Export all discovered knowledge
app.get('/phase5/export', (req, res) => {
  res.json(synthesis.exportDiscoveries());
});

// CASCADE AGENT ENDPOINTS - Early-Stage COO Intelligence

// CASCADE v3 ENDPOINTS - Anti-Misalignment Layer

// Get prioritized revenue tasks with anti-misalignment scoring
app.get('/revenue/tasks', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    res.json(result);
  } catch (error) {
    console.error('[CASCADE v3] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get anti-misalignment metrics and system health
app.get('/revenue/anti-misalignment', async (req, res) => {
  try {
    const metrics = cascade.getAntiMisalignmentMetrics();
    res.json(metrics);
  } catch (error) {
    console.error('[CASCADE v3] Anti-Misalignment Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get structural health analysis
app.get('/revenue/structural-health', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    res.json({
      structural_health: result.structural_health,
      health_rating: result.structural_health.health_rating,
      issues: result.structural_health.issues
    });
  } catch (error) {
    console.error('[CASCADE v3] Structural Health Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get strategic inertia analysis
app.get('/revenue/inertia', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    res.json({
      strategic_inertia: result.strategic_inertia,
    });
  } catch (error) {
    console.error('[CASCADE v3] Inertia Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get theme confidence analysis (NEW)
app.get('/revenue/theme-confidence', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    res.json({
      theme_confidence_metrics: result.theme_confidence_metrics,
      theme_distribution: result.strategic_themes,
      tasks_with_confidence: result.tasks.map(t => ({
        id: t.id,
        title: t.title,
        strategic_theme: t.strategic_theme_info.value,
        confidence: t.strategic_theme_info.confidence,
        source: t.strategic_theme_info.source,
        warnings: t.theme_warnings,
        execution_mode: t.execution_mode,
        effective_confidence: t.effective_confidence,
        historical_accuracy: t.historical_accuracy,
        adaptations: t.adaptations,
        adaptation_notes: t.adaptation_notes,
        policy_authority: t.policy_authority
      }))
    });
  } catch (error) {
    console.error('[CASCADE v3] Theme Confidence Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Record theme outcome for confidence calibration
app.post('/revenue/theme-outcome', async (req, res) => {
  try {
    const { taskId, wasCorrect, actualTheme } = req.body;
    
    if (!taskId || wasCorrect === undefined) {
      return res.status(400).json({
        error: 'Missing required fields: taskId, wasCorrect'
      });
    }
    
    const outcome = await cascade.recordThemeOutcome(taskId, wasCorrect, actualTheme);
    
    res.json({
      success: true,
      outcome,
      calibration_metrics: cascade.getCalibrationMetrics()
    });
  } catch (error) {
    console.error('[CASCADE v3] Theme Outcome Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get confidence calibration metrics
app.get('/revenue/calibration', async (req, res) => {
  try {
    const metrics = cascade.getCalibrationMetrics();
    const overconfidenceLog = cascade.confidenceTracker?.overconfidenceLog || [];
    
    // Get persistent memory metrics
    const memoryMetrics = await cascade.memoryService.getPerformanceMetrics();
    
    res.json({
      calibration_metrics: metrics,
      overconfidence_events: overconfidenceLog.slice(-10),
      theme_accuracy: cascade.confidenceTracker?.themeAccuracy || {},
      persistent_memory: memoryMetrics
    });
  } catch (error) {
    console.error('[CASCADE v3] Calibration Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get Heidi reflections
app.get('/revenue/reflections', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const reflections = await cascade.memoryService.getRecentReflections(limit);
    
    res.json({
      success: true,
      reflections,
      count: reflections.length
    });
  } catch (error) {
    console.error('[CASCADE v3] Reflections Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get system misalignment events
app.get('/revenue/misalignment', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const misalignmentEvents = await cascade.memoryService.getMisalignmentEvents(limit);
    
    res.json({
      success: true,
      misalignment_events: misalignmentEvents,
      count: misalignmentEvents.length
    });
  } catch (error) {
    console.error('[CASCADE v3] Misalignment Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Persistent memory health check
app.get('/revenue/memory-health', async (req, res) => {
  try {
    const health = await cascade.memoryService.healthCheck();
    
    res.json({
      success: true,
      memory_health: health
    });
  } catch (error) {
    console.error('[CASCADE v3] Memory Health Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Policy Override Layer endpoints

// Get policy status and veto history
app.get('/revenue/policy-status', async (req, res) => {
  try {
    const policyStatus = cascade.policyOverride.getPolicyStatus();
    const vetoHistory = cascade.policyOverride.getVetoHistory(20);
    const systemHealth = await cascade.policyOverride.getSystemHealth();
    
    res.json({
      success: true,
      policy_status: policyStatus,
      veto_history: vetoHistory,
      system_health: systemHealth
    });
  } catch (error) {
    console.error('[CASCADE v3] Policy Status Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Add hard block theme
app.post('/revenue/policy/hard-block', async (req, res) => {
  try {
    const { theme, reason } = req.body;
    
    if (!theme) {
      return res.status(400).json({
        error: 'Missing required field: theme'
      });
    }
    
    cascade.policyOverride.addHardBlockTheme(theme, reason);
    
    res.json({
      success: true,
      message: `Theme "${theme}" added to hard block list`,
      reason: reason || 'Manual policy addition'
    });
  } catch (error) {
    console.error('[CASCADE v3] Hard Block Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Remove hard block theme
app.delete('/revenue/policy/hard-block/:theme', async (req, res) => {
  try {
    const { theme } = req.params;
    
    cascade.policyOverride.removeHardBlockTheme(theme);
    
    res.json({
      success: true,
      message: `Theme "${theme}" removed from hard block list`
    });
  } catch (error) {
    console.error('[CASCADE v3] Remove Hard Block Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update policy threshold
app.put('/revenue/policy/threshold/:thresholdName', async (req, res) => {
  try {
    const { thresholdName } = req.params;
    const { newValue } = req.body;
    
    if (newValue === undefined) {
      return res.status(400).json({
        error: 'Missing required field: newValue'
      });
    }
    
    cascade.policyOverride.updateThreshold(thresholdName, newValue);
    
    res.json({
      success: true,
      message: `Threshold "${thresholdName}" updated to ${newValue}`
    });
  } catch (error) {
    console.error('[CASCADE v3] Update Threshold Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Check execution authority for a specific task
app.post('/revenue/policy/check-authority', async (req, res) => {
  try {
    const { task } = req.body;
    
    if (!task || !task.strategic_theme) {
      return res.status(400).json({
        error: 'Missing required fields: task with strategic_theme'
      });
    }
    
    const authority = await cascade.policyOverride.checkExecutionAuthority(task);
    
    res.json({
      success: true,
      authority
    });
  } catch (error) {
    console.error('[CASCADE v3] Check Authority Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Decision Resolver endpoints

// Get arbitration statistics and system health
app.get('/revenue/arbitration/stats', async (req, res) => {
  try {
    const stats = cascade.decisionResolver.getArbitrationStats();
    const health = cascade.decisionResolver.getSystemHealth();
    
    res.json({
      success: true,
      arbitration_stats: stats,
      system_health: health
    });
  } catch (error) {
    console.error('[CASCADE v3] Arbitration Stats Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get conflict history
app.get('/revenue/arbitration/conflicts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const conflicts = cascade.decisionResolver.getConflictHistory(limit);
    
    res.json({
      success: true,
      conflicts,
      count: conflicts.length
    });
  } catch (error) {
    console.error('[CASCADE v3] Conflict History Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update authority weights
app.put('/revenue/arbitration/weights/:authority', async (req, res) => {
  try {
    const { authority } = req.params;
    const { weight } = req.body;
    
    if (weight === undefined) {
      return res.status(400).json({
        error: 'Missing required field: weight'
      });
    }
    
    cascade.decisionResolver.updateAuthorityWeight(authority, weight);
    
    res.json({
      success: true,
      message: `Authority weight updated: ${authority} → ${weight}`
    });
  } catch (error) {
    console.error('[CASCADE v3] Update Weight Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update resolution rules
app.put('/revenue/arbitration/rules/:ruleName', async (req, res) => {
  try {
    const { ruleName } = req.params;
    const { value } = req.body;
    
    if (value === undefined) {
      return res.status(400).json({
        error: 'Missing required field: value'
      });
    }
    
    cascade.decisionResolver.updateResolutionRule(ruleName, value);
    
    res.json({
      success: true,
      message: `Resolution rule updated: ${ruleName} → ${value}`
    });
  } catch (error) {
    console.error('[CASCADE v3] Update Rule Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Full decision arbitration for a specific task
app.post('/revenue/arbitration/resolve', async (req, res) => {
  try {
    const { task } = req.body;
    
    if (!task || !task.strategic_theme) {
      return res.status(400).json({
        error: 'Missing required fields: task with strategic_theme'
      });
    }
    
    // Normalize task
    const normalizedTask = cascade.normalizeTaskWithTheme(task);
    
    // Gather authority signals
    const cascadeOutput = {
      strategic_theme: normalizedTask.strategic_theme,
      strategic_theme_confidence: normalizedTask.strategic_theme_confidence,
      v3_adjusted_score: cascade.calculateAdvancedScore(normalizedTask)
    };
    
    const memorySignal = await cascade.memoryService.getThemeAccuracy(normalizedTask.strategic_theme);
    memorySignal.theme = normalizedTask.strategic_theme;
    
    const policyConstraints = await cascade.policyOverride.checkExecutionAuthority(normalizedTask);
    
    // Resolve decision
    const arbitration = await cascade.decisionResolver.resolveDecision(cascadeOutput, memorySignal, policyConstraints);
    
    res.json({
      success: true,
      task_id: task.id,
      arbitration,
      authority_signals: {
        cascade: cascadeOutput,
        memory: memorySignal,
        policy: policyConstraints
      }
    });
  } catch (error) {
    console.error('[CASCADE v3] Decision Arbitration Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Resolver Governance endpoints

// Get governance metrics and health
app.get('/revenue/governance/metrics', async (req, res) => {
  try {
    const metrics = cascade.decisionResolver.governance.getGovernanceMetrics();
    const health = metrics.governance_health;
    
    res.json({
      success: true,
      governance_metrics: metrics,
      governance_health: health
    });
  } catch (error) {
    console.error('[CASCADE v3] Governance Metrics Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get governance history
app.get('/revenue/governance/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const history = cascade.decisionResolver.governance.getGovernanceHistory(limit);
    
    res.json({
      success: true,
      governance_history: history
    });
  } catch (error) {
    console.error('[CASCADE v3] Governance History Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update governance rules
app.put('/revenue/governance/rules/:category/:ruleName', async (req, res) => {
  try {
    const { category, ruleName } = req.params;
    const { value } = req.body;
    
    if (value === undefined) {
      return res.status(400).json({
        error: 'Missing required field: value'
      });
    }
    
    cascade.decisionResolver.governance.updateGovernanceRule(category, ruleName, value);
    
    res.json({
      success: true,
      message: `Governance rule updated: ${category}.${ruleName} → ${value}`
    });
  } catch (error) {
    console.error('[CASCADE v3] Update Governance Rule Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Execution Bias endpoints

// Get execution bias metrics and health
app.get('/revenue/bias/metrics', async (req, res) => {
  try {
    const metrics = cascade.decisionResolver.executionBias.getBiasMetrics();
    
    // Calculate health separately to avoid recursion
    const recentActivationRate = metrics.recent_activation_rate || 0;
    const deferralCount = metrics.current_deferral_count || 0;
    const deferralTime = metrics.current_deferral_time || 0;
    const healthScore = Math.max(0, 1 - (recentActivationRate * 2));
    
    const health = {
      healthy: healthScore > 0.7,
      health_score: healthScore,
      activation_rate: recentActivationRate,
      deferral_status: {
        count: deferralCount,
        time_ms: deferralTime,
        status: deferralCount > 3 || deferralTime > 20000 ? 'concerning' : 'normal'
      },
      recommendation: healthScore > 0.7 ? 'stable' : 'monitor_bias_activation'
    };
    
    res.json({
      success: true,
      bias_metrics: metrics,
      bias_health: health
    });
  } catch (error) {
    console.error('[CASCADE v3] Bias Metrics Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get execution bias history
app.get('/revenue/bias/history', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const history = cascade.decisionResolver.executionBias.getExecutionHistory(limit);
    
    res.json({
      success: true,
      execution_bias_history: history,
      count: history.length
    });
  } catch (error) {
    console.error('[CASCADE v3] Bias History Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Update execution bias configuration
app.put('/revenue/bias/config/:category/:ruleName', async (req, res) => {
  try {
    const { category, ruleName } = req.params;
    const { value } = req.body;
    
    if (value === undefined) {
      return res.status(400).json({
        error: 'Missing required field: value'
      });
    }
    
    cascade.decisionResolver.executionBias.updateBiasConfig(category, ruleName, value);
    
    res.json({
      success: true,
      message: `Bias config updated: ${category}.${ruleName} → ${value}`
    });
  } catch (error) {
    console.error('[CASCADE v3] Update Bias Config Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Reset deferral tracking
app.post('/revenue/bias/reset-deferral', async (req, res) => {
  try {
    cascade.decisionResolver.executionBias.resetDeferralTracking();
    
    res.json({
      success: true,
      message: 'Deferral tracking reset'
    });
  } catch (error) {
    console.error('[CASCADE v3] Reset Deferral Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// System Drift Monitor endpoints

// Get system drift report
app.get('/revenue/drift/report', async (req, res) => {
  try {
    const driftReport = cascade.driftMonitor.getSystemDriftReport();
    
    res.json({
      success: true,
      drift_report: driftReport
    });
  } catch (error) {
    console.error('[CASCADE v3] Drift Report Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Evaluate system drift
app.get('/revenue/drift/evaluate', async (req, res) => {
  try {
    const driftEvaluation = cascade.driftMonitor.evaluateSystemDrift();
    
    res.json({
      success: true,
      drift_evaluation: driftEvaluation
    });
  } catch (error) {
    console.error('[CASCADE v3] Drift Evaluation Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Establish baseline for drift monitoring
app.post('/revenue/drift/establish-baseline', async (req, res) => {
  try {
    const baselineEstablished = cascade.driftMonitor.establishBaseline();
    
    res.json({
      success: true,
      baseline_established: baselineEstablished,
      message: baselineEstablished ? 'Baseline established successfully' : 'Baseline already established'
    });
  } catch (error) {
    console.error('[CASCADE v3] Establish Baseline Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Reset drift monitoring
app.post('/revenue/drift/reset', async (req, res) => {
  try {
    cascade.driftMonitor.resetDriftMonitoring();
    
    res.json({
      success: true,
      message: 'Drift monitoring reset'
    });
  } catch (error) {
    console.error('[CASCADE v3] Reset Drift Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Global Drift Evaluator endpoints

// Get global drift evaluation
app.get('/revenue/global-drift/evaluate', async (req, res) => {
  try {
    const globalDriftEvaluation = await cascade.globalDriftEvaluator.evaluateGlobalDrift();
    
    res.json({
      success: true,
      global_drift_evaluation: globalDriftEvaluation
    });
  } catch (error) {
    console.error('[CASCADE v3] Global Drift Evaluation Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get system health report
app.get('/revenue/global-drift/health', async (req, res) => {
  try {
    const healthReport = cascade.globalDriftEvaluator.getSystemHealthReport();
    
    res.json({
      success: true,
      system_health_report: healthReport
    });
  } catch (error) {
    console.error('[CASCADE v3] System Health Report Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get execution mode cap
app.get('/revenue/global-drift/execution-cap', async (req, res) => {
  try {
    const executionCap = cascade.globalDriftEvaluator.getExecutionModeCap();
    
    res.json({
      success: true,
      execution_mode_cap: executionCap
    });
  } catch (error) {
    console.error('[CASCADE v3] Execution Mode Cap Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Set execution mode cap
app.post('/revenue/global-drift/set-execution-cap', async (req, res) => {
  try {
    const { cap, reason } = req.body;
    
    if (!cap || !reason) {
      return res.status(400).json({
        error: 'Missing required fields: cap, reason'
      });
    }
    
    cascade.globalDriftEvaluator.setExecutionModeCap(cap, reason);
    
    res.json({
      success: true,
      message: `Execution mode cap set to: ${cap} (${reason})`
    });
  } catch (error) {
    console.error('[CASCADE v3] Set Execution Mode Cap Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Reset execution mode cap
app.post('/revenue/global-drift/reset-execution-cap', async (req, res) => {
  try {
    cascade.globalDriftEvaluator.resetExecutionModeCap();
    
    res.json({
      success: true,
      message: 'Execution mode cap reset to trusted'
    });
  } catch (error) {
    console.error('[CASCADE v3] Reset Execution Mode Cap Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Establish baseline for global drift evaluation
app.post('/revenue/global-drift/establish-baseline', async (req, res) => {
  try {
    const baselineEstablished = await cascade.globalDriftEvaluator.establishBaseline();
    
    res.json({
      success: true,
      baseline_established: baselineEstablished,
      message: baselineEstablished ? 'Baseline established successfully' : 'Baseline already established'
    });
  } catch (error) {
    console.error('[CASCADE v3] Establish Baseline Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Reset global drift evaluation
app.post('/revenue/global-drift/reset', async (req, res) => {
  try {
    cascade.globalDriftEvaluator.resetBaseline();
    
    res.json({
      success: true,
      message: 'Global drift evaluation reset'
    });
  } catch (error) {
    console.error('[CASCADE v3] Reset Global Drift Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get drift trends
app.get('/revenue/global-drift/trends', async (req, res) => {
  try {
    const driftTrends = cascade.globalDriftEvaluator.getDriftTrends();
    
    res.json({
      success: true,
      drift_trends: driftTrends
    });
  } catch (error) {
    console.error('[CASCADE v3] Drift Trends Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// External Calibration Anchor endpoints

// Get external alignment evaluation
app.get('/revenue/external-alignment/evaluate', async (req, res) => {
  try {
    const internalDriftScore = parseFloat(req.query.internal_drift_score) || 0;
    const externalAlignment = await cascade.externalCalibrationAnchor.evaluateExternalAlignment(internalDriftScore);
    
    res.json({
      success: true,
      external_alignment: externalAlignment
    });
  } catch (error) {
    console.error('[CASCADE v3] External Alignment Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get system alignment report
app.get('/revenue/external-alignment/report', async (req, res) => {
  try {
    const alignmentReport = cascade.externalCalibrationAnchor.getSystemAlignmentReport();
    
    res.json({
      success: true,
      alignment_report: alignmentReport
    });
  } catch (error) {
    console.error('[CASCADE v3] Alignment Report Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Ingest external signal
app.post('/revenue/external-alibration/signal', async (req, res) => {
  try {
    const { signalType, signalData } = req.body;
    
    if (!signalType || !signalData) {
      return res.status(400).json({
        error: 'Missing required fields: signalType, signalData'
      });
    }
    
    const signal = cascade.externalCalibrationAnchor.ingestExternalSignal(signalType, signalData);
    
    res.json({
      success: true,
      message: `External signal ingested: ${signalType}`,
      signal: signal
    });
  } catch (error) {
    console.error('[CASCADE v3] Signal Ingestion Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Trigger system recalibration
app.post('/revenue/external-alignment/recalibrate', async (req, res) => {
  try {
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({
        error: 'Missing required field: reason'
      });
    }
    
    const recalibration = await cascade.externalCalibrationAnchor.triggerSystemRecalibration(reason);
    
    res.json({
      success: true,
      recalibration: recalibration
    });
  } catch (error) {
    console.error('[CASCADE v3] Recalibration Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Validate against external reality
app.post('/revenue/external-alignment/validate', async (req, res) => {
  try {
    const { internalDecision } = req.body;
    
    if (!internalDecision) {
      return res.status(400).json({
        error: 'Missing required field: internalDecision'
      });
    }
    
    const validation = cascade.externalCalibrationAnchor.validateAgainstExternalReality(internalDecision);
    
    res.json({
      success: true,
      validation: validation
    });
  } catch (error) {
    console.error('[CASCADE v3] External Validation Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get meta-strategy alignment
app.get('/revenue/meta-strategy', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    res.json({
      meta_strategy: result.meta_strategy,
      alignment_score: result.anti_misalignment_metrics.meta_strategy_alignment_score,
      aligned_tasks: result.tasks.filter(t => t.meta_strategy_alignment.aligned).length,
      misaligned_tasks: result.tasks.filter(t => !t.meta_strategy_alignment.aligned).length
    });
  } catch (error) {
    console.error('[CASCADE v3] Meta-Strategy Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get forbidden pattern violations
app.get('/revenue/forbidden', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    const violations = result.tasks.filter(t => t.forbidden_patterns.has_violations);
    
    res.json({
      total_violations: violations.length,
      blocked_tasks: violations.filter(t => t.forbidden_patterns.blocked).length,
      violations: violations.map(t => ({
        task_id: t.id,
        task_title: t.title,
        violations: t.forbidden_patterns.violations,
        blocked: t.forbidden_patterns.blocked
      }))
    });
  } catch (error) {
    console.error('[CASCADE v3] Forbidden Patterns Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get top 5 revenue opportunities (mode-aware)
app.get('/revenue/top', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    const topTasks = result.tasks.filter(t => t.status === 'active').slice(0, 5);
    res.json({ tasks: topTasks });
  } catch (error) {
    console.error('[CASCADE] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get portfolio view (business units, not tasks)
app.get('/revenue/portfolio', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    res.json({
      tasks: result.tasks.filter(t => t.status === 'active'),
      top_clusters: result.clusters,
      risk_summary: result.risk_summary,
      recommended_actions: result.recommended_actions
    });
  } catch (error) {
    console.error('[CASCADE] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get dependency chains and execution plan
app.get('/revenue/dependencies', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    res.json({
      graph: result.graph,
      dependency_chains: this.extractDependencyChains(result.graph),
      execution_plan: result.recommended_actions.filter(a => a.type === 'execute')
    });
  } catch (error) {
    console.error('[CASCADE] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Get killed/dormant tasks (what NOT to do)
app.get('/revenue/suppressed', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    const suppressed = result.tasks.filter(t => t.status !== 'active');
    res.json({
      killed: suppressed.filter(t => t.status === 'killed'),
      dormant: suppressed.filter(t => t.status === 'dormant'),
      reasoning: 'Low score, high risk, or duplicate intent'
    });
  } catch (error) {
    console.error('[CASCADE] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Mode management (execution | exploration | optimization)
app.post('/revenue/mode', async (req, res) => {
  try {
    const { mode } = req.body;
    cascade.setMode(mode);
    res.json({ 
      success: true, 
      mode: cascade.getMode(),
      message: `CASCADE mode set to: ${mode}`
    });
  } catch (error) {
    console.error('[CASCADE] Mode Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/revenue/mode', async (req, res) => {
  try {
    res.json({ mode: cascade.getMode() });
  } catch (error) {
    console.error('[CASCADE] Mode Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Legacy compatibility endpoints (redirect to cascade)
app.get('/portfolio/construct', async (req, res) => {
  try {
    const result = await cascade.reprioritizeTasks();
    res.json(result);
  } catch (error) {
    console.error('[CASCADE] Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Helper function for dependency chains
function extractDependencyChains(graph) {
  const chains = [];
  const visited = new Set();
  
  graph.forEach((taskNode, taskId) => {
    if (taskNode.depends_on.length === 0 && !visited.has(taskId)) {
      const chain = buildDependencyChain(taskId, graph, visited);
      if (chain.length > 1) {
        chains.push(chain);
      }
    }
  });
  
  return chains;
}

function buildDependencyChain(taskId, graph, visited) {
  const chain = [taskId];
  visited.add(taskId);
  
  const taskNode = graph.get(taskId);
  taskNode.enables.forEach(enabledId => {
    if (!visited.has(enabledId)) {
      chain.push(...buildDependencyChain(enabledId, graph, visited));
    }
  });
  
  return chain;
}

// ── Start ─────────────────────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n╔══════════════════════════════════╗`);
    console.log(`║  HEIDI Core running on :${PORT}   ║`);
    console.log(`║  Model: ${MODEL.padEnd(24)}║`);
    console.log(`╚══════════════════════════════════╝\n`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
