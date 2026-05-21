/**
 * HYDI Phase 5 Integration Bootstrap
 * Initializes autonomous reasoning, meta-cognition, and knowledge synthesis
 *
 * Deployment: 5/19/2026 Session 5
 */

const AutonomousReasoningQueue = require('./autonomous-task-queue');
const MetaCognitiveLoop = require('./meta-cognition');
const KnowledgeSynthesisEngine = require('./knowledge-synthesis');

class Phase5System {
  constructor(config = {}) {
    this.config = {
      maxConcurrentTasks: config.maxConcurrentTasks || 4,
      taskQueueInterval: config.taskQueueInterval || 1000,
      enableLogging: config.enableLogging !== false,
      logLevel: config.logLevel || 'info'
    };

    this.autonomousQueue = null;
    this.metaCognition = null;
    this.knowledgeSynthesis = null;
    this.isRunning = false;
    this.initTime = null;
    this.stats = {
      uptime: 0,
      thoughtsEvaluated: 0,
      insightsSynthesized: 0,
      tasksCycled: 0
    };
  }

  /**
   * Initialize Phase 5 systems
   */
  async initialize(cascadeSystem, metricsCollector) {
    this.log('info', 'Initializing Phase 5 Autonomous Reasoning Engine...');

    try {
      // Initialize autonomous task queue
      this.autonomousQueue = new AutonomousReasoningQueue({
        maxConcurrentTasks: this.config.maxConcurrentTasks,
        cascadeSystem: cascadeSystem,
        metricsCollector: metricsCollector
      });

      // Wire up event handlers for autonomous queue
      this.autonomousQueue.on('task-completed', (event) => {
        this.stats.tasksCycled++;
        this.log('debug', `Task completed: ${event.taskType} (${event.executionTime}ms)`);
      });

      this.autonomousQueue.on('task-failed', (event) => {
        this.log('warn', `Task failed: ${event.taskType} - ${event.error}`);
      });

      this.autonomousQueue.on('task-enqueued', (event) => {
        this.log('debug', `Task enqueued: ${event.taskType} [Queue: ${event.queueLength}]`);
      });

      this.autonomousQueue.on('queue-started', () => {
        this.log('info', 'Autonomous queue started - background optimization active');
      });

      // Initialize meta-cognitive loop
      this.metaCognition = new MetaCognitiveLoop({
        cascadeSystem: cascadeSystem,
        autonomousQueue: this.autonomousQueue
      });

      // Wire up event handlers for meta-cognition
      this.metaCognition.on('reasoning-evaluated', (event) => {
        this.stats.thoughtsEvaluated++;
        this.log('debug', `Reasoning evaluated: ${event.classification} (score: ${event.qualityScore.toFixed(2)})`);
      });

      this.metaCognition.on('pattern-extracted', (event) => {
        this.log('info', `✨ Pattern extracted: ${event.patternId} (confidence: ${event.qualityScore.toFixed(2)})`);
      });

      this.metaCognition.on('reasoning-failure-detected', (event) => {
        this.log('warn', `Reasoning gap detected: ${event.primaryIssue}`);
        // This automatically enqueues improvement tasks
      });

      // Initialize knowledge synthesis
      this.knowledgeSynthesis = new KnowledgeSynthesisEngine({
        cascadeSystem: cascadeSystem,
        autonomousQueue: this.autonomousQueue,
        metaCognition: this.metaCognition,
        minQualityScore: 0.75,
        minPatternOccurrences: 2,
        similarityThreshold: 0.7,
        confidenceThreshold: 0.75
      });

      // Wire up event handlers for synthesis
      this.knowledgeSynthesis.on('insight-synthesized', (event) => {
        this.stats.insightsSynthesized++;
        this.log('info', `💡 Insight synthesized: ${event.relationshipType} (confidence: ${event.confidence.toFixed(2)})`);
      });

      this.knowledgeSynthesis.on('synthesis-complete', (event) => {
        this.log('info', `Synthesis cycle complete: ${event.patternCount} patterns → ${event.insightCount} insights (${event.executionTime}ms)`);
      });

      this.knowledgeSynthesis.on('synthesis-error', (event) => {
        this.log('error', `Synthesis error: ${event.error}`);
      });

      // Cross-wire: Periodically trigger synthesis
      this._setupPeriodicSynthesis();

      this.log('info', 'All Phase 5 engines initialized successfully');
      return true;

    } catch (error) {
      this.log('error', `Initialization failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Start Phase 5 autonomous reasoning
   */
  async start() {
    if (this.isRunning) {
      this.log('warn', 'Phase 5 already running');
      return;
    }

    try {
      this.log('info', 'Starting Phase 5 autonomous reasoning engine...');
      this.initTime = Date.now();

      // Start the autonomous queue
      await this.autonomousQueue.start(this.config.taskQueueInterval);

      this.isRunning = true;

      this.log('info', '✅ Phase 5 ACTIVE - Background optimization running');
      this.log('info', 'Background tasks scheduled:');
      this.log('info', '  • Performance introspection: every 30 seconds');
      this.log('info', '  • CASCADE validation: every 5 minutes');
      this.log('info', '  • Knowledge graph optimization: every 10 minutes');
      this.log('info', '  • Health checks: every 1 minute');
      this.log('info', '  • Periodic synthesis: every 15 minutes');

      return true;

    } catch (error) {
      this.log('error', `Failed to start: ${error.message}`);
      return false;
    }
  }

  /**
   * Stop Phase 5
   */
  stop() {
    if (!this.isRunning) return;

    this.autonomousQueue.stop();
    this.isRunning = false;

    this.log('info', 'Phase 5 system stopped');
  }

  /**
   * Hook into /think endpoint
   */
  async hookThinkEndpoint(thinkResult) {
    if (!this.isRunning || !this.metaCognition) {
      return null;
    }

    try {
      const evaluation = await this.metaCognition.evaluateReasoningQuality(thinkResult);
      return evaluation;
    } catch (error) {
      this.log('error', `Meta-cognition evaluation failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Trigger synthesis cycle
   */
  async triggerSynthesis() {
    if (!this.isRunning || !this.knowledgeSynthesis) {
      return null;
    }

    try {
      return await this.knowledgeSynthesis.synthesizeNewInsights();
    } catch (error) {
      this.log('error', `Synthesis failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Get comprehensive system status
   */
  getStatus() {
    const uptime = this.initTime ? Date.now() - this.initTime : 0;

    return {
      running: this.isRunning,
      uptime: uptime,
      stats: {
        ...this.stats,
        uptime: uptime
      },
      queueStatus: this.autonomousQueue ? this.autonomousQueue.getStats() : null,
      metaCognitionStatus: this.metaCognition ? this.metaCognition.getInsights() : null,
      synthesisStatus: this.knowledgeSynthesis ? this.knowledgeSynthesis.getStatistics() : null,
      timestamp: Date.now()
    };
  }

  /**
   * Get recent reasoning evaluations
   */
  getRecentEvaluations(limit = 10) {
    if (!this.metaCognition) return [];
    return this.metaCognition.evaluationHistory.slice(-limit);
  }

  /**
   * Get recent synthesized insights
   */
  getRecentInsights(limit = 10) {
    if (!this.knowledgeSynthesis) return [];
    return Array.from(this.knowledgeSynthesis.discoveredInsights.values())
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  /**
   * Get task queue details
   */
  getQueueDetails() {
    if (!this.autonomousQueue) return null;
    return {
      stats: this.autonomousQueue.getStats(),
      recentHistory: this.autonomousQueue.getRecentHistory(20)
    };
  }

  /**
   * Setup periodic synthesis trigger
   */
  _setupPeriodicSynthesis() {
    // Trigger synthesis every 15 minutes
    setInterval(async () => {
      if (this.isRunning) {
        const result = await this.triggerSynthesis();
        if (result && result.success) {
          this.log('info', `Periodic synthesis: ${result.synthesizedCount} insights generated`);
        }
      }
    }, 900000); // 15 minutes
  }

  /**
   * Logging utility
   */
  log(level, message) {
    if (!this.config.enableLogging) return;

    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [Phase 5] [${level.toUpperCase()}]`;

    switch(level) {
      case 'debug':
        if (this.config.logLevel === 'debug') {
          console.log(`${prefix} ${message}`);
        }
        break;
      case 'info':
        console.log(`${prefix} ${message}`);
        break;
      case 'warn':
        console.warn(`${prefix} ${message}`);
        break;
      case 'error':
        console.error(`${prefix} ${message}`);
        break;
    }
  }
}

module.exports = Phase5System;
