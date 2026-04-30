/**
 * ProtoForge Unified Knowledge Base (UCL)
 * 
 * Single Source of Truth (SSOT) for all agents:
 * - All agents read from the same structured memory
 * - No agent invents its own worldview
 * - Heidi enforces consistency
 * - Vector memory for patterns and decisions
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

class UnifiedKnowledgeBase extends EventEmitter {
  constructor() {
    super();
    
    // Memory layers
    this.staticMemory = new Map(); // Identity, Mission, Architecture
    this.dynamicMemory = new Map(); // Tasks, Financials, Progress
    this.vectorMemory = new Map(); // Patterns, Decisions, Outcomes
    
    // Memory indexes for fast lookup
    this.conceptIndex = new Map();
    this.temporalIndex = new Map();
    this.agentIndex = new Map();
    
    // Consistency enforcement
    this.consistencyRules = new Map();
    this.memoryLocks = new Map();
    
    // Heidi as enforcer
    this.heidiEnforcer = true;
    
    // Memory metrics
    this.metrics = {
      totalEntries: 0,
      reads: 0,
      writes: 0,
      conflicts: 0,
      resolutions: 0
    };
    
    this.initializeCoreKnowledge();
    this.setupConsistencyRules();
    
    console.log('[UCL] Unified Knowledge Base initialized');
    console.log('[UCL] Heidi consistency enforcement: ACTIVE');
  }
  
  /**
   * Initialize core static knowledge
   */
  initializeCoreKnowledge() {
    // Identity Layer
    this.staticMemory.set('identity', {
      user: {
        name: 'J',
        role: 'Founder of ProtoForge',
        expertise: ['AI systems', 'hardware', 'fabrication', 'automation'],
        focus: ['modular design', 'neurotech', 'revenue systems'],
        traits: {
          systemsThinking: 'high',
          ideationSpeed: 'rapid',
          autonomyPreference: 'high',
          scalabilityFocus: 'high'
        },
        preferences: {
          friction: 'minimal',
          leverage: 'high',
          execution: 'parallel',
          implementation: 'real_world'
        },
        constraints: {
          revenueSpeed: 'fast',
          delegation: 'AI_required',
          systems: 'no_bloat'
        }
      },
      protoforge: {
        mission: 'Build modular, autonomous, revenue-generating systems',
        slogan: 'Design. Develop. Deliver.',
        domains: ['AI systems', 'robotics', 'modular_infrastructure', 'neurotech'],
        principles: ['autonomy', 'modularity', 'revenue_focus', 'scalability']
      },
      timestamp: Date.now(),
      source: 'core_init',
      immutable: true
    });
    
    // Systems Map
    this.staticMemory.set('systems', {
      primary: {
        heidi: {
          role: 'Executive orchestrator',
          function: 'Decision engine + system governor',
          authority: 'highest'
        },
        ursula: {
          role: 'Deep intelligence + analysis',
          function: 'Pattern recognition + strategic foresight',
          authority: 'strategic'
        },
        grind: {
          role: 'Execution pressure system',
          function: 'Productivity + behavioral push',
          authority: 'execution'
        },
        ventor: {
          role: 'Emotional + mental support',
          function: 'Context-aware responses',
          authority: 'support'
        },
        protohub: {
          role: 'Central interface',
          function: 'Dashboard + control system',
          authority: 'interface'
        }
      },
      infrastructure: {
        hq_type: 'container_based',
        architecture: 'rotational',
        operations: 'AI_managed',
        energy: 'hybrid_independence',
        revenue: 'facility_generating'
      },
      timestamp: Date.now(),
      source: 'core_init',
      immutable: true
    });
    
    // Financial Objectives
    this.staticMemory.set('financial_objectives', {
      short_term: {
        primary: 'immediate_cash_flow',
        secondary: 'multi_stream_revenue',
        timeline: '0-6_months'
      },
      mid_term: {
        primary: 'fund_hq_build',
        secondary: 'expand_services',
        timeline: '6-18_months'
      },
      long_term: {
        primary: 'self_sustaining_ecosystem',
        secondary: 'autonomous_operations',
        timeline: '18+_months'
      },
      timestamp: Date.now(),
      source: 'core_init',
      immutable: true
    });
    
    // Technology Stack
    this.staticMemory.set('tech_stack', {
      runtime: ['nodejs', 'python'],
      architecture: 'event_driven',
      orchestration: 'multi_agent',
      integration: ['cad', 'simulation', 'robotics', '3d_printing'],
      timestamp: Date.now(),
      source: 'core_init',
      immutable: true
    });
    
    // Behavioral Directives (GLOBAL)
    this.staticMemory.set('behavioral_directives', {
      global_rules: [
        'optimize_for_execution_over_discussion',
        'avoid_redundant_work',
        'communicate_via_event_system',
        'escalate_uncertainty'
      ],
      agent_principles: {
        autonomy: 'within_defined_boundaries',
        communication: 'structured_events_only',
        decision_making: 'data_driven',
        escalation: 'when_uncertainty_exceeds_threshold'
      },
      timestamp: Date.now(),
      source: 'core_init',
      immutable: true
    });
    
    console.log('[UCL] Core static knowledge loaded');
  }
  
  /**
   * Setup consistency rules
   */
  setupConsistencyRules() {
    // Identity consistency rules
    this.consistencyRules.set('identity', {
      validator: (data) => {
        return data.user && data.protoforge && data.systems;
      },
      action: 'reject_invalid_identity'
    });
    
    // Financial consistency rules
    this.consistencyRules.set('financial', {
      validator: (data) => {
        // Ensure financial data doesn't contradict objectives
        return this.validateFinancialConsistency(data);
      },
      action: 'flag_for_review'
    });
    
    // System consistency rules
    this.consistencyRules.set('systems', {
      validator: (data) => {
        // Ensure system changes align with mission
        return this.validateSystemConsistency(data);
      },
      action: 'heidi_review_required'
    });
    
    console.log('[UCL] Consistency rules established');
  }
  
  /**
   * Read from knowledge base
   */
  read(key, options = {}) {
    this.metrics.reads++;
    
    let result = null;
    
    // Search all memory layers
    result = this.staticMemory.get(key) ||
             this.dynamicMemory.get(key) ||
             this.vectorMemory.get(key);
    
    if (!result && options.fuzzy) {
      result = this.fuzzySearch(key);
    }
    
    // Log access pattern
    this.logAccess('read', key, result ? 'found' : 'not_found');
    
    return result;
  }
  
  /**
   * Write to knowledge base
   */
  write(key, data, options = {}) {
    // Check if key is locked (immutable)
    if (this.memoryLocks.has(key)) {
      throw new Error(`Memory key '${key}' is locked and immutable`);
    }
    
    // Check consistency rules
    const validationResult = this.validateConsistency(key, data);
    if (!validationResult.valid) {
      this.metrics.conflicts++;
      
      if (validationResult.action === 'reject') {
        throw new Error(`Consistency validation failed: ${validationResult.reason}`);
      } else if (validationResult.action === 'escalate') {
        return this.escalateInconsistency(key, data, validationResult);
      }
    }
    
    // Determine memory layer
    const layer = this.determineMemoryLayer(key, data, options);
    
    // Add metadata
    const enrichedData = {
      ...data,
      _metadata: {
        key,
        layer,
        timestamp: Date.now(),
        source: options.source || 'unknown',
        agent: options.agent || 'system',
        version: this.getNextVersion(key)
      }
    };
    
    // Write to appropriate layer
    switch (layer) {
      case 'static':
        this.staticMemory.set(key, enrichedData);
        break;
      case 'dynamic':
        this.dynamicMemory.set(key, enrichedData);
        break;
      case 'vector':
        this.vectorMemory.set(key, enrichedData);
        break;
    }
    
    // Update indexes
    this.updateIndexes(key, enrichedData);
    
    this.metrics.writes++;
    this.metrics.totalEntries++;
    
    // Log write
    this.logAccess('write', key, 'success');
    
    // Emit event
    this.emit('knowledge_updated', { key, data: enrichedData, layer });
    
    console.log(`[UCL] Written: ${key} -> ${layer}`);
    
    return enrichedData;
  }
  
  /**
   * Determine appropriate memory layer
   */
  determineMemoryLayer(key, data, options) {
    // Explicit layer specification
    if (options.layer) {
      return options.layer;
    }
    
    // Static memory for identity, mission, architecture
    if (key.includes('identity') || key.includes('mission') || key.includes('architecture')) {
      return 'static';
    }
    
    // Vector memory for patterns, decisions, outcomes
    if (key.includes('pattern') || key.includes('decision') || key.includes('outcome')) {
      return 'vector';
    }
    
    // Dynamic memory for everything else
    return 'dynamic';
  }
  
  /**
   * Validate consistency of data
   */
  validateConsistency(key, data) {
    for (const [ruleName, rule] of this.consistencyRules.entries()) {
      if (key.includes(ruleName) || ruleName === 'global') {
        if (!rule.validator(data)) {
          return {
            valid: false,
            rule: ruleName,
            reason: `Consistency rule '${ruleName}' violated`,
            action: rule.action
          };
        }
      }
    }
    
    return { valid: true };
  }
  
  /**
   * Validate financial consistency
   */
  validateFinancialConsistency(data) {
    const objectives = this.staticMemory.get('financial_objectives');
    if (!objectives) return true;
    
    // Check if financial data aligns with objectives
    if (data.burn_rate && data.burn_rate > objectives.short_term.burn_rate_threshold) {
      return false;
    }
    
    if (data.revenue_streams && data.revenue_streams.length < 1) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Validate system consistency
   */
  validateSystemConsistency(data) {
    const mission = this.staticMemory.get('identity')?.protoforge?.mission;
    if (!mission) return true;
    
    // Check if system changes align with mission
    if (data.changes && !data.changes.every(change => 
      this.alignsWithMission(change, mission)
    )) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Check if change aligns with mission
   */
  alignsWithMission(change, mission) {
    const missionKeywords = ['modular', 'autonomous', 'revenue', 'systems'];
    const changeText = JSON.stringify(change).toLowerCase();
    
    return missionKeywords.some(keyword => 
      changeText.includes(keyword.toLowerCase())
    );
  }
  
  /**
   * Escalate inconsistency to Heidi
   */
  async escalateInconsistency(key, data, validationResult) {
    const escalation = {
      id: uuidv4(),
      type: 'consistency_violation',
      key,
      data,
      rule: validationResult.rule,
      reason: validationResult.reason,
      timestamp: Date.now(),
      status: 'pending_heidi_review'
    };
    
    this.emit('consistency_escalation', escalation);
    
    console.log(`[UCL] Consistency escalation: ${key} - ${validationResult.reason}`);
    
    // In a real system, this would wait for Heidi's decision
    // For now, we'll log and reject
    throw new Error(`Consistency violation escalated: ${validationResult.reason}`);
  }
  
  /**
   * Fuzzy search for approximate matches
   */
  fuzzySearch(key) {
    const keyLower = key.toLowerCase();
    const candidates = [];
    
    // Search all memory layers
    const allKeys = [
      ...this.staticMemory.keys(),
      ...this.dynamicMemory.keys(),
      ...this.vectorMemory.keys()
    ];
    
    for (const candidateKey of allKeys) {
      if (candidateKey.toLowerCase().includes(keyLower) || 
          keyLower.includes(candidateKey.toLowerCase())) {
        candidates.push(candidateKey);
      }
    }
    
    // Return best match or null
    return candidates.length > 0 ? this.read(candidates[0]) : null;
  }
  
  /**
   * Update search indexes
   */
  updateIndexes(key, data) {
    // Concept index
    const concepts = this.extractConcepts(data);
    concepts.forEach(concept => {
      if (!this.conceptIndex.has(concept)) {
        this.conceptIndex.set(concept, []);
      }
      this.conceptIndex.get(concept).push(key);
    });
    
    // Temporal index
    const timestamp = data._metadata?.timestamp || Date.now();
    if (!this.temporalIndex.has(timestamp)) {
      this.temporalIndex.set(timestamp, []);
    }
    this.temporalIndex.get(timestamp).push(key);
    
    // Agent index
    const agent = data._metadata?.agent;
    if (agent) {
      if (!this.agentIndex.has(agent)) {
        this.agentIndex.set(agent, []);
      }
      this.agentIndex.get(agent).push(key);
    }
  }
  
  /**
   * Extract concepts from data
   */
  extractConcepts(data) {
    const concepts = [];
    const dataStr = JSON.stringify(data).toLowerCase();
    
    // Common concept patterns
    const conceptPatterns = [
      'autonomous', 'modular', 'revenue', 'system', 'agent',
      'financial', 'budget', 'expense', 'income',
      'design', 'architecture', 'construction',
      'energy', 'power', 'solar', 'wind',
      'container', 'rotating', 'facility'
    ];
    
    conceptPatterns.forEach(pattern => {
      if (dataStr.includes(pattern)) {
        concepts.push(pattern);
      }
    });
    
    return concepts;
  }
  
  /**
   * Get next version number for key
   */
  getNextVersion(key) {
    const existing = this.read(key);
    return existing ? (existing._metadata?.version || 0) + 1 : 1;
  }
  
  /**
   * Log access patterns
   */
  logAccess(type, key, result) {
    // In a real system, this would go to analytics
    // For now, just log important patterns
    if (type === 'read' && result === 'not_found') {
      console.log(`[UCL] Access pattern: Missing key '${key}'`);
    }
  }
  
  /**
   * Lock memory key (make immutable)
   */
  lockKey(key) {
    this.memoryLocks.set(key, true);
    console.log(`[UCL] Key locked: ${key}`);
  }
  
  /**
   * Unlock memory key
   */
  unlockKey(key) {
    this.memoryLocks.delete(key);
    console.log(`[UCL] Key unlocked: ${key}`);
  }
  
  /**
   * Get knowledge by concept
   */
  getByConcept(concept) {
    const keys = this.conceptIndex.get(concept) || [];
    return keys.map(key => this.read(key)).filter(Boolean);
  }
  
  /**
   * Get knowledge by time range
   */
  getByTimeRange(startTime, endTime) {
    const results = [];
    
    for (const [timestamp, keys] of this.temporalIndex.entries()) {
      if (timestamp >= startTime && timestamp <= endTime) {
        keys.forEach(key => {
          const data = this.read(key);
          if (data) results.push(data);
        });
      }
    }
    
    return results;
  }
  
  /**
   * Get knowledge by agent
   */
  getByAgent(agent) {
    const keys = this.agentIndex.get(agent) || [];
    return keys.map(key => this.read(key)).filter(Boolean);
  }
  
  /**
   * Get system status
   */
  getStatus() {
    return {
      memory: {
        static: this.staticMemory.size,
        dynamic: this.dynamicMemory.size,
        vector: this.vectorMemory.size,
        total: this.metrics.totalEntries
      },
      indexes: {
        concepts: this.conceptIndex.size,
        temporal: this.temporalIndex.size,
        agents: this.agentIndex.size
      },
      locks: this.memoryLocks.size,
      metrics: this.metrics,
      heidiEnforcer: this.heidiEnforcer
    };
  }
  
  /**
   * Export knowledge base
   */
  export() {
    return {
      static: Object.fromEntries(this.staticMemory),
      dynamic: Object.fromEntries(this.dynamicMemory),
      vector: Object.fromEntries(this.vectorMemory),
      indexes: {
        concepts: Object.fromEntries(this.conceptIndex),
        temporal: Object.fromEntries(this.temporalIndex),
        agents: Object.fromEntries(this.agentIndex)
      },
      metadata: {
        exportedAt: Date.now(),
        totalEntries: this.metrics.totalEntries,
        version: '1.0.0'
      }
    };
  }
  
  /**
   * Import knowledge base
   */
  import(data) {
    // Clear existing data
    this.staticMemory.clear();
    this.dynamicMemory.clear();
    this.vectorMemory.clear();
    
    // Import data
    Object.entries(data.static).forEach(([key, value]) => {
      this.staticMemory.set(key, value);
    });
    
    Object.entries(data.dynamic).forEach(([key, value]) => {
      this.dynamicMemory.set(key, value);
    });
    
    Object.entries(data.vector).forEach(([key, value]) => {
      this.vectorMemory.set(key, value);
    });
    
    // Rebuild indexes
    this.rebuildIndexes();
    
    console.log('[UCL] Knowledge base imported successfully');
  }
  
  /**
   * Rebuild all indexes
   */
  rebuildIndexes() {
    this.conceptIndex.clear();
    this.temporalIndex.clear();
    this.agentIndex.clear();
    
    const allData = [
      ...this.staticMemory.entries(),
      ...this.dynamicMemory.entries(),
      ...this.vectorMemory.entries()
    ];
    
    allData.forEach(([key, data]) => {
      this.updateIndexes(key, data);
    });
    
    console.log('[UCL] Indexes rebuilt');
  }
  
  /**
   * Enable/disable Heidi enforcement
   */
  setHeidiEnforcement(enabled) {
    this.heidiEnforcer = enabled;
    console.log(`[UCL] Heidi enforcement: ${enabled ? 'ENABLED' : 'DISABLED'}`);
  }
  
  /**
   * Get behavioral directives for an agent
   */
  getBehavioralDirectives(agentType = null) {
    const directives = this.read('behavioral_directives');
    
    if (!directives) {
      return null;
    }
    
    if (agentType) {
      // Filter directives relevant to agent type
      return {
        global_rules: directives.global_rules,
        agent_principles: directives.agent_principles,
        specific_rules: this.getAgentSpecificRules(agentType)
      };
    }
    
    return directives;
  }
  
  /**
   * Get agent-specific rules
   */
  getAgentSpecificRules(agentType) {
    const rules = {
      strategic: [
        'think_systemically',
        'consider_long_term_implications',
        'validate_against_mission'
      ],
      execution: [
        'focus_on_implementation',
        'minimize_delays',
        'coordinate_with_other_agents'
      ],
      business: [
        'protect_financial_health',
        'maximize_revenue_opportunities',
        'ensure_sustainable_growth'
      ],
      outreach: [
        'maintain_brand_consistency',
        'build_strategic_partnerships',
        'measure_roi'
      ],
      operations: [
        'prioritize_safety',
        'optimize_efficiency',
        'maintain_system_integrity'
      ]
    };
    
    return rules[agentType] || [];
  }
}

module.exports = UnifiedKnowledgeBase;
