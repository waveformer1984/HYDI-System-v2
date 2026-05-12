// Hyve Activation Engine - Live Opportunity Engine
require('dotenv').config();

class HyveActivationEngine {
  constructor() {
    this.systemGraph = null;
    this.eventPipeline = null;
    this.validationRules = {
      requiredFields: ['event_id', 'type', 'source', 'timestamp', 'payload'],
      allowedTypes: ['ingest', 'process', 'heidi_response', 'system', 'error', 'hyve_opportunity_detected'],
      eventIdFormat: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    };
    this.hyveState = {
      intake: [],
      classified: [],
      monetizable: [],
      active: true,
      stats: {
        opportunitiesGenerated: 0,
        opportunitiesPassedToKilo: 0,
        pipelineLatency: 0,
        lastOpportunityTime: null,
        startTime: new Date().toISOString()
      }
    };
    this.sseBroker = null;
    this.feedbackInterval = null;
  }

  async initialize() {
    console.log('=== INITIALIZING HYVE ACTIVATION ENGINE ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Phase 1: Hard System Validation
      await this.hardSystemValidation();
      
      // Phase 2: Hyve Engine Initialization
      await this.hyveEngineInitialization();
      
      // Phase 3: Intelligence -> Opportunity Pipeline
      await this.intelligenceOpportunityPipeline();
      
      // Phase 4: Monetization Gate
      await this.monetizationGate();
      
      // Phase 5: Heidi Augmentation
      await this.heidiAugmentation();
      
      // Phase 6: Ursula (SSE) Enforcement
      await this.ursulaSSEEnforcement();
      
      // Phase 7: Feedback Loop
      await this.feedbackLoop();
      
      console.log('=== HYVE ACTIVATION ENGINE INITIALIZED ===');
      
      return {
        systemGraphLoaded: !!this.systemGraph,
        eventPipelineConnected: !!this.eventPipeline,
        sseBrokerConnected: !!this.sseBroker,
        hyveState: this.hyveState
      };
      
    } catch (error) {
      console.log(`Hyve activation engine initialization failed: ${error.message}`);
      throw error;
    }
  }

  async hardSystemValidation() {
    console.log('Phase 1: Hard System Validation');
    
    // Load and lock cascade-system-graph.json
    const fs = require('fs');
    
    try {
      const systemGraphData = fs.readFileSync('cascade-system-graph.json', 'utf8');
      this.systemGraph = JSON.parse(systemGraphData);
      console.log('System graph loaded and locked');
    } catch (error) {
      console.log('System graph not found, generating...');
      const { CascadeSystemGraph } = require('./cascade-system-graph');
      const graph = new CascadeSystemGraph();
      await graph.buildSystemGraph();
      this.systemGraph = graph.getSystemGraph().systemGraph;
    }
    
    // Connect to event pipeline
    const { EventPipeline } = require('./event-pipeline');
    this.eventPipeline = new EventPipeline();
    await this.eventPipeline.initialize();
    
    // Subscribe to all events for validation
    await this.eventPipeline.subscribe('hyve', async (event) => {
      await this.validateAndProcessEvent(event);
    });
    
    console.log('Hard system validation complete');
  }

  async hyveEngineInitialization() {
    console.log('Phase 2: Hyve Engine Initialization');
    
    // Create persistent Hyve state
    global.hyve = this.hyveState;
    
    // Save state to file
    const fs = require('fs');
    fs.writeFileSync('hyve-state.json', JSON.stringify(this.hyveState, null, 2));
    
    console.log('Hyve state initialized and persisted');
  }

  async intelligenceOpportunityPipeline() {
    console.log('Phase 3: Intelligence -> Opportunity Pipeline');
    
    // Subscribe to protoforge events
    await this.eventPipeline.subscribe('protoforge', async (event) => {
      await this.processIntelligenceEvent(event, 'protoforge');
    });
    
    // Subscribe to heidi events
    await this.eventPipeline.subscribe('heidi', async (event) => {
      await this.processIntelligenceEvent(event, 'heidi');
    });
    
    console.log('Intelligence pipeline subscribed to protoforge and heidi');
  }

  async monetizationGate() {
    console.log('Phase 4: Monetization Gate');
    
    // Set up opportunity scoring and generation
    this.opportunityScoring = {
      domains: ['AI', 'automation', 'SaaS', 'content', 'tooling'],
      types: ['TOOL', 'SERVICE', 'CONTENT', 'AUTOMATION'],
      scoringFactors: ['novelty', 'feasibility', 'revenuePotential', 'speedToMarket']
    };
    
    console.log('Monetization gate configured');
  }

  async heidiAugmentation() {
    console.log('Phase 5: Heidi Augmentation');
    
    // This would modify HEIDI response pipeline
    // For now, we'll intercept heidi_response events
    await this.eventPipeline.subscribe('heidi_response', async (event) => {
      await this.augmentHeidiResponse(event);
    });
    
    console.log('Heidi augmentation pipeline active');
  }

  async ursulaSSEEnforcement() {
    console.log('Phase 6: Ursula (SSE) Enforcement');
    
    // Connect to SSE broker
    const { KiloSSEBroker } = require('./kilo-sse-broker');
    this.sseBroker = new KiloSSEBroker();
    
    try {
      await this.sseBroker.establishEventFlow();
      console.log('SSE broker connection established');
    } catch (error) {
      console.log(`SSE broker connection failed: ${error.message}`);
      console.log('Continuing without SSE (non-blocking)');
    }
    
    console.log('Ursula SSE enforcement active');
  }

  async feedbackLoop() {
    console.log('Phase 7: Feedback Loop');
    
    // Start 30-second feedback loop
    this.feedbackInterval = setInterval(() => {
      this.emitHyveStatus().catch(error => {
        console.log(`Feedback loop error: ${error.message}`);
      });
    }, 30000);
    
    console.log('Feedback loop started (30s interval)');
  }

  async validateAndProcessEvent(event) {
    const validation = this.validateEvent(event);
    
    if (!validation.valid) {
      // Emit cascade_validation_event
      const validationEvent = {
        event_id: 'cascade-validation-' + Date.now().toString(),
        type: 'cascade_validation',
        source: 'hyve',
        timestamp: new Date().toISOString(),
        payload: {
          originalEvent: event.event_id || 'UNKNOWN',
          status: 'rejected',
          confidence: 0,
          errors: validation.errors
        }
      };
      
      await this.eventPipeline.emit(validationEvent);
      return false;
    }
    
    // Normalize event type
    event.type = this.normalizeEventType(event.type);
    
    // Add to hyve intake
    this.hyveState.intake.push({
      event,
      timestamp: new Date().toISOString(),
      validated: true
    });
    
    return true;
  }

  validateEvent(event) {
    const errors = [];
    
    // Check required fields
    for (const field of this.validationRules.requiredFields) {
      if (!event[field]) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    
    // Validate event_id format
    if (event.event_id && !this.validationRules.eventIdFormat.test(event.event_id)) {
      errors.push(`Invalid event_id format: ${event.event_id}`);
    }
    
    // Validate timestamp
    if (event.timestamp) {
      const timestamp = new Date(event.timestamp);
      if (isNaN(timestamp.getTime())) {
        errors.push(`Invalid timestamp: ${event.timestamp}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  normalizeEventType(type) {
    // Normalize to allowed types
    const normalized = type.toLowerCase().replace(/[^a-z_]/g, '_');
    
    if (this.validationRules.allowedTypes.includes(normalized)) {
      return normalized;
    }
    
    // Default to 'system' if not recognized
    return 'system';
  }

  async processIntelligenceEvent(event, source) {
    console.log(`Processing intelligence event from ${source}: ${event.event_id}`);
    
    // Extract semantic intent
    const intent = this.extractSemanticIntent(event);
    
    // Map domain
    const domain = this.mapDomain(intent);
    
    // Classify opportunity
    const opportunityType = this.classifyOpportunity(intent, domain);
    
    // Score opportunity
    const score = this.scoreOpportunity(intent, domain, opportunityType);
    
    // Create opportunity
    const opportunity = {
      event_id: event.event_id,
      source,
      intent,
      domain,
      type: opportunityType,
      score,
      timestamp: new Date().toISOString()
    };
    
    // Add to classified
    this.hyveState.classified.push(opportunity);
    
    // Check if monetizable
    if (score >= 0.7) {
      await this.generateMonetizableOpportunity(opportunity);
    }
  }

  extractSemanticIntent(event) {
    // Extract semantic intent from event payload
    const payload = event.payload || {};
    const text = JSON.stringify(payload).toLowerCase();
    
    const intent = {
      keywords: [],
      entities: [],
      actions: [],
      concepts: []
    };
    
    // Extract keywords (simple implementation)
    const keywords = ['automate', 'process', 'analyze', 'generate', 'monitor', 'optimize', 'integrate', 'deploy'];
    keywords.forEach(keyword => {
      if (text.includes(keyword)) {
        intent.keywords.push(keyword);
      }
    });
    
    // Extract entities
    const entities = ['api', 'database', 'service', 'tool', 'system', 'platform', 'application'];
    entities.forEach(entity => {
      if (text.includes(entity)) {
        intent.entities.push(entity);
      }
    });
    
    // Extract actions
    const actions = ['create', 'update', 'delete', 'read', 'execute', 'run', 'start', 'stop'];
    actions.forEach(action => {
      if (text.includes(action)) {
        intent.actions.push(action);
      }
    });
    
    // Extract concepts
    const concepts = ['ai', 'automation', 'saas', 'content', 'tooling', 'monitoring', 'analytics'];
    concepts.forEach(concept => {
      if (text.includes(concept)) {
        intent.concepts.push(concept);
      }
    });
    
    return intent;
  }

  mapDomain(intent) {
    // Map intent to domain
    if (intent.concepts.includes('ai')) return 'AI';
    if (intent.concepts.includes('automation')) return 'automation';
    if (intent.concepts.includes('saas')) return 'SaaS';
    if (intent.concepts.includes('content')) return 'content';
    if (intent.concepts.includes('tooling')) return 'tooling';
    
    // Fallback based on keywords
    if (intent.keywords.some(k => ['automate', 'process', 'optimize'].includes(k))) return 'automation';
    if (intent.keywords.some(k => ['analyze', 'monitor'].includes(k))) return 'AI';
    if (intent.entities.some(e => ['service', 'platform'].includes(e))) return 'SaaS';
    
    return 'general';
  }

  classifyOpportunity(intent, domain) {
    // Classify opportunity type
    if (intent.keywords.some(k => ['create', 'generate'].includes(k))) {
      if (domain === 'content') return 'CONTENT';
      if (domain === 'tooling') return 'TOOL';
    }
    
    if (intent.keywords.some(k => ['automate', 'process', 'optimize'].includes(k))) {
      return 'AUTOMATION';
    }
    
    if (intent.entities.some(e => ['service', 'platform', 'api'].includes(e))) {
      return 'SERVICE';
    }
    
    return 'TOOL'; // Default
  }

  scoreOpportunity(intent, domain, type) {
    // Score opportunity based on multiple factors
    let novelty = 0.5;
    let feasibility = 0.7;
    let revenuePotential = 0.6;
    let speedToMarket = 0.8;
    
    // Adjust based on domain
    switch (domain) {
      case 'AI':
        novelty += 0.3;
        revenuePotential += 0.2;
        break;
      case 'automation':
        feasibility += 0.2;
        speedToMarket += 0.1;
        break;
      case 'SaaS':
        revenuePotential += 0.3;
        feasibility -= 0.1;
        break;
    }
    
    // Adjust based on type
    switch (type) {
      case 'TOOL':
        feasibility += 0.2;
        speedToMarket += 0.2;
        break;
      case 'SERVICE':
        revenuePotential += 0.2;
        feasibility -= 0.1;
        break;
      case 'AUTOMATION':
        novelty += 0.1;
        revenuePotential += 0.1;
        break;
    }
    
    // Calculate final score
    const score = (novelty + feasibility + revenuePotential + speedToMarket) / 4;
    
    return Math.max(0, Math.min(1, score));
  }

  async generateMonetizableOpportunity(opportunity) {
    console.log(`Generating monetizable opportunity: ${opportunity.event_id}`);
    
    const monetizable = {
      opportunity_id: this.generateUUID(),
      title: this.generateTitle(opportunity),
      type: opportunity.type,
      execution_path: this.generateExecutionPath(opportunity),
      dependencies: this.generateDependencies(opportunity),
      estimated_value: this.estimateValue(opportunity),
      confidence: opportunity.score,
      source_event: opportunity.event_id,
      domain: opportunity.domain,
      created_at: new Date().toISOString()
    };
    
    // Push to monetizable
    this.hyveState.monetizable.push(monetizable);
    
    // Update stats
    this.hyveState.stats.opportunitiesGenerated++;
    this.hyveState.stats.lastOpportunityTime = new Date().toISOString();
    
    // Emit hyve_opportunity_detected
    const opportunityEvent = {
      event_id: 'hyve-opportunity-' + monetizable.opportunity_id,
      type: 'hyve_opportunity_detected',
      source: 'hyve',
      timestamp: new Date().toISOString(),
      payload: monetizable
    };
    
    await this.eventPipeline.emit(opportunityEvent);
    
    // Broadcast via SSE
    if (this.sseBroker) {
      this.sseBroker.emitEvent(opportunityEvent);
    }
    
    console.log(`Monetizable opportunity generated: ${monetizable.opportunity_id}`);
  }

  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  generateTitle(opportunity) {
    const templates = {
      'AI': ['AI-Powered {concept} Solution', 'Intelligent {entity} Automation', 'Smart {keyword} System'],
      'automation': ['Automated {keyword} Process', '{entity} Automation Tool', 'Streamlined {concept} Workflow'],
      'SaaS': ['Cloud-Based {entity} Platform', 'Scalable {concept} Service', 'Enterprise {keyword} Solution'],
      'content': ['Dynamic Content {keyword}', 'Automated {concept} Generation', 'Interactive {entity} Experience'],
      'tooling': ['Developer {keyword} Tool', '{entity} Management System', '{concept} Optimization Platform']
    };
    
    const domainTemplates = templates[opportunity.domain] || templates.tooling;
    const template = domainTemplates[Math.floor(Math.random() * domainTemplates.length)];
    
    // Replace placeholders
    let title = template;
    if (opportunity.intent.concepts.length > 0) {
      title = title.replace('{concept}', opportunity.intent.concepts[0]);
    }
    if (opportunity.intent.entities.length > 0) {
      title = title.replace('{entity}', opportunity.intent.entities[0]);
    }
    if (opportunity.intent.keywords.length > 0) {
      title = title.replace('{keyword}', opportunity.intent.keywords[0]);
    }
    
    return title;
  }

  generateExecutionPath(opportunity) {
    return [
      'research_and_validation',
      'prototype_development',
      'market_analysis',
      'mvp_deployment',
      'scaling_preparation'
    ];
  }

  generateDependencies(opportunity) {
    const dependencies = [];
    
    if (opportunity.domain === 'AI') {
      dependencies.push('ml_model_training', 'data_pipeline');
    }
    
    if (opportunity.type === 'SERVICE') {
      dependencies.push('api_development', 'infrastructure_setup');
    }
    
    if (opportunity.type === 'AUTOMATION') {
      dependencies.push('process_analysis', 'integration_testing');
    }
    
    return dependencies;
  }

  estimateValue(opportunity) {
    if (opportunity.score >= 0.9) return 'high';
    if (opportunity.score >= 0.7) return 'medium';
    return 'low';
  }

  async augmentHeidiResponse(event) {
    console.log(`Augmenting HEIDI response: ${event.event_id}`);
    
    // Add hyve opportunities to response
    const response = event.payload.response || {};
    
    if (this.hyveState.monetizable.length > 0) {
      response.hyve_opportunities = this.hyveState.monetizable.slice(-3); // Last 3 opportunities
    }
    
    // Ensure actionable output
    if (!response.actions || response.actions.length === 0) {
      response.actions = ['Review generated opportunities', 'Evaluate monetization potential'];
    }
    
    // Update event
    event.payload.response = response;
    
    // Re-emit augmented response
    await this.eventPipeline.emit(event);
    
    console.log('HEIDI response augmented with opportunities');
  }

  async emitHyveStatus() {
    console.log('Emitting Hyve status...');
    
    // Compute metrics
    const opportunitiesGenerated = this.hyveState.stats.opportunitiesGenerated;
    const opportunitiesPassedToKilo = this.hyveState.monetizable.length;
    const pipelineLatency = this.calculatePipelineLatency();
    
    // Determine pipeline health
    const pipelineHealth = this.determinePipelineHealth();
    
    const statusEvent = {
      event_id: 'hyve-status-' + Date.now().toString(),
      type: 'hyve_status',
      source: 'hyve',
      timestamp: new Date().toISOString(),
      payload: {
        pipeline_health: pipelineHealth,
        opportunity_count: opportunitiesGenerated,
        conversion_ready: opportunitiesPassedToKilo,
        pipeline_latency: pipelineLatency,
        stats: this.hyveState.stats
      }
    };
    
    await this.eventPipeline.emit(statusEvent);
    
    // Broadcast via SSE
    if (this.sseBroker) {
      this.sseBroker.emitEvent(statusEvent);
    }
    
    console.log(`Hyve status emitted: ${pipelineHealth}, ${opportunitiesGenerated} opportunities`);
  }

  calculatePipelineLatency() {
    // Simple latency calculation
    if (this.hyveState.stats.lastOpportunityTime) {
      const lastOpportunity = new Date(this.hyveState.stats.lastOpportunityTime);
      const now = new Date();
      return now - lastOpportunity;
    }
    return 0;
  }

  determinePipelineHealth() {
    const now = new Date();
    const lastOpportunity = this.hyveState.stats.lastOpportunityTime ? new Date(this.hyveState.stats.lastOpportunityTime) : null;
    
    if (!lastOpportunity) return 'degraded';
    
    const timeSinceLastOpportunity = now - lastOpportunity;
    const fiveMinutes = 5 * 60 * 1000;
    
    if (timeSinceLastOpportunity > fiveMinutes) return 'degraded';
    return 'ok';
  }

  getStatus() {
    return {
      initialized: true,
      systemGraphLoaded: !!this.systemGraph,
      eventPipelineConnected: !!this.eventPipeline,
      sseBrokerConnected: !!this.sseBroker,
      hyveState: this.hyveState,
      validationRules: this.validationRules,
      timestamp: new Date().toISOString()
    };
  }

  async shutdown() {
    console.log('Shutting down Hyve Activation Engine...');
    
    // Clear feedback interval
    if (this.feedbackInterval) {
      clearInterval(this.feedbackInterval);
      this.feedbackInterval = null;
    }
    
    // Save final state
    const fs = require('fs');
    fs.writeFileSync('hyve-state-final.json', JSON.stringify(this.hyveState, null, 2));
    
    console.log('Hyve Activation Engine shutdown complete');
  }
}

// CLI interface
if (require.main === module) {
  const hyve = new HyveActivationEngine();
  
  const command = process.argv[2] || 'activate';
  
  (async () => {
    switch (command) {
      case 'activate':
        await hyve.initialize();
        
        // Keep running
        console.log('\nHyve Activation Engine is running. Press Ctrl+C to stop.');
        
        process.on('SIGINT', async () => {
          console.log('\nShutting down...');
          await hyve.shutdown();
          process.exit(0);
        });
        
        // Keep process alive
        setInterval(() => {}, 10000);
        break;
        
      case 'status':
        const status = hyve.getStatus();
        console.log('Hyve Status:', JSON.stringify(status, null, 2));
        break;
        
      default:
        console.log('Usage: node hyve-activation-engine.js [activate|status]');
    }
  })();
}

module.exports = { HyveActivationEngine };
