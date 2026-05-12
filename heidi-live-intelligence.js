// HEIDI Live Intelligence Engine - Connected to Cascade KB
require('dotenv').config();

class HeidiLiveIntelligence {
  constructor() {
    this.cascadeIndex = null;
    this.eventPipeline = null;
    this.stats = {
      queriesProcessed: 0,
      queriesSuccessful: 0,
      kbHits: 0,
      systemScans: 0,
      avgConfidence: 0,
      totalConfidence: 0,
      lastActivity: null,
      startTime: new Date().toISOString()
    };
    this.monitoring = false;
    this.monitorInterval = null;
  }

  async activate() {
    console.log('=== ACTIVATING HEIDI LIVE INTELLIGENCE ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Connect to Cascade KB
      await this.connectToCascadeKB();
      
      // Connect to Event Pipeline
      await this.connectToEventPipeline();
      
      // Start self-awareness loop
      await this.startSelfAwarenessLoop();
      
      console.log('=== HEIDI LIVE INTELLIGENCE ACTIVATED ===');
      
      return {
        status: 'activated',
        kbConnected: !!this.cascadeIndex,
        eventPipelineConnected: !!this.eventPipeline,
        monitoringActive: this.monitoring
      };
      
    } catch (error) {
      console.log(`HEIDI activation failed: ${error.message}`);
      throw error;
    }
  }

  async connectToCascadeKB() {
    console.log('Connecting to Cascade Knowledge Base...');
    
    const fs = require('fs');
    const path = require('path');
    
    const indexPath = path.join(process.cwd(), 'cascade-index.json');
    
    if (fs.existsSync(indexPath)) {
      const indexData = fs.readFileSync(indexPath, 'utf8');
      const index = JSON.parse(indexData);
      
      this.cascadeIndex = index.index;
      console.log(`Connected to Cascade KB: ${Object.keys(this.cascadeIndex).length} tokens`);
      
    } else {
      throw new Error('Cascade index not found. Run cascade-knowledge-expansion.js first.');
    }
  }

  async connectToEventPipeline() {
    console.log('Connecting to Event Pipeline...');
    
    const { EventPipeline } = require('./event-pipeline');
    this.eventPipeline = new EventPipeline();
    
    await this.eventPipeline.initialize();
    console.log('Connected to Event Pipeline');
  }

  async startSelfAwarenessLoop() {
    console.log('Starting self-awareness loop...');
    
    this.monitoring = true;
    this.monitorInterval = setInterval(() => {
      this.logSystemHealth().catch(error => {
        console.log(`Self-awareness loop error: ${error.message}`);
      });
    }, 30000); // 30 seconds
    
    console.log('Self-awareness loop started (30s interval)');
  }

  async processQuery(query) {
    console.log(`HEIDI processing query: "${query}"`);
    
    const startTime = Date.now();
    this.stats.lastActivity = new Date().toISOString();
    this.stats.queriesProcessed++;
    
    try {
      // Query Cascade KB
      const kbResults = await this.queryCascadeKB(query);
      
      let response;
      let confidence;
      let sources = [];
      
      if (kbResults.length > 0) {
        // Got results from KB
        this.stats.kbHits++;
        
        response = await this.generateSummary(query, kbResults);
        confidence = this.calculateConfidence(kbResults);
        sources = kbResults.map(r => r.relativePath);
        
        console.log(`KB hit: ${kbResults.length} results, confidence: ${confidence.toFixed(2)}`);
        
      } else {
        // Fallback to system scan
        console.log('No KB results, falling back to system scan...');
        this.stats.systemScans++;
        
        const scanResults = await this.systemScan(query);
        
        response = await this.generateSummary(query, scanResults);
        confidence = this.calculateConfidence(scanResults);
        sources = scanResults.map(r => r.relativePath);
        
        console.log(`System scan: ${scanResults.length} results, confidence: ${confidence.toFixed(2)}`);
      }
      
      // Update stats
      this.stats.totalConfidence += confidence;
      this.stats.avgConfidence = this.stats.totalConfidence / this.stats.queriesProcessed;
      
      if (confidence > 0.3) {
        this.stats.queriesSuccessful++;
      }
      
      // Generate actions
      const actions = await this.generateActions(query, kbResults.length > 0 ? kbResults : []);
      
      // Build response
      const heidiResponse = {
        summary: response,
        sources,
        confidence,
        actions,
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
        sources: [],
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

  async queryCascadeKB(query) {
    const queryTokens = this.tokenizeQuery(query);
    const results = new Map();
    
    for (const token of queryTokens) {
      if (this.cascadeIndex[token]) {
        const matches = this.cascadeIndex[token];
        
        for (const match of matches) {
          if (!results.has(match.file)) {
            results.set(match.file, {
              file: match.file,
              relativePath: match.relativePath,
              matchedTokens: [],
              totalRelevance: 0,
              snippets: []
            });
          }
          
          const result = results.get(match.file);
          result.matchedTokens.push(token);
          result.totalRelevance += match.relevance;
          
          if (!result.snippets.some(s => s.snippet === match.snippet)) {
            result.snippets.push(match);
          }
        }
      }
    }
    
    // Sort by relevance
    return Array.from(results.values())
      .sort((a, b) => b.totalRelevance - a.totalRelevance);
  }

  async systemScan(query) {
    console.log('Performing system scan...');
    
    const fs = require('fs');
    const path = require('path');
    
    const results = [];
    const queryLower = query.toLowerCase();
    
    // Scan key files
    const keyFiles = [
      'hydi-orchestrator.js',
      'hydi-processor.js',
      'production-orchestrator.js',
      'event-pipeline.js',
      'heidi-core.js',
      'cascade-node-simple.js'
    ];
    
    for (const fileName of keyFiles) {
      const filePath = path.join(process.cwd(), fileName);
      
      if (fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          
          if (content.toLowerCase().includes(queryLower)) {
            const snippet = this.extractContextSnippet(content, queryLower);
            
            results.push({
              file: filePath,
              relativePath: fileName,
              matchedTokens: [query],
              totalRelevance: 25,
              snippets: [{ snippet }]
            });
          }
        } catch (error) {
          console.log(`Error scanning ${fileName}: ${error.message}`);
        }
      }
    }
    
    return results;
  }

  extractContextSnippet(content, query, contextSize = 200) {
    const queryIndex = content.toLowerCase().indexOf(query.toLowerCase());
    
    if (queryIndex === -1) return '';
    
    const start = Math.max(0, queryIndex - contextSize);
    const end = Math.min(content.length, queryIndex + query.length + contextSize);
    
    let snippet = content.substring(start, end);
    
    // Highlight the query
    snippet = snippet.replace(new RegExp(query, 'gi'), `**${query}**`);
    
    return snippet;
  }

  async generateSummary(query, results) {
    if (results.length === 0) {
      return `I couldn't find any information about "${query}" in the system.`;
    }
    
    const topResult = results[0];
    const relevantInfo = topResult.snippets[0]?.snippet || '';
    
    let summary = `Based on the available information, I found ${results.length} relevant result${results.length > 1 ? 's' : ''} about "${query}".`;
    
    if (relevantInfo) {
      summary += ` Here's what I found: ${relevantInfo}`;
    }
    
    // Add context about the sources
    if (results.length > 1) {
      summary += ` The most relevant information is in ${topResult.relativePath}, with additional details in ${results.length - 1} other files.`;
    }
    
    return summary;
  }

  calculateConfidence(results) {
    if (results.length === 0) return 0;
    
    const topRelevance = results[0].totalRelevance;
    const resultCount = results.length;
    
    // Base confidence on relevance and result count
    let confidence = Math.min(topRelevance / 100, 1);
    
    // Boost confidence for multiple results
    if (resultCount > 1) {
      confidence = Math.min(confidence + (resultCount * 0.05), 1);
    }
    
    return confidence;
  }

  async generateActions(query, results) {
    const actions = [];
    
    if (results.length > 0) {
      const topResult = results[0];
      
      // Add file-specific actions
      if (topResult.relativePath.includes('orchestrator')) {
        actions.push('Run orchestrator status check');
        actions.push('Check system health');
      }
      
      if (topResult.relativePath.includes('processor')) {
        actions.push('Test event processing');
        actions.push('Check processor logs');
      }
      
      if (topResult.relativePath.includes('event')) {
        actions.push('Check event pipeline status');
        actions.push('Monitor event throughput');
      }
      
      if (topResult.relativePath.includes('heidi')) {
        actions.push('Check HEIDI system status');
        actions.push('Review HEIDI configuration');
      }
    }
    
    // Add general actions
    actions.push('Search for related documentation');
    actions.push('Check system logs for recent activity');
    
    return actions;
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
            confidence: response.confidence,
            sources: response.sources,
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
    console.log(`System Scans: ${this.stats.systemScans}`);
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
            kbConnected: !!this.cascadeIndex,
            eventPipelineConnected: !!this.eventPipeline
          }
        }
      };
      
      await this.eventPipeline.emit(healthEvent);
    }
  }

  tokenizeQuery(query) {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(token => token.length >= 3);
  }

  async getStatus() {
    return {
      activated: true,
      kbConnected: !!this.cascadeIndex,
      eventPipelineConnected: !!this.eventPipeline,
      monitoring: this.monitoring,
      stats: this.stats,
      timestamp: new Date().toISOString()
    };
  }

  async shutdown() {
    console.log('Shutting down HEIDI Live Intelligence...');
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    
    this.monitoring = false;
    
    console.log('HEIDI Live Intelligence shutdown complete');
  }
}

// CLI interface
if (require.main === module) {
  const heidi = new HeidiLiveIntelligence();
  
  const command = process.argv[2] || 'activate';
  
  (async () => {
    switch (command) {
      case 'activate':
        await heidi.activate();
        
        // Keep running for interactive queries
        console.log('\nHEIDI Live Intelligence is active. Type queries or press Ctrl+C to exit.');
        
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
          prompt: 'HEIDI> '
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
            const response = await heidi.processQuery(input);
            
            console.log('\n=== HEIDI RESPONSE ===');
            console.log(`Summary: ${response.summary}`);
            console.log(`Confidence: ${(response.confidence * 100).toFixed(1)}%`);
            console.log(`Sources: ${response.sources.length}`);
            response.sources.forEach((source, index) => {
              console.log(`  ${index + 1}. ${source}`);
            });
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
        await heidi.activate();
        const response = await heidi.processQuery(query);
        console.log('Response:', JSON.stringify(response, null, 2));
        await heidi.shutdown();
        break;
        
      case 'status':
        await heidi.activate();
        const status = await heidi.getStatus();
        console.log('Status:', JSON.stringify(status, null, 2));
        await heidi.shutdown();
        break;
        
      default:
        console.log('Usage: node heidi-live-intelligence.js [activate|query|status]');
    }
  })();
}

module.exports = { HeidiLiveIntelligence };
