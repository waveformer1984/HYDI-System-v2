// Heidi Intelligence Core - Powered by Cascade
require('dotenv').config();

class HeidiIntelligenceCore {
  constructor() {
    this.cascade = null;
    this.eventPipeline = null;
    this.selfAwarenessInterval = null;
    this.stats = {
      queriesProcessed: 0,
      queriesSuccessful: 0,
      avgConfidence: 0,
      totalConfidence: 0,
      kbHits: 0,
      contradictions: 0,
      lastActivity: null,
      startTime: new Date().toISOString()
    };
  }

  async initialize() {
    console.log('=== INITIALIZING HEIDI INTELLIGENCE CORE ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Phase 1: Connect to Cascade Truth Layer
      await this.connectToCascade();
      
      // Phase 2: Connect to Event Pipeline
      await this.connectToEventPipeline();
      
      // Phase 3: Start self-awareness loop
      await this.startSelfAwarenessLoop();
      
      console.log('=== HEIDI INTELLIGENCE CORE INITIALIZED ===');
      
      return {
        cascadeConnected: !!this.cascade,
        eventPipelineConnected: !!this.eventPipeline,
        knowledgeBaseSize: this.cascade.knowledgeBase.size
      };
      
    } catch (error) {
      console.log(`Heidi core initialization failed: ${error.message}`);
      throw error;
    }
  }

  async connectToCascade() {
    console.log('Phase 1: Connecting to Cascade Truth Layer...');
    
    const { CascadeTruthLayer } = require('./cascade-truth-layer');
    this.cascade = new CascadeTruthLayer();
    
    // Build truth layer if not exists
    try {
      const fs = require('fs');
      if (!fs.existsSync('cascade-truth-layer.json')) {
        await this.cascade.buildTruthLayer();
      } else {
        // Load existing truth layer
        const truthData = fs.readFileSync('cascade-truth-layer.json', 'utf8');
        const truthLayer = JSON.parse(truthData);
        
        // Reconstruct knowledge base
        this.cascade.knowledgeBase = new Map();
        truthLayer.knowledgeBase.forEach(item => {
          this.cascade.knowledgeBase.set(item.path, item);
        });
        
        // Reconstruct semantic groups
        this.cascade.semanticGroups.modules = new Set(truthLayer.semanticGroups.modules);
        this.cascade.semanticGroups.infrastructure = new Set(truthLayer.semanticGroups.infrastructure);
        this.cascade.semanticGroups.events = new Set(truthLayer.semanticGroups.events);
        this.cascade.semanticGroups.revenue = new Set(truthLayer.semanticGroups.revenue);
        this.cascade.semanticGroups.testing = new Set(truthLayer.semanticGroups.testing);
        this.cascade.semanticGroups.deployment = new Set(truthLayer.semanticGroups.deployment);
        
        this.cascade.contradictions = truthLayer.contradictions;
      }
    } catch (error) {
      console.log(`Failed to load Cascade truth layer: ${error.message}`);
      throw error;
    }
    
    console.log(`Connected to Cascade with ${this.cascade.knowledgeBase.size} knowledge entries`);
  }

  async connectToEventPipeline() {
    console.log('Phase 2: Connecting to Event Pipeline...');
    
    const { EventPipeline } = require('./event-pipeline');
    this.eventPipeline = new EventPipeline();
    await this.eventPipeline.initialize();
    
    console.log('Connected to Event Pipeline');
  }

  async startSelfAwarenessLoop() {
    console.log('Phase 3: Starting self-awareness loop...');
    
    this.selfAwarenessInterval = setInterval(() => {
      this.logSystemHealth().catch(error => {
        console.log(`Self-awareness loop error: ${error.message}`);
      });
    }, 30000); // 30 seconds
    
    console.log('Self-awareness loop started (30s interval)');
  }

  async process(query) {
    console.log(`Heidi processing query: "${query}"`);
    
    const startTime = Date.now();
    this.stats.lastActivity = new Date().toISOString();
    this.stats.queriesProcessed++;
    
    try {
      // Route through Cascade
      const cascadeResult = this.cascade.query(query);
      
      let response;
      let confidence;
      let contradictions = [];
      
      if (cascadeResult.results.length > 0) {
        // Got results from Cascade
        this.stats.kbHits++;
        contradictions = cascadeResult.contradictions;
        
        response = await this.generateResponse(query, cascadeResult);
        confidence = this.calculateConfidence(cascadeResult, contradictions);
        
        console.log(`Cascade hit: ${cascadeResult.results.length} results, confidence: ${confidence.toFixed(2)}`);
        
      } else {
        // Fallback to system scan
        console.log('No Cascade results, falling back to system scan...');
        
        const scanResults = await this.systemScan(query);
        response = await this.generateResponse(query, { results: scanResults });
        confidence = this.calculateConfidence({ results: scanResults }, []);
        
        console.log(`System scan: ${scanResults.length} results, confidence: ${confidence.toFixed(2)}`);
      }
      
      // Update stats
      this.stats.totalConfidence += confidence;
      this.stats.avgConfidence = this.stats.totalConfidence / this.stats.queriesProcessed;
      
      if (confidence > 0.3) {
        this.stats.queriesSuccessful++;
      }
      
      // Build structured response
      const heidiResponse = {
        summary: response.summary,
        reasoning: response.reasoning,
        sources: response.sources,
        contradictions: contradictions.map(c => ({
          concept: c.concept,
          files: [c.file1, c.file2],
          severity: c.similarity < 0.2 ? 'high' : c.similarity < 0.4 ? 'medium' : 'low'
        })),
        confidence,
        actions: response.actions,
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      
      // Emit event
      await this.emitHeidiResponse(query, heidiResponse);
      
      return heidiResponse;
      
    } catch (error) {
      console.log(`Query processing failed: ${error.message}`);
      
      const errorResponse = {
        summary: `I encountered an error processing your query: ${error.message}`,
        reasoning: 'System error occurred during processing',
        sources: [],
        contradictions: [],
        confidence: 0,
        actions: ['Try rephrasing your question', 'Check system health'],
        processingTime: Date.now() - startTime,
        timestamp: new Date().toISOString(),
        error: error.message
      };
      
      await this.emitHeidiResponse(query, errorResponse);
      
      return errorResponse;
    }
  }

  async generateResponse(query, cascadeResult) {
    const topResults = cascadeResult.results.slice(0, 5);
    
    if (topResults.length === 0) {
      return {
        summary: `I couldn't find any information about "${query}" in the system knowledge base.`,
        reasoning: 'No matching knowledge entries found',
        sources: [],
        actions: ['Try different keywords', 'Check if the topic exists in the system']
      };
    }
    
    const topResult = topResults[0];
    const knowledge = topResult.knowledge;
    
    // Generate summary
    let summary = `Based on the system knowledge, I found ${cascadeResult.results.length} relevant result${cascadeResult.results.length > 1 ? 's' : ''} about "${query}". `;
    
    if (knowledge.concepts.length > 0) {
      summary += `The key concepts involved are: ${knowledge.concepts.slice(0, 5).join(', ')}. `;
    }
    
    if (knowledge.functions.length > 0) {
      summary += `The system includes ${knowledge.functions.length} relevant function${knowledge.functions.length > 1 ? 's' : ''}: ${knowledge.functions.slice(0, 3).join(', ')}. `;
    }
    
    // Generate reasoning
    let reasoning = `I determined this answer by analyzing ${topResults.length} knowledge entries. `;
    reasoning += `The primary source (${knowledge.path}) has a relevance score of ${topResult.relevance.toFixed(2)} and a rank of ${topResult.rank.toFixed(2)}. `;
    
    if (cascadeResult.semanticGroups.length > 0) {
      reasoning += `This topic falls into the following categories: ${cascadeResult.semanticGroups.join(', ')}. `;
    }
    
    if (cascadeResult.contradictions.length > 0) {
      reasoning += `I detected ${cascadeResult.contradictions.length} potential contradictions in the knowledge base that may affect confidence. `;
    }
    
    // Generate sources
    const sources = topResults.map(result => ({
      file: result.filePath,
      relevance: result.relevance,
      rank: result.rank,
      type: result.knowledge.type,
      concepts: result.knowledge.concepts.slice(0, 5)
    }));
    
    // Generate actions
    const actions = this.generateActions(query, topResults, cascadeResult.semanticGroups);
    
    return {
      summary,
      reasoning,
      sources,
      actions
    };
  }

  calculateConfidence(cascadeResult, contradictions) {
    if (cascadeResult.results.length === 0) return 0;
    
    const topResult = cascadeResult.results[0];
    let confidence = 0;
    
    // Base confidence from relevance and rank
    confidence += Math.min(topResult.relevance, 1) * 0.3;
    confidence += Math.min(topResult.rank / 10, 1) * 0.2;
    
    // Boost for multiple strong sources
    const strongSources = cascadeResult.results.filter(r => r.relevance > 0.5);
    confidence += Math.min(strongSources.length / 5, 1) * 0.2;
    
    // Penalize for contradictions
    if (contradictions.length > 0) {
      const highSeverityContradictions = contradictions.filter(c => c.similarity < 0.3);
      confidence -= highSeverityContradictions.length * 0.15;
      confidence -= (contradictions.length - highSeverityContradictions.length) * 0.05;
    }
    
    // Boost for semantic coherence
    if (cascadeResult.semanticGroups.length > 0) {
      confidence += 0.1;
    }
    
    return Math.max(0, Math.min(1, confidence));
  }

  generateActions(query, results, semanticGroups) {
    const actions = [];
    
    // Add file-specific actions
    const topResult = results[0];
    const knowledge = topResult.knowledge;
    
    if (knowledge.functions.length > 0) {
      actions.push(`Run function: ${knowledge.functions[0]}`);
    }
    
    if (knowledge.events.length > 0) {
      actions.push(`Monitor events: ${knowledge.events[0]}`);
    }
    
    // Add semantic group actions
    if (semanticGroups.includes('infrastructure')) {
      actions.push('Check system infrastructure status');
      actions.push('Monitor server health');
    }
    
    if (semanticGroups.includes('events')) {
      actions.push('Check event pipeline status');
      actions.push('Monitor event throughput');
    }
    
    if (semanticGroups.includes('testing')) {
      actions.push('Run relevant tests');
      actions.push('Check test coverage');
    }
    
    if (semanticGroups.includes('deployment')) {
      actions.push('Check deployment status');
      actions.push('Review deployment logs');
    }
    
    // Add general actions
    actions.push('Search for related documentation');
    actions.push('Check system logs for recent activity');
    actions.push('Verify system health');
    
    return actions.slice(0, 6); // Limit to 6 actions
  }

  async systemScan(query) {
    // Simple fallback scan
    const fs = require('fs');
    const path = require('path');
    
    const results = [];
    const queryLower = query.toLowerCase();
    
    // Scan key files
    const keyFiles = [
      'cascade-truth-layer.json',
      'cascade-system-graph.json',
      'cascade-dependency-map.json'
    ];
    
    for (const fileName of keyFiles) {
      const filePath = path.join(process.cwd(), fileName);
      
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          
          if (content.toLowerCase().includes(queryLower)) {
            results.push({
              filePath: fileName,
              relevance: 0.5,
              knowledge: {
                path: fileName,
                type: 'json',
                concepts: [query],
                functions: [],
                events: []
              },
              rank: 0.5
            });
          }
        } catch (error) {
          console.log(`Error scanning ${fileName}: ${error.message}`);
        }
      }
    }
    
    return results;
  }

  async emitHeidiResponse(query, response) {
    console.log(`Emitting HEIDI response event...`);
    
    if (this.eventPipeline) {
      const event = {
        event_id: 'heidi-response-' + Date.now().toString(),
        type: 'heidi_response',
        source: 'heidi',
        timestamp: new Date().toISOString(),
        payload: {
          query,
          response: {
            summary: response.summary,
            reasoning: response.reasoning,
            confidence: response.confidence,
            sources: response.sources,
            contradictions: response.contradictions,
            actions: response.actions
          },
          processingTime: response.processingTime
        }
      };
      
      await this.eventPipeline.emit(event);
      console.log(`HEIDI response event emitted: ${event.event_id}`);
    }
  }

  async logSystemHealth() {
    console.log('=== HEIDI SYSTEM HEALTH ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Uptime: ${Math.round((Date.now() - new Date(this.stats.startTime).getTime()) / 1000 / 60)} minutes`);
    console.log(`Queries Processed: ${this.stats.queriesProcessed}`);
    console.log(`Queries Successful: ${this.stats.queriesSuccessful}`);
    console.log(`KB Hits: ${this.stats.kbHits}`);
    console.log(`Contradictions Detected: ${this.stats.contradictions}`);
    console.log(`Success Rate: ${this.stats.queriesProcessed > 0 ? (this.stats.queriesSuccessful / this.stats.queriesProcessed * 100).toFixed(1) : 0}%`);
    console.log(`KB Hit Rate: ${this.stats.queriesProcessed > 0 ? (this.stats.kbHits / this.stats.queriesProcessed * 100).toFixed(1) : 0}%`);
    console.log(`Avg Confidence: ${this.stats.avgConfidence.toFixed(2)}`);
    console.log(`Last Activity: ${this.stats.lastActivity || 'Never'}`);
    
    // Emit health status event
    if (this.eventPipeline) {
      const healthEvent = {
        event_id: 'heidi-health-' + Date.now().toString(),
        type: 'heidi_health',
        source: 'heidi',
        timestamp: new Date().toISOString(),
        payload: {
          health: {
            uptime: Math.round((Date.now() - new Date(this.stats.startTime).getTime()) / 1000 / 60),
            stats: this.stats,
            cascadeConnected: !!this.cascade,
            eventPipelineConnected: !!this.eventPipeline
          }
        }
      };
      
      await this.eventPipeline.emit(healthEvent);
    }
  }

  getStatus() {
    return {
      initialized: true,
      cascadeConnected: !!this.cascade,
      eventPipelineConnected: !!this.eventPipeline,
      knowledgeBaseSize: this.cascade ? this.cascade.knowledgeBase.size : 0,
      stats: this.stats,
      timestamp: new Date().toISOString()
    };
  }

  async shutdown() {
    console.log('Shutting down Heidi Intelligence Core...');
    
    if (this.selfAwarenessInterval) {
      clearInterval(this.selfAwarenessInterval);
      this.selfAwarenessInterval = null;
    }
    
    console.log('Heidi Intelligence Core shutdown complete');
  }
}

// CLI interface
if (require.main === module) {
  const heidi = new HeidiIntelligenceCore();
  
  const command = process.argv[2] || 'initialize';
  
  (async () => {
    switch (command) {
      case 'initialize':
        await heidi.initialize();
        
        // Keep running for interactive queries
        console.log('\nHeidi Intelligence Core is active. Type queries or press Ctrl+C to exit.');
        
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          prompt: 'Heidi> '
        });
        
        rl.on('line', async (input) => {
          if (input.trim() === '') {
            rl.prompt();
            return;
          }
          
          if (input.trim().toLowerCase() === 'exit') {
            await heidi.shutdown();
            rl.close();
            process.exit(0);
          }
          
          try {
            const response = await heidi.process(input);
            
            console.log('\n=== HEIDI RESPONSE ===');
            console.log(`Summary: ${response.summary}`);
            console.log(`Reasoning: ${response.reasoning}`);
            console.log(`Confidence: ${(response.confidence * 100).toFixed(1)}%`);
            console.log(`Sources: ${response.sources.length}`);
            response.sources.forEach((source, index) => {
              console.log(`  ${index + 1}. ${source.file} (relevance: ${source.relevance.toFixed(2)})`);
            });
            if (response.contradictions.length > 0) {
              console.log(`Contradictions: ${response.contradictions.length}`);
              response.contradictions.forEach((contradiction, index) => {
                console.log(`  ${index + 1}. ${contradiction.concept} (${contradiction.severity})`);
              });
            }
            console.log(`Actions: ${response.actions.length}`);
            response.actions.forEach((action, index) => {
              console.log(`  ${index + 1}. ${action}`);
            });
            console.log(`Processing Time: ${response.processingTime}ms`);
            console.log('========================\n');
            
          } catch (error) {
            console.log(`Error: ${error.message}`);
          }
          
          rl.prompt();
        });
        
        rl.on('close', () => {
          console.log('Goodbye!');
          heidi.shutdown();
          process.exit(0);
        });
        
        break;
        
      case 'query':
        const query = process.argv[3] || 'what is heidi';
        await heidi.initialize();
        const response = await heidi.process(query);
        console.log('Response:', JSON.stringify(response, null, 2));
        await heidi.shutdown();
        break;
        
      case 'status':
        const status = await heidi.getStatus();
        console.log('Heidi Status:', JSON.stringify(status, null, 2));
        break;
        
      default:
        console.log('Usage: node heidi-intelligence-core.js [initialize|query|status]');
    }
  })();
}

module.exports = { HeidiIntelligenceCore };
