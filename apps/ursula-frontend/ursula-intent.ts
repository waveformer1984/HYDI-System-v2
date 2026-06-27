/**
 * URSULA-INTENT LAYER
 * 
 * Parses user intent from Heidi/mobile
 * Classifies: revenue, ops, build, analysis
 */

import { EventEmitter } from 'events';

// Types
export type IntentType = "revenue" | "ops" | "build" | "analysis" | "unknown";

export interface ParsedIntent {
  type: IntentType;
  confidence: number;
  entities: Record<string, any>;
  parameters: Record<string, any>;
  rawInput: string;
  timestamp: Date;
}

export interface IntentEntity {
  type: string;
  value: any;
  confidence: number;
  start: number;
  end: number;
}

// Intent Patterns (lightweight, rule-based for now)
const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  revenue: [
    /\b(revenue|income|profit|earnings?|money|financial|budget|cost|pricing|sales|monetization)\b/i,
    /\b(how much|what is|show me|get|calculate|track)\s+(revenue|money|profit|income)\b/i,
    /\b(\$|dollar|amount|value|worth)\b/i
  ],
  ops: [
    /\b(run|start|stop|pause|execute|monitor|manage|control|handle|process)\b/i,
    /\b(task|job|process|operation|workflow|pipeline|system|service)\b/i,
    /\b(status|health|performance|metrics|logs|alerts)\b/i
  ],
  build: [
    /\b(build|deploy|create|make|generate|construct|develop|implement|setup)\b/i,
    /\b(system|architecture|infrastructure|application|service|api|component)\b/i,
    /\b(code|programming|development|testing|release|version)\b/i
  ],
  analysis: [
    /\b(analyze|review|audit|check|examine|investigate|diagnose|debug)\b/i,
    /\b(data|metrics|performance|trends|patterns|insights|reports)\b/i,
    /\b(why|how|what|when|where)\s+(.+)\b/i
  ],
  unknown: []
};

// Entity Extractors
const ENTITY_EXTRACTORS = {
  money: /\$?\d{1,3}(,\d{3})*(\.\d+)?/g,
  percentage: /\d+%/g,
  date: /\b\d{1,2}\/\d{1,2}\/\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/g,
  time: /\b\d{1,2}:\d{2}\s*(am|pm)?\b/g,
  numbers: /\b\d+(\.\d+)?\b/g,
  emails: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  urls: /https?:\/\/[^\s]+/g
};

export class UrsulaIntent extends EventEmitter {
  private patterns: Record<IntentType, RegExp[]>;
  private extractors: Record<string, RegExp>;
  
  constructor() {
    super();
    this.patterns = INTENT_PATTERNS;
    this.extractors = ENTITY_EXTRACTORS;
  }
  
  /**
   * Parse user input into structured intent
   */
  parseIntent(input: string): ParsedIntent {
    const timestamp = new Date();
    const entities = this.extractEntities(input);
    const { type, confidence } = this.classifyIntent(input);
    const parameters = this.extractParameters(input, type, entities);
    
    const intent: ParsedIntent = {
      type,
      confidence,
      entities,
      parameters,
      rawInput: input,
      timestamp
    };
    
    this.emit('intent:parsed', intent);
    
    return intent;
  }
  
  /**
   * Classify the primary intent type
   */
  private classifyIntent(input: string): { type: IntentType; confidence: number } {
    const scores: Record<IntentType, number> = {
      revenue: 0,
      ops: 0,
      build: 0,
      analysis: 0,
      unknown: 0
    };
    
    // Score each intent type based on pattern matches
    for (const [intentType, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        const matches = input.match(pattern);
        if (matches) {
          scores[intentType as IntentType] += matches.length * 0.3;
        }
      }
    }
    
    // Find the highest scoring intent
    let maxScore = 0;
    let bestType: IntentType = 'unknown';
    
    for (const [type, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        bestType = type as IntentType;
      }
    }
    
    // Normalize confidence
    const confidence = Math.min(maxScore, 1.0);
    
    return { type: bestType, confidence };
  }
  
  /**
   * Extract entities from the input
   */
  private extractEntities(input: string): Record<string, any> {
    const entities: Record<string, any> = {};
    
    for (const [entityType, pattern] of Object.entries(this.extractors)) {
      const matches = input.match(pattern);
      if (matches) {
        entities[entityType] = matches.map((match, index) => ({
          value: match,
          confidence: 0.9,
          start: input.indexOf(match),
          end: input.indexOf(match) + match.length,
          index
        }));
      }
    }
    
    return entities;
  }
  
  /**
   * Extract parameters specific to intent type
   */
  private extractParameters(input: string, intentType: IntentType, entities: Record<string, any>): Record<string, any> {
    const parameters: Record<string, any> = {};
    
    switch (intentType) {
      case 'revenue':
        // Extract financial parameters
        if (entities.money) {
          parameters.amount = entities.money[0]?.value;
        }
        if (entities.time) {
          parameters.timeframe = entities.time[0]?.value;
        }
        
        // Look for revenue-specific keywords
        if (input.includes('daily') || input.includes('today')) {
          parameters.period = 'daily';
        } else if (input.includes('weekly') || input.includes('week')) {
          parameters.period = 'weekly';
        } else if (input.includes('monthly') || input.includes('month')) {
          parameters.period = 'monthly';
        }
        
        // Look for revenue types
        if (input.includes('subscription') || input.includes('recurring')) {
          parameters.type = 'recurring';
        } else if (input.includes('one-time') || input.includes('single')) {
          parameters.type = 'one-time';
        }
        break;
        
      case 'ops':
        // Extract operational parameters
        if (input.includes('start') || input.includes('run')) {
          parameters.action = 'start';
        } else if (input.includes('stop') || input.includes('kill')) {
          parameters.action = 'stop';
        } else if (input.includes('pause') || input.includes('suspend')) {
          parameters.action = 'pause';
        } else if (input.includes('resume') || input.includes('continue')) {
          parameters.action = 'resume';
        } else if (input.includes('status') || input.includes('health')) {
          parameters.action = 'status';
        }
        
        // Extract task/process names
        const taskMatch = input.match(/(?:task|process|job|system)\s+["']?([^"'\s]+)["']?/i);
        if (taskMatch) {
          parameters.target = taskMatch[1];
        }
        break;
        
      case 'build':
        // Extract build parameters
        if (input.includes('deploy') || input.includes('release')) {
          parameters.action = 'deploy';
        } else if (input.includes('build') || input.includes('compile')) {
          parameters.action = 'build';
        } else if (input.includes('test')) {
          parameters.action = 'test';
        } else if (input.includes('setup') || input.includes('install')) {
          parameters.action = 'setup';
        }
        
        // Extract component names
        const componentMatch = input.match(/(?:component|service|api|system)\s+["']?([^"'\s]+)["']?/i);
        if (componentMatch) {
          parameters.component = componentMatch[1];
        }
        
        // Extract environment
        if (input.includes('production') || input.includes('prod')) {
          parameters.environment = 'production';
        } else if (input.includes('staging') || input.includes('stage')) {
          parameters.environment = 'staging';
        } else if (input.includes('development') || input.includes('dev')) {
          parameters.environment = 'development';
        }
        break;
        
      case 'analysis':
        // Extract analysis parameters
        if (input.includes('performance')) {
          parameters.focus = 'performance';
        } else if (input.includes('security') || input.includes('vulnerability')) {
          parameters.focus = 'security';
        } else if (input.includes('usage') || input.includes('analytics')) {
          parameters.focus = 'usage';
        } else if (input.includes('error') || input.includes('bug')) {
          parameters.focus = 'errors';
        }
        
        // Extract date range
        if (entities.date && entities.date.length >= 2) {
          parameters.dateRange = {
            start: entities.date[0].value,
            end: entities.date[1].value
          };
        } else if (entities.date && entities.date.length === 1) {
          parameters.dateRange = {
            start: entities.date[0].value,
            end: new Date().toISOString().split('T')[0]
          };
        }
        break;
    }
    
    return parameters;
  }
  
  /**
   * Batch parse multiple inputs
   */
  parseBatch(inputs: string[]): ParsedIntent[] {
    return inputs.map(input => this.parseIntent(input));
  }
  
  /**
   * Validate parsed intent
   */
  validateIntent(intent: ParsedIntent): boolean {
    // Check minimum confidence threshold
    if (intent.confidence < 0.3) {
      return false;
    }
    
    // Check required parameters for each intent type
    switch (intent.type) {
      case 'revenue':
        return true; // Revenue queries are generally flexible
      case 'ops':
        return !!intent.parameters.action;
      case 'build':
        return !!intent.parameters.action;
      case 'analysis':
        return true; // Analysis queries are generally flexible
      default:
        return false;
    }
  }
  
  /**
   * Get intent suggestions for ambiguous inputs
   */
  getIntentSuggestions(input: string): Array<{ type: IntentType; confidence: number; suggestion: string }> {
    const suggestions: Array<{ type: IntentType; confidence: number; suggestion: string }> = [];
    
    // Quick classification without full parsing
    const scores: Record<IntentType, number> = {
      revenue: 0,
      ops: 0,
      build: 0,
      analysis: 0,
      unknown: 0
    };
    
    for (const [intentType, patterns] of Object.entries(this.patterns)) {
      for (const pattern of patterns) {
        if (pattern.test(input)) {
          scores[intentType as IntentType] += 0.2;
        }
      }
    }
    
    // Generate suggestions for top 3 intents
    const sortedIntents = Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);
    
    for (const [type, score] of sortedIntents) {
      if (score > 0) {
        suggestions.push({
          type: type as IntentType,
          confidence: Math.min(score, 1.0),
          suggestion: this.generateSuggestion(type as IntentType, input)
        });
      }
    }
    
    return suggestions;
  }
  
  private generateSuggestion(type: IntentType, input: string): string {
    switch (type) {
      case 'revenue':
        return "Try: 'Show me revenue for today' or 'What's our monthly income?'";
      case 'ops':
        return "Try: 'Start the data processing task' or 'Check system status'";
      case 'build':
        return "Try: 'Build the payment service' or 'Deploy to staging'";
      case 'analysis':
        return "Try: 'Analyze performance metrics' or 'Check for security issues'";
      default:
        return "Try rephrasing your request";
    }
  }
}

// Export singleton instance
export const ursulaIntent = new UrsulaIntent();
