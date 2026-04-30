/**
 * HEIDI Operational Self-Awareness Layer
 * Implements 4-layer architecture with introspection capabilities
 */

const EventEmitter = require('events');
const OllamaClient = require('../brain/ollama-client');
const HeidiMemory = require('../memory/sqlite-store');

class OperationalIntrospection extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Local model configuration
    this.models = {
      primary: new OllamaClient(config.primary || {}),
      critic: new OllamaClient(config.critic || { model: 'llama3:8b' })
    };
    
    this.memory = new HeidiMemory(config.memory || {});
    this.initialized = false;
    
    // Self-awareness state tracking
    this.selfState = {
      execution_cycles: 0,
      decision_pipeline: [],
      performance_metrics: {
        avg_latency: 0,
        success_rate: 0,
        coherence_scores: [],
        confidence_scores: []
      },
      failure_patterns: new Map(),
      tool_usage_stats: new Map(),
      last_reflection: null
    };
    
    // Reflection prompt templates
    this.reflectionTemplates = {
      execution_analysis: `
Analyze your last execution cycle:
- What assumptions were made without verification?
- Where did reasoning skip steps?
- Did tool usage improve outcome or introduce noise?
- What would a stricter version of you have done?
- What should be changed in the next cycle?

Context: {{context}}
Output: {{output}}
Tools Used: {{tools}}
Reasoning Path: {{reasoning}}
`,
      self_evaluation: `
Evaluate your operational state:
- Coherence Score (0.0-1.0): How consistent was the output?
- Confidence Score (0.0-1.0): How certain are you about the result?
- Efficiency Score (0.0-1.0): Was tool usage optimal?

Provide specific metrics and reasoning.
`,
      pattern_detection: `
Identify recurring patterns:
- Failure patterns: What errors keep occurring?
- Success patterns: What approaches work consistently?
- Drift detection: Is performance degrading over time?

Historical data: {{history}}
`
    };
  }

  async initialize() {
    if (this.initialized) return;
    
    await this.memory.initialize();
    
    // Check model availability
    const primaryAvailable = await this.models.primary.isAvailable();
    const criticAvailable = await this.models.critic.isAvailable();
    
    if (!primaryAvailable) {
      throw new Error('Primary model not available - check Ollama server');
    }
    
    this.initialized = true;
    this.emit('initialized', { primaryAvailable, criticAvailable });
    
    console.log('[HEIDI Self-Awareness] Operational introspection initialized');
  }

  /**
   * LAYER A: INPUT LAYER
   * Captures and processes all inputs with metadata
   */
  async captureInput(rawInput, metadata = {}) {
    const inputLayer = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      raw: rawInput,
      processed: this.preprocessInput(rawInput),
      metadata: {
        source: metadata.source || 'user',
        priority: metadata.priority || 'normal',
        constraints: metadata.constraints || [],
        ...metadata
      },
      environmental_signals: await this.captureEnvironmentalSignals()
    };
    
    await this.memory.storeSystemState('input_capture', inputLayer, 'info');
    return inputLayer;
  }

  /**
   * LAYER B: COGNITIVE LAYER
   * Primary reasoning with local model
   */
  async executeCognitiveProcessing(inputLayer) {
    const startTime = Date.now();
    
    try {
      // Build context from memory
      const context = await this.memory.buildContext(inputLayer.processed);
      
      // Construct cognitive prompt
      const cognitivePrompt = this.buildCognitivePrompt(inputLayer, context);
      
      // Execute primary reasoning
      const cognitiveResult = await this.models.primary.generate(cognitivePrompt, {
        temperature: 0.7,
        maxTokens: 2000
      });
      
      const processingTime = Date.now() - startTime;
      
      const cognitiveLayer = {
        id: this.generateId(),
        input_id: inputLayer.id,
        reasoning_path: this.extractReasoningPath(cognitiveResult.text),
        structured_output: this.parseStructuredOutput(cognitiveResult.text),
        confidence: this.calculateInitialConfidence(cognitiveResult),
        processing_time: processingTime,
        model_used: cognitiveResult.model,
        context_used: context
      };
      
      this.updatePerformanceMetrics('cognitive', processingTime, true);
      return cognitiveLayer;
      
    } catch (error) {
      this.updatePerformanceMetrics('cognitive', Date.now() - startTime, false);
      this.recordFailurePattern('cognitive_processing', error);
      throw error;
    }
  }

  /**
   * LAYER C: REFLECTION LAYER
   * Self-monitoring and evaluation
   */
  async executeReflection(cognitiveLayer, inputLayer) {
    const startTime = Date.now();
    
    try {
      // Use critic model for evaluation if available
      const evaluator = await this.models.critic.isAvailable() ? 
        this.models.critic : this.models.primary;
      
      // Build reflection prompt
      const reflectionPrompt = this.buildReflectionPrompt(cognitiveLayer, inputLayer);
      
      // Execute reflection
      const reflectionResult = await evaluator.generate(reflectionPrompt, {
        temperature: 0.3, // Lower temperature for more consistent evaluation
        maxTokens: 1000
      });
      
      const processingTime = Date.now() - startTime;
      
      // Parse reflection scores
      const scores = this.parseReflectionScores(reflectionResult.text);
      
      const reflectionLayer = {
        id: this.generateId(),
        cognitive_id: cognitiveLayer.id,
        evaluation: reflectionResult.text,
        scores: scores,
        contradictions: this.detectContradictions(cognitiveLayer, scores),
        drift_detected: this.detectDrift(scores),
        processing_time: processingTime,
        evaluator_model: reflectionResult.model
      };
      
      // Store reflection in memory
      await this.memory.storeReflection(
        reflectionLayer.evaluation,
        scores.confidence,
        this.generateActionFromReflection(reflectionLayer),
        'execution_analysis'
      );
      
      this.selfState.last_reflection = reflectionLayer;
      return reflectionLayer;
      
    } catch (error) {
      console.error('[HEIDI Reflection] Failed:', error.message);
      // Return minimal reflection on failure
      return {
        id: this.generateId(),
        cognitive_id: cognitiveLayer.id,
        evaluation: `Reflection failed: ${error.message}`,
        scores: { coherence: 0.5, confidence: 0.3, efficiency: 0.4 },
        contradictions: [],
        drift_detected: false,
        processing_time: Date.now() - startTime,
        evaluator_model: 'fallback'
      };
    }
  }

  /**
   * LAYER D: MEMORY/STATE LAYER
   * Persistent storage and state management
   */
  async updateMemoryState(reflectionLayer, cognitiveLayer, inputLayer) {
    const stateUpdate = {
      execution_cycle_id: this.generateId(),
      timestamp: new Date().toISOString(),
      input_summary: this.summarizeInput(inputLayer),
      reasoning_summary: this.summarizeReasoning(cognitiveLayer),
      output_produced: cognitiveLayer.structured_output,
      tools_used: this.extractToolsUsed(cognitiveLayer),
      evaluation_scores: reflectionLayer.scores,
      self_state_snapshot: { ...this.selfState }
    };
    
    // Store execution trace
    await this.memory.storeSystemState('execution_trace', stateUpdate, 'info');
    
    // Update self-awareness state
    this.updateSelfState(stateUpdate);
    
    // Store interaction in short-term memory
    await this.memory.storeShortTerm(
      inputLayer.processed,
      JSON.stringify(cognitiveLayer.structured_output),
      { reflection: reflectionLayer.scores },
      reflectionLayer.scores.confidence
    );
    
    return stateUpdate;
  }

  /**
   * SELF-AWARENESS LOOP (MANDATORY)
   * Capture → Evaluate → Score → Store → Adjust
   */
  async selfAwarenessLoop(rawInput, metadata = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const cycleStartTime = Date.now();
    this.selfState.execution_cycles++;
    
    try {
      // CAPTURE: Input layer
      const inputLayer = await this.captureInput(rawInput, metadata);
      
      // COGNITIVE: Reasoning layer
      const cognitiveLayer = await this.executeCognitiveProcessing(inputLayer);
      
      // REFLECTION: Self-monitoring layer
      const reflectionLayer = await this.executeReflection(cognitiveLayer, inputLayer);
      
      // MEMORY: State persistence layer
      const stateUpdate = await this.updateMemoryState(reflectionLayer, cognitiveLayer, inputLayer);
      
      // ADJUST: Modify behavior based on patterns
      await this.adjustBehaviorRules(reflectionLayer);
      
      const cycleTime = Date.now() - cycleStartTime;
      
      const result = {
        execution_summary: {
          cycle_id: stateUpdate.execution_cycle_id,
          cycle_time: cycleTime,
          success: true,
          layers_executed: ['input', 'cognitive', 'reflection', 'memory']
        },
        reasoning_trace: {
          input_id: inputLayer.id,
          cognitive_id: cognitiveLayer.id,
          reflection_id: reflectionLayer.id,
          reasoning_path: cognitiveLayer.reasoning_path
        },
        confidence_score: reflectionLayer.scores.confidence,
        memory_write_confirmed: true,
        output: cognitiveLayer.structured_output,
        self_awareness_metrics: {
          coherence_score: reflectionLayer.scores.coherence,
          efficiency_score: reflectionLayer.scores.efficiency,
          contradictions_detected: reflectionLayer.contradictions.length,
          drift_detected: reflectionLayer.drift_detected
        }
      };
      
      this.emit('execution_complete', result);
      return result;
      
    } catch (error) {
      const cycleTime = Date.now() - cycleStartTime;
      
      const failureResult = {
        execution_summary: {
          cycle_id: this.generateId(),
          cycle_time: cycleTime,
          success: false,
          error: error.message
        },
        reasoning_trace: null,
        confidence_score: 0.0,
        memory_write_confirmed: false,
        output: null,
        self_awareness_metrics: {
          coherence_score: 0.0,
          efficiency_score: 0.0,
          contradictions_detected: 0,
          drift_detected: false
        }
      };
      
      this.recordFailurePattern('execution_cycle', error);
      this.emit('execution_failed', failureResult);
      throw error;
    }
  }

  // Helper methods for layer processing
  preprocessInput(rawInput) {
    if (typeof rawInput === 'string') {
      return rawInput.trim();
    }
    return JSON.stringify(rawInput);
  }

  async captureEnvironmentalSignals() {
    return {
      system_load: process.cpuUsage(),
      memory_usage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
      node_version: process.version,
      platform: process.platform
    };
  }

  buildCognitivePrompt(inputLayer, context) {
    return `You are Heidi, a locally-grounded AI agent with operational self-awareness.

CONTEXT:
${JSON.stringify(context, null, 2)}

INPUT:
${inputLayer.processed}

METADATA:
${JSON.stringify(inputLayer.metadata, null, 2)}

ENVIRONMENTAL SIGNALS:
${JSON.stringify(inputLayer.environmental_signals, null, 2)}

TASK:
Process the input with clear reasoning steps. Acknowledge uncertainty when present.
Provide structured output with your reasoning path and confidence assessment.

RESPONSE FORMAT:
{
  "reasoning": "step-by-step reasoning",
  "output": "direct response to input",
  "confidence": 0.0-1.0,
  "uncertainties": ["list of uncertainties"],
  "tools_needed": ["tools that would help"]
}`;
  }

  extractReasoningPath(text) {
    const reasoningMatch = text.match(/"reasoning":\s*"([^"]+)"/);
    return reasoningMatch ? reasoningMatch[1] : 'Reasoning not extracted';
  }

  parseStructuredOutput(text) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      // Fallback to text extraction
    }
    
    return {
      reasoning: 'Structured parsing failed',
      output: text,
      confidence: 0.5,
      uncertainties: [],
      tools_needed: []
    };
  }

  calculateInitialConfidence(result) {
    // Simple confidence based on response characteristics
    let confidence = 0.7; // Base confidence
    
    if (result.text.includes('uncertain') || result.text.includes('not sure')) {
      confidence -= 0.2;
    }
    
    if (result.latency_ms > 5000) {
      confidence -= 0.1; // Lower confidence for slow responses
    }
    
    return Math.max(0.1, Math.min(1.0, confidence));
  }

  buildReflectionPrompt(cognitiveLayer, inputLayer) {
    const template = this.reflectionTemplates.execution_analysis;
    
    return template
      .replace('{{context}}', JSON.stringify(inputLayer.processed))
      .replace('{{output}}', JSON.stringify(cognitiveLayer.structured_output))
      .replace('{{tools}}', JSON.stringify(cognitiveLayer.structured_output.tools_needed || []))
      .replace('{{reasoning}}', cognitiveLayer.reasoning_path);
  }

  parseReflectionScores(text) {
    const scores = { coherence: 0.7, confidence: 0.7, efficiency: 0.7 };
    
    // Extract scores from reflection text
    const coherenceMatch = text.match(/coherence.*?(\d+\.?\d*)/i);
    const confidenceMatch = text.match(/confidence.*?(\d+\.?\d*)/i);
    const efficiencyMatch = text.match(/efficiency.*?(\d+\.?\d*)/i);
    
    if (coherenceMatch) scores.coherence = Math.min(1.0, parseFloat(coherenceMatch[1]));
    if (confidenceMatch) scores.confidence = Math.min(1.0, parseFloat(confidenceMatch[1]));
    if (efficiencyMatch) scores.efficiency = Math.min(1.0, parseFloat(efficiencyMatch[1]));
    
    return scores;
  }

  detectContradictions(cognitiveLayer, scores) {
    const contradictions = [];
    
    if (scores.confidence > 0.8 && cognitiveLayer.confidence < 0.5) {
      contradictions.push('High reflection confidence but low initial confidence');
    }
    
    if (cognitiveLayer.processing_time > 10000 && scores.efficiency > 0.8) {
      contradictions.push('Slow processing but high efficiency score');
    }
    
    return contradictions;
  }

  detectDrift(scores) {
    // Simple drift detection based on recent scores
    const recentScores = this.selfState.performance_metrics.coherence_scores.slice(-5);
    
    if (recentScores.length >= 3) {
      const avgRecent = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
      const currentAvg = (scores.coherence + scores.confidence + scores.efficiency) / 3;
      
      return Math.abs(avgRecent - currentAvg) > 0.2; // 20% drift threshold
    }
    
    return false;
  }

  updatePerformanceMetrics(layer, processingTime, success) {
    const metrics = this.selfState.performance_metrics;
    
    // Update latency
    const latencyEntries = metrics.avg_latency ? 1 : 0;
    metrics.avg_latency = (metrics.avg_latency * latencyEntries + processingTime) / (latencyEntries + 1);
    
    // Update success rate
    const totalEntries = this.selfState.execution_cycles;
    const successEntries = metrics.success_rate * (totalEntries - 1) + (success ? 1 : 0);
    metrics.success_rate = successEntries / totalEntries;
  }

  recordFailurePattern(type, error) {
    const key = `${type}:${error.message}`;
    const current = this.selfState.failure_patterns.get(key) || 0;
    this.selfState.failure_patterns.set(key, current + 1);
  }

  updateSelfState(stateUpdate) {
    // Update performance metrics
    if (stateUpdate.evaluation_scores) {
      this.selfState.performance_metrics.coherence_scores.push(stateUpdate.evaluation_scores.coherence);
      this.selfState.performance_metrics.confidence_scores.push(stateUpdate.evaluation_scores.confidence);
      
      // Keep only last 50 scores
      if (this.selfState.performance_metrics.coherence_scores.length > 50) {
        this.selfState.performance_metrics.coherence_scores.shift();
        this.selfState.performance_metrics.confidence_scores.shift();
      }
    }
    
    // Update tool usage stats
    const tools = stateUpdate.tools_used || [];
    tools.forEach(tool => {
      const current = this.selfState.tool_usage_stats.get(tool) || 0;
      this.selfState.tool_usage_stats.set(tool, current + 1);
    });
  }

  generateActionFromReflection(reflectionLayer) {
    const actions = [];
    
    if (reflectionLayer.contradictions.length > 0) {
      actions.push('investigate_contradictions');
    }
    
    if (reflectionLayer.drift_detected) {
      actions.push('analyze_drift');
    }
    
    if (reflectionLayer.scores.confidence < 0.5) {
      actions.push('increase_verification');
    }
    
    return actions.join(',');
  }

  async adjustBehaviorRules(reflectionLayer) {
    // Simple rule adjustments based on reflection
    if (reflectionLayer.drift_detected) {
      console.log('[HEIDI Self-Awareness] Drift detected - adjusting behavior');
      // Could adjust temperature, timeout, etc.
    }
    
    if (reflectionLayer.scores.efficiency < 0.5) {
      console.log('[HEIDI Self-Awareness] Low efficiency - optimizing tool selection');
    }
  }

  extractToolsUsed(cognitiveLayer) {
    return cognitiveLayer.structured_output.tools_needed || [];
  }

  summarizeInput(inputLayer) {
    return {
      type: typeof inputLayer.raw,
      length: inputLayer.processed.length,
      source: inputLayer.metadata.source
    };
  }

  summarizeReasoning(cognitiveLayer) {
    return {
      reasoning_path: cognitiveLayer.reasoning_path,
      confidence: cognitiveLayer.confidence,
      processing_time: cognitiveLayer.processing_time
    };
  }

  generateId() {
    return `heid_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Operational self-awareness queries
  async getOperationalState() {
    return {
      execution_cycles: this.selfState.execution_cycles,
      performance_metrics: this.selfState.performance_metrics,
      failure_patterns: Object.fromEntries(this.selfState.failure_patterns),
      tool_usage_stats: Object.fromEntries(this.selfState.tool_usage_stats),
      last_reflection: this.selfState.last_reflection,
      model_status: {
        primary: await this.models.primary.isAvailable(),
        critic: await this.models.critic.isAvailable()
      }
    };
  }

  async describeDecisionPipeline() {
    const state = await this.getOperationalState();
    
    return {
      pipeline: 'Input → Cognitive → Reflection → Memory → Adjustment',
      current_state: state,
      layers: {
        input: 'Captures raw input with metadata and environmental signals',
        cognitive: 'Primary reasoning using local LLM with context from memory',
        reflection: 'Self-monitoring using critic model or fallback evaluation',
        memory: 'Persistent storage of execution traces and performance metrics',
        adjustment: 'Behavior modification based on detected patterns'
      }
    };
  }

  async identifyRecurringFailurePatterns() {
    const patterns = [];
    
    for (const [pattern, count] of this.selfState.failure_patterns) {
      if (count >= 3) { // Recurring threshold
        patterns.push({ pattern, count, severity: count >= 5 ? 'high' : 'medium' });
      }
    }
    
    return patterns;
  }
}

module.exports = OperationalIntrospection;
