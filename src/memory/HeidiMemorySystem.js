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
      // Session memory limits
      sessionMaxSize: config.sessionMaxSize || 100, // Max items in session memory
      sessionTTL: config.sessionTTL || 3600000, // 1 hour session TTL
      
      // Database memory settings
      batchSize: config.batchSize || 50,
      enablePersistence: config.enablePersistence !== false,
      
      // Reflective memory settings
      reflectionInterval: config.reflectionInterval || 300000, // 5 minutes
      driftThreshold: config.driftThreshold || 0.3,
      maxReflectionHistory: config.maxReflectionHistory || 1000,
      
      // Storage paths
      localStoragePath: config.localStoragePath || path.resolve(__dirname, '../../data/memory'),
      
      ...config
    };
    
    // 1. SHORT-TERM MEMORY (Session)
    this.sessionMemory = {
      tasks: new Map(), // Current active tasks
      goals: new Map(), // Active goals
      context: new Map(), // Session context
      workingMemory: new Map(), // Temporary working data
      lastAccess: new Map() // Track access times for cleanup
    };
    
    // 2. LONG-TERM MEMORY (Database)
    this.dbMemory = {
      userProfiles: new Map(), // Cached user profiles
      decisions: new Map(), // Cached decisions
      patterns: new Map(), // Learned patterns
      performance: new Map(), // Performance metrics
      revenue: new Map() // Revenue events and patterns
    };
    
    // 3. REFLECTIVE MEMORY (Self-Awareness)
    this.reflectiveMemory = {
      whatWorked: new Map(), // Successful strategies
      whatFailed: new Map(), // Failed strategies
      confidenceReality: [], // Confidence vs reality tracking
      driftScore: 0, // Current drift score
      patterns: [], // Detected patterns
      adaptations: [], // Adaptations made
      lastReflection: Date.now()
    };
    
    // Initialize storage
    this.initialize();
    
    // Start maintenance tasks
    this.startMaintenanceTasks();
    
    console.log('[MEMORY] Heidi Memory System initialized');
    console.log(`[MEMORY] Session TTL: ${this.config.sessionTTL}ms`);
    console.log(`[MEMORY] Reflection interval: ${this.config.reflectionInterval}ms`);
  }
  
  async initialize() {
    try {
      // Ensure local storage directory exists
      await fs.mkdir(this.config.localStoragePath, { recursive: true });
      
      // Load cached database memory
      await this.loadDatabaseCache();
      
      // Load reflective memory
      await this.loadReflectiveMemory();
      
      // Initialize database tables if needed
      await this.initializeDatabaseTables();
      
      console.log('[MEMORY] Memory system initialized successfully');
      
    } catch (error) {
      console.error('[MEMORY] Initialization failed:', error.message);
      throw error;
    }
  }
  
  /**
   * SHORT-TERM MEMORY OPERATIONS
   */
  
  // Store in session memory
  storeSession(key, value, category = 'workingMemory') {
    if (!this.sessionMemory[category]) {
      this.sessionMemory[category] = new Map();
    }
    
    // Check size limit
    if (this.sessionMemory[category].size >= this.config.sessionMaxSize) {
      this.evictOldestSession(category);
    }
    
    this.sessionMemory[category].set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 1
    });
    
    this.sessionMemory.lastAccess.set(key, Date.now());
    
    // Emit storage event
    this.emit('session_stored', { key, category, timestamp: Date.now() });
  }
  
  // Retrieve from session memory
  getSession(key, category = 'workingMemory') {
    const item = this.sessionMemory[category]?.get(key);
    
    if (item) {
      item.accessCount++;
      this.sessionMemory.lastAccess.set(key, Date.now());
      return item.value;
    }
    
    return null;
  }
  
  // Store active task
  storeTask(taskId, task) {
    this.storeSession(taskId, task, 'tasks');
    console.log(`[MEMORY] Task stored in session: ${taskId}`);
  }
  
  // Get active task
  getTask(taskId) {
    return this.getSession(taskId, 'tasks');
  }
  
  // Store active goal
  storeGoal(goalId, goal) {
    this.storeSession(goalId, goal, 'goals');
    console.log(`[MEMORY] Goal stored in session: ${goalId}`);
  }
  
  // Get active goal
  getGoal(goalId) {
    return this.getSession(goalId, 'goals');
  }
  
  // Store working context
  storeContext(contextId, context) {
    this.storeSession(contextId, context, 'context');
  }
  
  // Get working context
  getContext(contextId) {
    return this.getSession(contextId, 'context');
  }
  
  /**
   * LONG-TERM MEMORY OPERATIONS
   */
  
  // Store user profile
  async storeUserProfile(userId, profile) {
    try {
      const profileData = {
        user_id: userId,
        profile_data: profile,
        updated_at: new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from('user_profiles')
        .upsert(profileData, { onConflict: 'user_id' })
        .select();
      
      if (error) throw error;
      
      // Cache in memory
      this.dbMemory.userProfiles.set(userId, {
        ...profile,
        updated_at: profileData.updated_at
      });
      
      this.emit('user_profile_stored', { userId, profile });
      
      console.log(`[MEMORY] User profile stored: ${userId}`);
      
    } catch (error) {
      console.error(`[MEMORY] Failed to store user profile ${userId}:`, error.message);
      throw error;
    }
  }
  
  // Get user profile
  async getUserProfile(userId) {
    try {
      // Check cache first
      const cached = this.dbMemory.userProfiles.get(userId);
      if (cached) {
        return cached;
      }
      
      // Load from database
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();
      
      if (error && error.code !== 'PGRST116') { // Not found is ok
        throw error;
      }
      
      if (data) {
        // Cache the result
        this.dbMemory.userProfiles.set(userId, data.profile_data);
        return data.profile_data;
      }
      
      return null;
      
    } catch (error) {
      console.error(`[MEMORY] Failed to get user profile ${userId}:`, error.message);
      throw error;
    }
  }
  
  // Store decision
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
      
      const { data, error } = await supabase
        .from('decisions')
        .insert(decisionData)
        .select();
      
      if (error) throw error;
      
      // Cache in memory
      this.dbMemory.decisions.set(decision.id, decision);
      
      this.emit('decision_stored', { decisionId: decision.id, decision });
      
      console.log(`[MEMORY] Decision stored: ${decision.id}`);
      
    } catch (error) {
      console.error(`[MEMORY] Failed to store decision ${decision.id}:`, error.message);
      throw error;
    }
  }
  
  // Get recent decisions
  async getRecentDecisions(limit = 50, userId = null) {
    try {
      let query = supabase
        .from('decisions')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);
      
      if (userId) {
        query = query.eq('user_id', userId);
      }
      
      const { data, error } = await query;
      
      if (error) throw error;
      
      return data || [];
      
    } catch (error) {
      console.error('[MEMORY] Failed to get recent decisions:', error.message);
      throw error;
    }
  }
  
  // Store revenue event
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
      
      const { data, error } = await supabase
        .from('revenue_events')
        .insert(eventData)
        .select();
      
      if (error) throw error;
      
      // Cache in memory
      this.dbMemory.revenue.set(event.id, event);
      
      this.emit('revenue_event_stored', { eventId: event.id, event });
      
      console.log(`[MEMORY] Revenue event stored: ${event.id} ($${event.amount})`);
      
    } catch (error) {
      console.error(`[MEMORY] Failed to store revenue event ${event.id}:`, error.message);
      throw error;
    }
  }
  
  // Store system performance
  async storePerformance(performance) {
    try {
      const perfData = {
        metric_id: performance.id,
        metric_type: performance.type,
        value: performance.value,
        context: performance.context,
        timestamp: performance.timestamp || new Date().toISOString()
      };
      
      const { data, error } = await supabase
        .from('system_performance')
        .insert(perfData)
        .select();
      
      if (error) throw error;
      
      // Cache in memory
      this.dbMemory.performance.set(performance.id, performance);
      
      this.emit('performance_stored', { performanceId: performance.id, performance });
      
      console.log(`[MEMORY] Performance metric stored: ${performance.id}`);
      
    } catch (error) {
      console.error(`[MEMORY] Failed to store performance ${performance.id}:`, error.message);
      throw error;
    }
  }
  
  /**
   * REFLECTIVE MEMORY OPERATIONS (Self-Awareness)
   */
  
  // Store what worked
  storeWhatWorked(strategyId, strategy, outcome) {
    const entry = {
      id: strategyId,
      strategy,
      outcome,
      timestamp: Date.now(),
      effectiveness: this.calculateEffectiveness(strategy, outcome)
    };
    
    this.reflectiveMemory.whatWorked.set(strategyId, entry);
    
    this.emit('what_worked_stored', { strategyId, entry });
    
    console.log(`[MEMORY] Strategy that worked: ${strategyId}`);
  }
  
  // Store what failed
  storeWhatFailed(strategyId, strategy, error, context) {
    const entry = {
      id: strategyId,
      strategy,
      error,
      context,
      timestamp: Date.now(),
      severity: this.assessFailureSeverity(error, context)
    };
    
    this.reflectiveMemory.whatFailed.set(strategyId, entry);
    
    this.emit('what_failed_stored', { strategyId, entry });
    
    console.log(`[MEMORY] Strategy that failed: ${strategyId}`);
  }
  
  // Track confidence vs reality
  trackConfidenceVsReality(taskId, expectedConfidence, actualOutcome) {
    const entry = {
      taskId,
      expectedConfidence,
      actualOutcome,
      accuracy: this.calculateAccuracy(expectedConfidence, actualOutcome),
      timestamp: Date.now()
    };
    
    this.reflectiveMemory.confidenceReality.push(entry);
    
    // Keep only recent history
    if (this.reflectiveMemory.confidenceReality.length > this.config.maxReflectionHistory) {
      this.reflectiveMemory.confidenceReality.shift();
    }
    
    // Update drift score
    this.updateDriftScore();
    
    this.emit('confidence_tracked', { taskId, entry });
    
    console.log(`[MEMORY] Confidence vs reality tracked: ${taskId} (accuracy: ${entry.accuracy.toFixed(2)})`);
  }
  
  // Store pattern detected
  storePattern(pattern) {
    const entry = {
      ...pattern,
      id: `pattern_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      confidence: pattern.confidence || 0.5
    };
    
    this.reflectiveMemory.patterns.push(entry);
    
    // Keep only recent patterns
    if (this.reflectiveMemory.patterns.length > this.config.maxReflectionHistory) {
      this.reflectiveMemory.patterns.shift();
    }
    
    this.emit('pattern_detected', { pattern: entry });
    
    console.log(`[MEMORY] Pattern detected: ${entry.type}`);
  }
  
  // Store adaptation made
  storeAdaptation(adaptation) {
    const entry = {
      ...adaptation,
      id: `adaptation_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      effectiveness: 0 // Will be updated later
    };
    
    this.reflectiveMemory.adaptations.push(entry);
    
    // Keep only recent adaptations
    if (this.reflectiveMemory.adaptations.length > this.config.maxReflectionHistory) {
      this.reflectiveMemory.adaptations.shift();
    }
    
    this.emit('adaptation_made', { adaptation: entry });
    
    console.log(`[MEMORY] Adaptation made: ${entry.type}`);
  }
  
  /**
   * REFLECTION ENGINE - Core self-awareness logic
   */
  
  // Run reflection cycle
  async runReflection() {
    const reflectionId = `reflection_${Date.now()}`;
    
    try {
      console.log(`[MEMORY] Starting reflection cycle: ${reflectionId}`);
      
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
      
      // Store reflection
      await this.persistReflection(reflection);
      
      // Update last reflection time
      this.reflectiveMemory.lastReflection = Date.now();
      
      // Emit reflection completed
      this.emit('reflection_completed', reflection);
      
      console.log(`[MEMORY] Reflection completed: ${reflectionId}`);
      
      return reflection;
      
    } catch (error) {
      console.error(`[MEMORY] Reflection failed: ${reflectionId}:`, error.message);
      throw error;
    }
  }
  
  // Analyze what worked
  analyzeWhatWorked() {
    const analysis = {
      totalStrategies: this.reflectiveMemory.whatWorked.size,
      topStrategies: [],
      patterns: [],
      recommendations: []
    };
    
    // Find top performing strategies
    const strategies = Array.from(this.reflectiveMemory.whatWorked.values())
      .sort((a, b) => b.effectiveness - a.effectiveness)
      .slice(0, 10);
    
    analysis.topStrategies = strategies.map(s => ({
      id: s.id,
      strategy: s.strategy,
      effectiveness: s.effectiveness
    }));
    
    // Identify patterns in successful strategies
    analysis.patterns = this.identifySuccessPatterns(strategies);
    
    return analysis;
  }
  
  // Analyze what failed
  analyzeWhatFailed() {
    const analysis = {
      totalFailures: this.reflectiveMemory.whatFailed.size,
      commonFailures: [],
      failureModes: [],
      recommendations: []
    };
    
    // Group failures by type
    const failuresByType = {};
    
    for (const failure of this.reflectiveMemory.whatFailed.values()) {
      const type = failure.strategy.type || 'unknown';
      if (!failuresByType[type]) {
        failuresByType[type] = [];
      }
      failuresByType[type].push(failure);
    }
    
    // Find common failure patterns
    analysis.commonFailures = Object.entries(failuresByType)
      .map(([type, failures]) => ({
        type,
        count: failures.length,
        avgSeverity: failures.reduce((sum, f) => sum + f.severity, 0) / failures.length
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    
    return analysis;
  }
  
  // Analyze confidence accuracy
  analyzeConfidenceAccuracy() {
    const entries = this.reflectiveMemory.confidenceReality;
    
    if (entries.length === 0) {
      return { avgAccuracy: 0, trend: 'stable', recommendations: [] };
    }
    
    const avgAccuracy = entries.reduce((sum, e) => sum + e.accuracy, 0) / entries.length;
    
    // Calculate trend (last 10 vs previous)
    const recent = entries.slice(-10);
    const previous = entries.slice(-20, -10);
    
    let trend = 'stable';
    if (recent.length > 0 && previous.length > 0) {
      const recentAvg = recent.reduce((sum, e) => sum + e.accuracy, 0) / recent.length;
      const previousAvg = previous.reduce((sum, e) => sum + e.accuracy, 0) / previous.length;
      
      if (recentAvg > previousAvg + 0.1) trend = 'improving';
      else if (recentAvg < previousAvg - 0.1) trend = 'declining';
    }
    
    const recommendations = [];
    if (avgAccuracy < 0.7) {
      recommendations.push('confidence_calibration_needed');
    }
    if (trend === 'declining') {
      recommendations.push('investigate_declining_accuracy');
    }
    
    return {
      avgAccuracy,
      trend,
      sampleSize: entries.length,
      recommendations
    };
  }
  
  // Analyze patterns
  analyzePatterns() {
    const patterns = this.reflectiveMemory.patterns;
    
    return {
      totalPatterns: patterns.length,
      recentPatterns: patterns.slice(-10),
      patternTypes: this.categorizePatterns(patterns),
      confidence: patterns.length > 0 ? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length : 0
    };
  }
  
  // Generate recommendations
  generateRecommendations() {
    const recommendations = [];
    
    // Based on drift score
    if (this.driftScore > this.config.driftThreshold) {
      recommendations.push({
        type: 'drift_mitigation',
        priority: 'high',
        action: 'reduce_confidence_threshold',
        reason: `Drift score ${this.driftScore.toFixed(2)} exceeds threshold ${this.config.driftThreshold}`
      });
    }
    
    // Based on failure analysis
    const failures = this.analyzeWhatFailed();
    if (failures.commonFailures.length > 0) {
      const topFailure = failures.commonFailures[0];
      recommendations.push({
        type: 'failure_mitigation',
        priority: 'medium',
        action: 'avoid_strategy',
        target: topFailure.type,
        reason: `High failure rate: ${topFailure.count} failures`
      });
    }
    
    // Based on success patterns
    const successes = this.analyzeWhatWorked();
    if (successes.topStrategies.length > 0) {
      const topStrategy = successes.topStrategies[0];
      recommendations.push({
        type: 'success_amplification',
        priority: 'low',
        action: 'increase_strategy_preference',
        target: topStrategy.id,
        reason: `High effectiveness: ${topStrategy.effectiveness.toFixed(2)}`
      });
    }
    
    return recommendations;
  }
  
  /**
   * UTILITY METHODS
   */
  
  calculateEffectiveness(strategy, outcome) {
    if (!outcome || outcome.success === false) return 0;
    
    let effectiveness = 0.5; // Base effectiveness
    
    if (outcome.success) effectiveness += 0.3;
    if (outcome.latency < 5000) effectiveness += 0.1; // Fast execution
    if (outcome.confidence > 0.8) effectiveness += 0.1; // High confidence
    
    return Math.min(1.0, effectiveness);
  }
  
  assessFailureSeverity(error, context) {
    let severity = 0.5; // Base severity
    
    if (context.priority === 'critical') severity += 0.3;
    if (context.type === 'revenue') severity += 0.2;
    if (error.includes('timeout')) severity += 0.1;
    if (error.includes('critical')) severity += 0.2;
    
    return Math.min(1.0, severity);
  }
  
  calculateAccuracy(expectedConfidence, actualOutcome) {
    if (!actualOutcome) return 0;
    
    const success = actualOutcome.success !== false ? 1 : 0;
    const confidence = expectedConfidence || 0;
    
    // Accuracy measures how well confidence predicted success
    return success === (confidence > 0.5 ? 1 : 0) ? 1 : 0;
  }
  
  updateDriftScore() {
    const entries = this.reflectiveMemory.confidenceReality;
    
    if (entries.length === 0) {
      this.driftScore = 0;
      return;
    }
    
    // Calculate drift as 1 - average accuracy
    const avgAccuracy = entries.reduce((sum, e) => sum + e.accuracy, 0) / entries.length;
    this.driftScore = 1 - avgAccuracy;
    
    // Emit drift update
    this.emit('drift_updated', { score: this.driftScore, accuracy: avgAccuracy });
  }
  
  identifySuccessPatterns(strategies) {
    const patterns = [];
    
    // Look for common themes in successful strategies
    const modelUsage = {};
    const strategyTypes = {};
    
    for (const strategy of strategies) {
      // Track model usage
      const model = strategy.strategy.model;
      modelUsage[model] = (modelUsage[model] || 0) + 1;
      
      // Track strategy types
      const type = strategy.strategy.type || 'unknown';
      strategyTypes[type] = (strategyTypes[type] || 0) + 1;
    }
    
    // Identify patterns
    if (modelUsage['gpt-4-local'] > strategies.length * 0.5) {
      patterns.push('gpt-4_local_dominates_success');
    }
    
    if (strategyTypes['local'] > strategies.length * 0.8) {
      patterns.push('local_strategies_preferred');
    }
    
    return patterns;
  }
  
  categorizePatterns(patterns) {
    const categories = {};
    
    for (const pattern of patterns) {
      const type = pattern.type || 'unknown';
      categories[type] = (categories[type] || 0) + 1;
    }
    
    return categories;
  }
  
  evictOldestSession(category) {
    const memory = this.sessionMemory[category];
    if (!memory || memory.size === 0) return;
    
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, item] of memory) {
      if (item.timestamp < oldestTime) {
        oldestTime = item.timestamp;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      memory.delete(oldestKey);
      this.sessionMemory.lastAccess.delete(oldestKey);
      console.log(`[MEMORY] Evicted oldest session item: ${oldestKey}`);
    }
  }
  
  /**
   * PERSISTENCE AND MAINTENANCE
   */
  
  async initializeDatabaseTables() {
    // This would create the necessary database tables
    // For now, we assume they exist in Supabase
    console.log('[MEMORY] Database tables assumed to exist');
  }
  
  async loadDatabaseCache() {
    // Load frequently accessed data into memory cache
    console.log('[MEMORY] Loading database cache...');
  }
  
  async loadReflectiveMemory() {
    try {
      const filePath = path.join(this.config.localStoragePath, 'reflective_memory.json');
      
      try {
        const data = await fs.readFile(filePath, 'utf8');
        const reflective = JSON.parse(data);
        
        // Restore reflective memory
        this.reflectiveMemory = {
          ...this.reflectiveMemory,
          ...reflective
        };
        
        console.log('[MEMORY] Reflective memory loaded from disk');
        
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        console.log('[MEMORY] No existing reflective memory found, starting fresh');
      }
      
    } catch (error) {
      console.error('[MEMORY] Failed to load reflective memory:', error.message);
    }
  }
  
  async persistReflection(reflection) {
    try {
      const filePath = path.join(this.config.localStoragePath, 'reflective_memory.json');
      
      // Update reflective memory with current state
      const data = {
        ...this.reflectiveMemory,
        lastReflection: Date.now()
      };
      
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      
      // Also store in database for long-term persistence
      if (this.config.enablePersistence) {
        await this.storeReflectionInDatabase(reflection);
      }
      
    } catch (error) {
      console.error('[MEMORY] Failed to persist reflection:', error.message);
    }
  }
  
  async storeReflectionInDatabase(reflection) {
    try {
      const { data, error } = await supabase
        .from('reflections')
        .insert({
          reflection_id: reflection.id,
          reflection_data: reflection,
          timestamp: new Date(reflection.timestamp).toISOString()
        });
      
      if (error) throw error;
      
    } catch (error) {
      console.error('[MEMORY] Failed to store reflection in database:', error.message);
    }
  }
  
  startMaintenanceTasks() {
    // Clean up expired session memory
    setInterval(() => {
      this.cleanupSessionMemory();
    }, 60000); // Every minute
    
    // Run reflection cycle
    setInterval(() => {
      if (Date.now() - this.reflectiveMemory.lastReflection >= this.config.reflectionInterval) {
        this.runReflection().catch(error => {
          console.error('[MEMORY] Reflection cycle failed:', error.message);
        });
      }
    }, 60000); // Check every minute
    
    // Persist reflective memory
    setInterval(() => {
      this.persistReflectiveMemory();
    }, 300000); // Every 5 minutes
  }
  
  cleanupSessionMemory() {
    const now = Date.now();
    let cleaned = 0;
    
    // Clean each category
    for (const [category, memory] of Object.entries(this.sessionMemory)) {
      if (memory instanceof Map) {
        for (const [key, item] of memory) {
          if (now - item.timestamp > this.config.sessionTTL) {
            memory.delete(key);
            this.sessionMemory.lastAccess.delete(key);
            cleaned++;
          }
        }
      }
    }
    
    if (cleaned > 0) {
      console.log(`[MEMORY] Cleaned ${cleaned} expired session items`);
    }
  }
  
  async persistReflectiveMemory() {
    try {
      const filePath = path.join(this.config.localStoragePath, 'reflective_memory.json');
      const data = {
        ...this.reflectiveMemory,
        lastSaved: Date.now()
      };
      
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      
    } catch (error) {
      console.error('[MEMORY] Failed to persist reflective memory:', error.message);
    }
  }
  
  /**
   * STATUS AND MONITORING
   */
  
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
    // Clear session memory
    for (const category of Object.keys(this.sessionMemory)) {
      if (this.sessionMemory[category] instanceof Map) {
        this.sessionMemory[category].clear();
      }
    }
    
    // Clear database cache
    for (const cache of Object.keys(this.dbMemory)) {
      this.dbMemory[cache].clear();
    }
    
    // Reset reflective memory
    this.reflectiveMemory = {
      whatWorked: new Map(),
      whatFailed: new Map(),
      confidenceReality: [],
      driftScore: 0,
      patterns: [],
      adaptations: [],
      lastReflection: Date.now()
    };
    
    console.log('[MEMORY] Memory system reset completed');
  }
}

module.exports = HeidiMemorySystem;
