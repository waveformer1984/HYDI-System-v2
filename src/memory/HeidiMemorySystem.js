/**
 * HEIDI MEMORY SYSTEM - Layer 4: The Memory Backbone
 * This is where most people fail - you need 3 memory types
 *
 * 1. Short-Term (Session): Current tasks, active goals
 * 2. Long-Term (Database): User profiles, decisions, outcomes, revenue events, system performance
 * 3. Reflective Memory: Heidi's "self-awareness" - what worked, what failed, confidence vs reality, drift score
 */

const EventEmitter = require('events');
const { supabase } = require('../database');
const fs = require('fs').promises;
const path = require('path');

class HeidiMemorySystem extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      sessionMaxSize: config.sessionMaxSize || 100,
      sessionTTL: config.sessionTTL || 3600000,
      batchSize: config.batchSize || 50,
      enablePersistence: config.enablePersistence !== false,
      reflectionInterval: config.reflectionInterval || 300000,
      driftThreshold: config.driftThreshold || 0.3,
      maxReflectionHistory: config.maxReflectionHistory || 1000,
      localStoragePath: config.localStoragePath || path.resolve(__dirname, '../../data/memory'),
      ...config
    };

    // 1. SHORT-TERM MEMORY (Session)
    this.sessionMemory = {
      tasks: new Map(),
      goals: new Map(),
      context: new Map(),
      workingMemory: new Map(),
      lastAccess: new Map()
    };

    // 2. LONG-TERM MEMORY (Database)
    this.dbMemory = {
      userProfiles: new Map(),
      decisions: new Map(),
      patterns: new Map(),
      performance: new Map(),
      revenue: new Map()
    };

    // 3. REFLECTIVE MEMORY (Self-Awareness)
    this.reflectiveMemory = {
      whatWorked: new Map(),
      whatFailed: new Map(),
      confidenceReality: [],
      driftScore: 0,
      patterns: [],
      adaptations: [],
      lastReflection: Date.now()
    };

    // Timer references — stored so destroy() can clear them
    this._destroyed = false;
    this.cleanupTimer = null;
    this.reflectionTimer = null;
    this.persistTimer = null;

    this.initialize();
    this.startMaintenanceTasks();

    console.log('[MEMORY] Heidi Memory System initialized');
    console.log(`[MEMORY] Session TTL: ${this.config.sessionTTL}ms`);
    console.log(`[MEMORY] Reflection interval: ${this.config.reflectionInterval}ms`);
  }

  async initialize() {
    try {
      await fs.mkdir(this.config.localStoragePath, { recursive: true });
      await this.loadDatabaseCache();
      await this.loadReflectiveMemory();
      await this.initializeDatabaseTables();
      console.log('[MEMORY] Memory system initialized successfully');
    } catch (error) {
      console.error('[MEMORY] Initialization failed:', error.message);
      throw error;
    }
  }

  // ── Short-term memory ──────────────────────────────────────────────────────

  storeSession(key, value, category = 'workingMemory') {
    if (!this.sessionMemory[category]) this.sessionMemory[category] = new Map();
    if (this.sessionMemory[category].size >= this.config.sessionMaxSize) {
      this.evictOldestSession(category);
    }
    this.sessionMemory[category].set(key, { value, timestamp: Date.now(), accessCount: 1 });
    this.sessionMemory.lastAccess.set(key, Date.now());
    this.emit('session_stored', { key, category, timestamp: Date.now() });
  }

  getSession(key, category = 'workingMemory') {
    const item = this.sessionMemory[category]?.get(key);
    if (item) {
      item.accessCount++;
      this.sessionMemory.lastAccess.set(key, Date.now());
      return item.value;
    }
    return null;
  }

  storeTask(taskId, task) {
    this.storeSession(taskId, task, 'tasks');
    console.log(`[MEMORY] Task stored in session: ${taskId}`);
  }

  getTask(taskId) { return this.getSession(taskId, 'tasks'); }

  storeGoal(goalId, goal) {
    this.storeSession(goalId, goal, 'goals');
    console.log(`[MEMORY] Goal stored in session: ${goalId}`);
  }

  getGoal(goalId) { return this.getSession(goalId, 'goals'); }
  storeContext(id, ctx) { this.storeSession(id, ctx, 'context'); }
  getContext(id) { return this.getSession(id, 'context'); }

  // ── Long-term memory (database) ────────────────────────────────────────

  async storeUserProfile(userId, profile) {
    try {
      const profileData = { user_id: userId, profile_data: profile, updated_at: new Date().toISOString() };
      const { error } = await supabase.from('user_profiles').upsert(profileData, { onConflict: 'user_id' }).select();
      if (error) throw error;
      this.dbMemory.userProfiles.set(userId, { ...profile, updated_at: profileData.updated_at });
      this.emit('user_profile_stored', { userId, profile });
      console.log(`[MEMORY] User profile stored: ${userId}`);
    } catch (error) {
      console.error(`[MEMORY] Failed to store user profile ${userId}:`, error.message);
      throw error;
    }
  }

  async getUserProfile(userId) {
    try {
      const cached = this.dbMemory.userProfiles.get(userId);
      if (cached) return cached;
      const { data, error } = await supabase.from('user_profiles').select('*').eq('user_id', userId).single();
      if (error && error.code !== 'PGRST116') throw error;
      if (data) {
        this.dbMemory.userProfiles.set(userId, data.profile_data);
        return data.profile_data;
      }
      return null;
    } catch (error) {
      console.error(`[MEMORY] Failed to get user profile ${userId}:`, error.message);
      throw error;
    }
  }

  async storeDecision(decision) {
    try {
      const decisionData = {
        decision_id: decision.id,
        task_id: decision.taskId,
        user_id: decision.userId || 'system',
        decision_type: decision.type,
        context: decision.context,
        options: decision.options,
        selected_option: decision.selectedOption,
        confidence: decision.confidence,
        outcome: decision.outcome,
        timestamp: decision.timestamp || new Date().toISOString()
      };
      const { error } = await supabase.from('decisions').insert(decisionData).select();
      if (error) throw error;
      this.dbMemory.decisions.set(decision.id, decision);
      this.emit('decision_stored', { decisionId: decision.id, decision });
      console.log(`[MEMORY] Decision stored: ${decision.id}`);
    } catch (error) {
      console.error(`[MEMORY] Failed to store decision ${decision.id}:`, error.message);
      throw error;
    }
  }

  async getRecentDecisions(limit = 50, userId = null) {
    try {
      let query = supabase.from('decisions').select('*').order('timestamp', { ascending: false }).limit(limit);
      if (userId) query = query.eq('user_id', userId);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('[MEMORY] Failed to get recent decisions:', error.message);
      throw error;
    }
  }

  async storeRevenueEvent(event) {
    try {
      const eventData = {
        event_id: event.id,
        user_id: event.userId,
        event_type: event.type,
        amount: event.amount,
        currency: event.currency || 'USD',
        source: event.source,
        context: event.context,
        timestamp: event.timestamp || new Date().toISOString()
      };
      const { error } = await supabase.from('revenue_events').insert(eventData).select();
      if (error) throw error;
      this.dbMemory.revenue.set(event.id, event);
      this.emit('revenue_event_stored', { eventId: event.id, event });
      console.log(`[MEMORY] Revenue event stored: ${event.id} ($${event.amount})`);
    } catch (error) {
      console.error(`[MEMORY] Failed to store revenue event ${event.id}:`, error.message);
      throw error;
    }
  }

  async storePerformance(performance) {
    try {
      const perfData = {
        metric_id: performance.id,
        metric_type: performance.type,
        value: performance.value,
        context: performance.context,
        timestamp: performance.timestamp || new Date().toISOString()
      };
      const { error } = await supabase.from('system_performance').insert(perfData).select();
      if (error) throw error;
      this.dbMemory.performance.set(performance.id, performance);
      this.emit('performance_stored', { performanceId: performance.id, performance });
      console.log(`[MEMORY] Performance metric stored: ${performance.id}`);
    } catch (error) {
      console.error(`[MEMORY] Failed to store performance ${performance.id}:`, error.message);
      throw error;
    }
  }

  // ── Reflective memory ──────────────────────────────────────────────────

  storeWhatWorked(strategyId, strategy, outcome) {
    const entry = { id: strategyId, strategy, outcome, timestamp: Date.now(), effectiveness: this.calculateEffectiveness(strategy, outcome) };
    this.reflectiveMemory.whatWorked.set(strategyId, entry);
    this.emit('what_worked_stored', { strategyId, entry });
    console.log(`[MEMORY] Strategy that worked: ${strategyId}`);
  }

  storeWhatFailed(strategyId, strategy, error, context) {
    const entry = { id: strategyId, strategy, error, context, timestamp: Date.now(), severity: this.assessFailureSeverity(error, context) };
    this.reflectiveMemory.whatFailed.set(strategyId, entry);
    this.emit('what_failed_stored', { strategyId, entry });
    console.log(`[MEMORY] Strategy that failed: ${strategyId}`);
  }

  trackConfidenceVsReality(taskId, expectedConfidence, actualOutcome) {
    const entry = {
      taskId,
      expectedConfidence,
      actualOutcome,
      accuracy: this.calculateAccuracy(expectedConfidence, actualOutcome),
      timestamp: Date.now()
    };
    this.reflectiveMemory.confidenceReality.push(entry);
    if (this.reflectiveMemory.confidenceReality.length > this.config.maxReflectionHistory) {
      this.reflectiveMemory.confidenceReality.shift();
    }
    this.updateDriftScore();
    this.emit('confidence_tracked', { taskId, entry });
    console.log(`[MEMORY] Confidence vs reality tracked: ${taskId} (accuracy: ${entry.accuracy.toFixed(2)})`);
  }

  storePattern(pattern) {
    const entry = { ...pattern, id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, timestamp: Date.now(), confidence: pattern.confidence || 0.5 };
    this.reflectiveMemory.patterns.push(entry);
    if (this.reflectiveMemory.patterns.length > this.config.maxReflectionHistory) this.reflectiveMemory.patterns.shift();
    this.emit('pattern_detected', { pattern: entry });
    console.log(`[MEMORY] Pattern detected: ${entry.type}`);
  }

  storeAdaptation(adaptation) {
    const entry = { ...adaptation, id: `adaptation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, timestamp: Date.now(), effectiveness: 0 };
    this.reflectiveMemory.adaptations.push(entry);
    if (this.reflectiveMemory.adaptations.length > this.config.maxReflectionHistory) this.reflectiveMemory.adaptations.shift();
    this.emit('adaptation_made', { adaptation: entry });
    console.log(`[MEMORY] Adaptation made: ${entry.type}`);
  }

  // ── Reflection engine ──────────────────────────────────────────────────

  async runReflection() {
    if (this._destroyed) return;
    const reflectionId = `reflection_${Date.now()}`;
    try {
      if (!this._destroyed) console.log(`[MEMORY] Starting reflection cycle: ${reflectionId}`);
      const reflection = {
        id: reflectionId,
        timestamp: Date.now(),
        whatWorked: this.analyzeWhatWorked(),
        whatFailed: this.analyzeWhatFailed(),
        confidenceAccuracy: this.analyzeConfidenceAccuracy(),
        patterns: this.analyzePatterns(),
        driftScore: this.driftScore,
        recommendations: this.generateRecommendations()
      };
      await this.persistReflection(reflection);
      this.reflectiveMemory.lastReflection = Date.now();
      if (!this._destroyed) this.emit('reflection_completed', reflection);
      if (!this._destroyed) console.log(`[MEMORY] Reflection completed: ${reflectionId}`);
      return reflection;
    } catch (error) {
      if (!this._destroyed) console.error(`[MEMORY] Reflection failed: ${reflectionId}:`, error.message);
      throw error;
    }
  }

  analyzeWhatWorked() {
    const strategies = Array.from(this.reflectiveMemory.whatWorked.values())
      .sort((a, b) => b.effectiveness - a.effectiveness).slice(0, 10);
    return {
      totalStrategies: this.reflectiveMemory.whatWorked.size,
      topStrategies: strategies.map(s => ({ id: s.id, strategy: s.strategy, effectiveness: s.effectiveness })),
      patterns: this.identifySuccessPatterns(strategies),
      recommendations: []
    };
  }

  analyzeWhatFailed() {
    const failuresByType = {};
    for (const failure of this.reflectiveMemory.whatFailed.values()) {
      const type = failure.strategy.type || 'unknown';
      if (!failuresByType[type]) failuresByType[type] = [];
      failuresByType[type].push(failure);
    }
    return {
      totalFailures: this.reflectiveMemory.whatFailed.size,
      commonFailures: Object.entries(failuresByType)
        .map(([type, failures]) => ({ type, count: failures.length, avgSeverity: failures.reduce((s, f) => s + f.severity, 0) / failures.length }))
        .sort((a, b) => b.count - a.count).slice(0, 5),
      failureModes: [],
      recommendations: []
    };
  }

  analyzeConfidenceAccuracy() {
    const entries = this.reflectiveMemory.confidenceReality;
    if (!entries.length) return { avgAccuracy: 0, trend: 'stable', recommendations: [] };
    const avgAccuracy = entries.reduce((s, e) => s + e.accuracy, 0) / entries.length;
    const recent = entries.slice(-10);
    const previous = entries.slice(-20, -10);
    let trend = 'stable';
    if (recent.length && previous.length) {
      const rAvg = recent.reduce((s, e) => s + e.accuracy, 0) / recent.length;
      const pAvg = previous.reduce((s, e) => s + e.accuracy, 0) / previous.length;
      if (rAvg > pAvg + 0.1) trend = 'improving';
      else if (rAvg < pAvg - 0.1) trend = 'declining';
    }
    const recommendations = [];
    if (avgAccuracy < 0.7) recommendations.push('confidence_calibration_needed');
    if (trend === 'declining') recommendations.push('investigate_declining_accuracy');
    return { avgAccuracy, trend, sampleSize: entries.length, recommendations };
  }

  analyzePatterns() {
    const patterns = this.reflectiveMemory.patterns;
    return {
      totalPatterns: patterns.length,
      recentPatterns: patterns.slice(-10),
      patternTypes: this.categorizePatterns(patterns),
      confidence: patterns.length ? patterns.reduce((s, p) => s + p.confidence, 0) / patterns.length : 0
    };
  }

  generateRecommendations() {
    const recs = [];
    if (this.driftScore > this.config.driftThreshold) {
      recs.push({ type: 'drift_mitigation', priority: 'high', action: 'reduce_confidence_threshold', reason: `Drift score ${this.driftScore.toFixed(2)} exceeds threshold ${this.config.driftThreshold}` });
    }
    const failures = this.analyzeWhatFailed();
    if (failures.commonFailures.length) {
      recs.push({ type: 'failure_mitigation', priority: 'medium', action: 'avoid_strategy', target: failures.commonFailures[0].type, reason: `High failure rate: ${failures.commonFailures[0].count} failures` });
    }
    const successes = this.analyzeWhatWorked();
    if (successes.topStrategies.length) {
      recs.push({ type: 'success_amplification', priority: 'low', action: 'increase_strategy_preference', target: successes.topStrategies[0].id, reason: `High effectiveness: ${successes.topStrategies[0].effectiveness.toFixed(2)}` });
    }
    return recs;
  }

  // ── Utilities ───────────────────────────────────────────────────────────

  calculateEffectiveness(strategy, outcome) {
    if (!outcome || outcome.success === false) return 0;
    let e = 0.5;
    if (outcome.success) e += 0.3;
    if (outcome.latency < 5000) e += 0.1;
    if (outcome.confidence > 0.8) e += 0.1;
    return Math.min(1.0, e);
  }

  assessFailureSeverity(error, context) {
    let s = 0.5;
    if (context.priority === 'critical') s += 0.3;
    if (context.type === 'revenue') s += 0.2;
    if (error.includes('timeout')) s += 0.1;
    if (error.includes('critical')) s += 0.2;
    return Math.min(1.0, s);
  }

  calculateAccuracy(expectedConfidence, actualOutcome) {
    if (!actualOutcome) return 0;
    const success = actualOutcome.success !== false ? 1 : 0;
    const confidence = expectedConfidence || 0;
    return success === (confidence > 0.5 ? 1 : 0) ? 1 : 0;
  }

  updateDriftScore() {
    const entries = this.reflectiveMemory.confidenceReality;
    if (!entries.length) { this.driftScore = 0; return; }
    const avgAccuracy = entries.reduce((s, e) => s + e.accuracy, 0) / entries.length;
    this.driftScore = 1 - avgAccuracy;
    this.emit('drift_updated', { score: this.driftScore, accuracy: avgAccuracy });
  }

  identifySuccessPatterns(strategies) {
    const patterns = [];
    const modelUsage = {};
    const strategyTypes = {};
    for (const s of strategies) {
      modelUsage[s.strategy.model] = (modelUsage[s.strategy.model] || 0) + 1;
      const t = s.strategy.type || 'unknown';
      strategyTypes[t] = (strategyTypes[t] || 0) + 1;
    }
    if (modelUsage['gpt-4-local'] > strategies.length * 0.5) patterns.push('gpt-4_local_dominates_success');
    if (strategyTypes['local'] > strategies.length * 0.8) patterns.push('local_strategies_preferred');
    return patterns;
  }

  categorizePatterns(patterns) {
    const cats = {};
    for (const p of patterns) { const t = p.type || 'unknown'; cats[t] = (cats[t] || 0) + 1; }
    return cats;
  }

  evictOldestSession(category) {
    const memory = this.sessionMemory[category];
    if (!memory || !memory.size) return;
    let oldestKey = null, oldestTime = Date.now();
    for (const [key, item] of memory) {
      if (item.timestamp < oldestTime) { oldestTime = item.timestamp; oldestKey = key; }
    }
    if (oldestKey) {
      memory.delete(oldestKey);
      this.sessionMemory.lastAccess.delete(oldestKey);
      console.log(`[MEMORY] Evicted oldest session item: ${oldestKey}`);
    }
  }

  // ── Persistence and maintenance ────────────────────────────────────────

  async initializeDatabaseTables() {
    console.log('[MEMORY] Database tables assumed to exist');
  }

  async loadDatabaseCache() {
    console.log('[MEMORY] Loading database cache...');
  }

  async loadReflectiveMemory() {
    try {
      const filePath = path.join(this.config.localStoragePath, 'reflective_memory.json');
      try {
        const data = await fs.readFile(filePath, 'utf8');
        this.reflectiveMemory = { ...this.reflectiveMemory, ...JSON.parse(data) };
        console.log('[MEMORY] Reflective memory loaded from disk');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        console.log('[MEMORY] No existing reflective memory found, starting fresh');
      }
    } catch (error) {
      console.error('[MEMORY] Failed to load reflective memory:', error.message);
    }
  }

  async persistReflection(reflection) {
    if (this._destroyed) return;
    try {
      const filePath = path.join(this.config.localStoragePath, 'reflective_memory.json');
      await fs.writeFile(filePath, JSON.stringify({ ...this.reflectiveMemory, lastReflection: Date.now() }, null, 2));
      if (this.config.enablePersistence && !this._destroyed) await this.storeReflectionInDatabase(reflection);
    } catch (error) {
      if (!this._destroyed) console.error('[MEMORY] Failed to persist reflection:', error.message);
    }
  }

  async storeReflectionInDatabase(reflection) {
    try {
      const { error } = await supabase.from('reflections').insert({
        reflection_id: reflection.id,
        reflection_data: reflection,
        timestamp: new Date(reflection.timestamp).toISOString()
      });
      if (error) throw error;
    } catch (error) {
      if (!this._destroyed) console.error('[MEMORY] Failed to store reflection in database:', error.message);
    }
  }

  startMaintenanceTasks() {
    this.cleanupTimer = setInterval(() => {
      if (!this._destroyed) this.cleanupSessionMemory();
    }, 60000);

    this.reflectionTimer = setInterval(() => {
      if (this._destroyed) return;
      if (Date.now() - this.reflectiveMemory.lastReflection >= this.config.reflectionInterval) {
        this.runReflection().catch(err => {
          if (!this._destroyed) console.error('[MEMORY] Reflection cycle failed:', err.message);
        });
      }
    }, 60000);

    this.persistTimer = setInterval(() => {
      if (!this._destroyed) this.persistReflectiveMemory();
    }, 300000);

    // Allow Jest / Node to exit without waiting for these timers
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
    if (this.reflectionTimer.unref) this.reflectionTimer.unref();
    if (this.persistTimer.unref) this.persistTimer.unref();
  }

  cleanupSessionMemory() {
    const now = Date.now();
    let cleaned = 0;
    for (const [, memory] of Object.entries(this.sessionMemory)) {
      if (!(memory instanceof Map)) continue;
      for (const [key, item] of memory) {
        if (now - item.timestamp > this.config.sessionTTL) {
          memory.delete(key);
          this.sessionMemory.lastAccess.delete(key);
          cleaned++;
        }
      }
    }
    if (cleaned > 0) console.log(`[MEMORY] Cleaned ${cleaned} expired session items`);
  }

  async persistReflectiveMemory() {
    if (this._destroyed) return;
    try {
      const filePath = path.join(this.config.localStoragePath, 'reflective_memory.json');
      await fs.writeFile(filePath, JSON.stringify({ ...this.reflectiveMemory, lastSaved: Date.now() }, null, 2));
    } catch (error) {
      if (!this._destroyed) console.error('[MEMORY] Failed to persist reflective memory:', error.message);
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  /** Stop all background timers. Call in afterAll / afterEach when testing. */
  destroy() {
    this._destroyed = true;
    clearInterval(this.cleanupTimer);
    clearInterval(this.reflectionTimer);
    clearInterval(this.persistTimer);
    this.cleanupTimer = null;
    this.reflectionTimer = null;
    this.persistTimer = null;
  }

  getStatus() {
    return {
      session: {
        tasks: this.sessionMemory.tasks.size,
        goals: this.sessionMemory.goals.size,
        context: this.sessionMemory.context.size,
        workingMemory: this.sessionMemory.workingMemory.size
      },
      database: {
        userProfiles: this.dbMemory.userProfiles.size,
        decisions: this.dbMemory.decisions.size,
        performance: this.dbMemory.performance.size,
        revenue: this.dbMemory.revenue.size
      },
      reflective: {
        whatWorked: this.reflectiveMemory.whatWorked.size,
        whatFailed: this.reflectiveMemory.whatFailed.size,
        confidenceEntries: this.reflectiveMemory.confidenceReality.length,
        patterns: this.reflectiveMemory.patterns.length,
        adaptations: this.reflectiveMemory.adaptations.length,
        driftScore: this.driftScore,
        lastReflection: new Date(this.reflectiveMemory.lastReflection).toISOString()
      },
      config: this.config
    };
  }

  async reset() {
    for (const category of Object.keys(this.sessionMemory)) {
      if (this.sessionMemory[category] instanceof Map) this.sessionMemory[category].clear();
    }
    for (const cache of Object.keys(this.dbMemory)) this.dbMemory[cache].clear();
    this.reflectiveMemory = { whatWorked: new Map(), whatFailed: new Map(), confidenceReality: [], driftScore: 0, patterns: [], adaptations: [], lastReflection: Date.now() };
    console.log('[MEMORY] Memory system reset completed');
  }
}

module.exports = HeidiMemorySystem;
