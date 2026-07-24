/**
 * InstrumentedHeidiCoreLoop - Wraps HeidiCoreLoop with comprehensive telemetry
 *
 * Adds metrics collection without modifying the core loop logic.
 * All metric collection failures are silent (never interrupt the loop).
 */

const HeidiCoreLoop = require('../core/HeidiCoreLoop');
const MetricsCollector = require('./MetricsCollector');

class InstrumentedHeidiCoreLoop extends HeidiCoreLoop {
  constructor(config = {}) {
    super(config);

    this.metrics = new MetricsCollector(
      config.supabaseUrl,
      config.supabaseKey
    );

    this.telemetryConfig = {
      flushInterval: config.flushInterval || 60000, // Flush every minute
      enableDetailedMetrics: config.enableDetailedMetrics !== false,
      samplingRate: config.samplingRate || 1.0, // 1.0 = collect all, 0.1 = 10%
    };

    this.setupTelemetry();
  }

  setupTelemetry() {
    // Start periodic flush
    this.flushInterval = setInterval(() => {
      this.flushMetrics().catch(err => {
        console.error('[Telemetry] Flush error:', err.message);
      });
    }, this.telemetryConfig.flushInterval);

    // Instrument event listeners
    this.on('loop_completed', (event) => this.recordLoopComplete(event));
    this.on('loop_failed', (event) => this.recordLoopFailed(event));
    this.on('loop_started', () => this.recordLoopStarted());
    this.on('loop_stopped', () => this.recordLoopStopped());
  }

  /**
   * Override executeLoop to add instrumentation
   */
  async executeLoop(task) {
    const loopId = `loop_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      // Record start
      this.metrics.recordMetric(
        'loop_cycle',
        'heidi_core_loop_start',
        1,
        { task_type: task.type, loop_id: loopId },
        { priority: task.priority }
      );

      // Call parent executeLoop
      const result = await super.executeLoop(task);

      // Record success
      const duration = Date.now() - startTime;
      this.metrics.trackModuleCall('HeidiCoreLoop', true, duration, {
        task_type: task.type,
        loop_id: loopId,
      });

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.trackModuleCall('HeidiCoreLoop', false, duration, {
        task_type: task.type,
        loop_id: loopId,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Override executeHeidiLoop to instrument each phase
   */
  async executeHeidiLoop(task, loopId) {
    const phaseStartTime = Date.now();
    const phaseMetrics = {};

    try {
      // 1. OBSERVE
      const observeStart = Date.now();
      const observation = await this.observeForTask(task, loopId);
      const observeDuration = Date.now() - observeStart;
      phaseMetrics.observe = observeDuration;

      this.metrics.recordMetric(
        'loop_cycle',
        'heidi_observe_duration_ms',
        observeDuration,
        { task_type: task.type, phase: 'observe' }
      );

      // 2. EVALUATE
      const evaluateStart = Date.now();
      const evaluation = await this.evaluateTask(task, observation, loopId);
      const evaluateDuration = Date.now() - evaluateStart;
      phaseMetrics.evaluate = evaluateDuration;

      this.metrics.recordMetric(
        'loop_cycle',
        'heidi_evaluate_duration_ms',
        evaluateDuration,
        { task_type: task.type, phase: 'evaluate' },
        { confidence: evaluation.confidence, risk: evaluation.risk }
      );

      // 3. DECIDE
      const decideStart = Date.now();
      const decision = await this.makeDecision(task, observation, evaluation, loopId);
      const decideDuration = Date.now() - decideStart;
      phaseMetrics.decide = decideDuration;

      this.metrics.recordMetric(
        'loop_cycle',
        'heidi_decide_duration_ms',
        decideDuration,
        { task_type: task.type, phase: 'decide', decision: decision.action },
        { strategy: decision.strategy, confidence: decision.confidence }
      );

      // 4. ACT
      const actStart = Date.now();
      const action = await this.takeAction(task, decision, loopId);
      const actDuration = Date.now() - actStart;
      phaseMetrics.act = actDuration;

      const actionSuccess = action.success || false;
      this.metrics.recordMetric(
        'loop_cycle',
        'heidi_act_duration_ms',
        actDuration,
        { task_type: task.type, phase: 'act', success: actionSuccess.toString() }
      );

      // 5. MEASURE
      const measureStart = Date.now();
      const measurement = await this.measureResults(task, action, loopId);
      const measureDuration = Date.now() - measureStart;
      phaseMetrics.measure = measureDuration;

      this.metrics.recordMetric(
        'loop_cycle',
        'heidi_measure_duration_ms',
        measureDuration,
        { task_type: task.type, phase: 'measure', success: measurement.success.toString() },
        {
          quality: measurement.quality,
          impact: measurement.impact,
          user_satisfaction: measurement.userSatisfaction,
        }
      );

      // 6. REFLECT
      const reflectStart = Date.now();
      const reflection = await this.reflectOnLoop(task, observation, decision, measurement, loopId);
      const reflectDuration = Date.now() - reflectStart;
      phaseMetrics.reflect = reflectDuration;

      this.metrics.recordMetric(
        'loop_cycle',
        'heidi_reflect_duration_ms',
        reflectDuration,
        { task_type: task.type, phase: 'reflect' }
      );

      // 7. ADAPT
      const adaptStart = Date.now();
      const adaptation = await this.adaptStrategy(task, reflection, loopId);
      const adaptDuration = Date.now() - adaptStart;
      phaseMetrics.adapt = adaptDuration;

      this.metrics.recordMetric(
        'loop_cycle',
        'heidi_adapt_duration_ms',
        adaptDuration,
        { task_type: task.type, phase: 'adapt' },
        { adaptations_count: adaptation.adaptations?.length || 0 }
      );

      // Record total loop time
      const totalDuration = Date.now() - phaseStartTime;
      this.metrics.recordMetric(
        'loop_cycle',
        'heidi_full_loop_duration_ms',
        totalDuration,
        { task_type: task.type },
        { phase_breakdown: phaseMetrics }
      );

      // Call parent to get actual result
      const result = await super.executeHeidiLoop(task, loopId);
      return result;

    } catch (error) {
      const totalDuration = Date.now() - phaseStartTime;
      this.metrics.recordMetric(
        'loop_cycle',
        'heidi_loop_error',
        1,
        { task_type: task.type, error_type: error.name },
        { error_message: error.message, phase_breakdown: phaseMetrics }
      );
      throw error;
    }
  }

  /**
   * Instrument orchestrator task processing
   */
  async executeRevenueAction(task, decision, loopId) {
    const startTime = Date.now();
    try {
      const result = await super.executeRevenueAction(task, decision, loopId);
      const duration = Date.now() - startTime;

      this.metrics.recordMetric(
        'action',
        'heidi_revenue_action_duration_ms',
        duration,
        { subtype: task.subtype, success: 'true' }
      );

      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      this.metrics.recordMetric(
        'action',
        'heidi_revenue_action_error',
        1,
        { subtype: task.subtype, error: error.name }
      );
      throw error;
    }
  }

  /**
   * Track memory system performance
   */
  instrumentMemorySystem() {
    if (!this.memorySystem) return;

    const originalStoreContext = this.memorySystem.storeContext.bind(this.memorySystem);
    this.memorySystem.storeContext = (key, context) => {
      this.metrics.recordMetric(
        'memory',
        'heidi_memory_store_context',
        1,
        { operation: 'store_context', key }
      );
      return originalStoreContext(key, context);
    };

    const originalRetrieveContext = this.memorySystem.retrieveContext.bind(this.memorySystem);
    this.memorySystem.retrieveContext = (key) => {
      this.metrics.recordMetric(
        'memory',
        'heidi_memory_retrieve_context',
        1,
        { operation: 'retrieve_context', key }
      );
      return originalRetrieveContext(key);
    };

    const originalRunReflection = this.memorySystem.runReflection.bind(this.memorySystem);
    this.memorySystem.runReflection = async () => {
      const startTime = Date.now();
      const result = await originalRunReflection();
      const duration = Date.now() - startTime;

      this.metrics.recordMetric(
        'memory',
        'heidi_memory_reflection_duration_ms',
        duration,
        { operation: 'reflection' }
      );

      return result;
    };
  }

  /**
   * Track orchestrator task routing
   */
  instrumentOrchestrator() {
    if (!this.orchestrator) return;

    const originalProcessTask = this.orchestrator.processTask.bind(this.orchestrator);
    this.orchestrator.processTask = async (task) => {
      const startTime = Date.now();
      try {
        const result = await originalProcessTask(task);
        const duration = Date.now() - startTime;

        this.metrics.recordMetric(
          'decision',
          'heidi_orchestrator_routing_duration_ms',
          duration,
          { task_type: task.type },
          { strategy: result.decision?.strategy }
        );

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        this.metrics.recordMetric(
          'error',
          'heidi_orchestrator_routing_error',
          1,
          { task_type: task.type, error: error.name }
        );
        throw error;
      }
    };
  }

  /**
   * Record lifecycle events
   */
  recordLoopStarted() {
    this.metrics.recordMetric(
      'loop_cycle',
      'heidi_core_loop_start',
      1,
      { event: 'loop_started' }
    );
  }

  recordLoopStopped() {
    this.metrics.recordMetric(
      'loop_cycle',
      'heidi_core_loop_stop',
      1,
      { event: 'loop_stopped' }
    );
  }

  recordLoopComplete(event) {
    this.metrics.recordMetric(
      'loop_cycle',
      'heidi_core_loop_completion',
      1,
      { task_type: event.task?.type, duration_ms: event.duration },
      { loop_id: event.loopId }
    );
  }

  recordLoopFailed(event) {
    this.metrics.recordMetric(
      'error',
      'heidi_core_loop_failure',
      1,
      { task_type: event.task?.type, error: 'loop_failed' },
      { loop_id: event.loopId, error_message: event.error }
    );
  }

  /**
   * Flush metrics to database
   */
  async flushMetrics() {
    if (!this.metrics) return { success: false, error: 'No metrics collector' };

    try {
      const flushResult = await this.metrics.flush();

      if (flushResult.success) {
        console.log(`[Telemetry] Flushed ${flushResult.written} metrics`);

        // Also save a snapshot
        await this.metrics.saveSnapshot('automatic');

        // Record module performance
        await this.metrics.recordModulePerformance('HeidiCoreLoop');
      }

      return flushResult;
    } catch (error) {
      console.error('[Telemetry] Flush error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Shutdown - ensure metrics are flushed
   */
  async stop() {
    // Flush any remaining metrics
    if (this.metrics) {
      await this.flushMetrics();
    }

    // Clear interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    // Call parent stop
    return super.stop();
  }

  /**
   * Get telemetry status
   */
  getTelemetryStatus() {
    return {
      collecting: !!this.metrics,
      flushInterval: this.telemetryConfig.flushInterval,
      bufferedMetrics: this.metrics?.metrics?.length || 0,
      moduleStats: Array.from(this.metrics?.modulePerformance?.keys() || []).map(moduleName =>
        this.metrics.getModuleStats(moduleName)
      ),
    };
  }
}

module.exports = InstrumentedHeidiCoreLoop;
