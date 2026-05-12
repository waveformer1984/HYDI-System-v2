// Cascade Truth Layer - Primary Intelligence Core
require('dotenv').config();
const fs = require('fs');

class CascadeTruthLayer {
  constructor() {
    this.knowledgeBase = new Map();
    this.semanticGroups = {
      modules: new Set(),
      infrastructure: new Set(),
      events: new Set(),
      revenue: new Set(),
      testing: new Set(),
      deployment: new Set()
    };
    this.contradictions = [];
    this.rankingWeights = {
      frequency: 0.4,
      proximity: 0.3,
      importance: 0.3
    };
    this.confidenceThresholds = {
      high: 0.8,
      medium: 0.6,
      low: 0.4
    };
  }

  async buildTruthLayer() {
    console.log('=== BUILDING CASCADE TRUTH LAYER ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Phase 1: Load system graph
      await this.loadSystemGraph();
      
      // Phase 2: Rebuild knowledge base with semantic grouping
      await this.rebuildKnowledgeBase();
      
      // Phase 3: Implement ranking system
      await this.implementRanking();
      
      // Phase 4: Add conflict detection
      await this.detectConflicts();
      
      // Phase 5: Generate truth layer output
      await this.generateTruthOutput();
      
      console.log('=== CASCADE TRUTH LAYER COMPLETE ===');
      
      return {
        knowledgeBaseSize: this.knowledgeBase.size,
        semanticGroups: Object.keys(this.semanticGroups).map(key => ({
          category: key,
          count: this.semanticGroups[key].size
        })),
        contradictions: this.contradictions.length,
        confidenceThresholds: this.confidenceThresholds
      };
      
    } catch (error) {
      console.log(`Truth layer building failed: ${error.message}`);
      throw error;
    }
  }

  async loadSystemGraph() {
    console.log('Phase 1: Loading system graph...');
    
    const fs = require('fs');
    
    try {
      const systemGraphData = fs.readFileSync('cascade-system-graph.json', 'utf8');
      const systemGraph = JSON.parse(systemGraphData);
      
      this.systemGraph = systemGraph;
      console.log(`Loaded system graph with ${systemGraph.modules.length} modules`);
      
    } catch (error) {
      console.log('System graph not found, building from scratch...');
      const { CascadeSystemGraph } = require('./cascade-system-graph');
      const graph = new CascadeSystemGraph();
      await graph.buildSystemGraph();
      this.systemGraph = graph.getSystemGraph().systemGraph;
    }
  }

  async rebuildKnowledgeBase() {
    console.log('Phase 2: Rebuilding knowledge base with semantic grouping...');
    
    const path = require('path');
    
    // Scan all files for knowledge extraction
    const files = this.findFiles(process.cwd(), ['.js', '.md', '.json', '.ts']);
    
    for (const filePath of files) {
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const knowledge = await this.extractKnowledge(filePath, content);
        
        // Add to knowledge base
        this.knowledgeBase.set(filePath, knowledge);
        
        // Add to semantic groups
        this.categorizeKnowledge(filePath, knowledge);
        
      } catch (error) {
        console.log(`Failed to extract knowledge from ${filePath}: ${error.message}`);
      }
    }
    
    console.log(`Extracted knowledge from ${files.length} files`);
  }

  findFiles(dir, extensions) {
    const fs = require('fs');
    const path = require('path');
    const results = [];
    
    function scan(currentDir) {
      try {
        const items = fs.readdirSync(currentDir);
        
        for (const item of items) {
          const fullPath = path.join(currentDir, item);
          
          try {
            const stat = fs.statSync(fullPath);
            
            if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules') {
              scan(fullPath);
            } else if (extensions.some(ext => item.endsWith(ext))) {
              results.push(fullPath);
            }
          } catch (statError) {
            // Skip inaccessible paths
          }
        }
      } catch (readError) {
        // Skip unreadable directories
      }
    }
    
    scan(dir);
    return results;
  }

  async extractKnowledge(filePath, content) {
    const path = require('path');
    const relativePath = path.relative(process.cwd(), filePath);
    
    const knowledge = {
      path: relativePath,
      name: path.basename(filePath, path.extname(filePath)),
      type: path.extname(filePath).substring(1),
      tokens: this.tokenizeContent(content),
      functions: [],
      classes: [],
      events: [],
      concepts: [],
      metadata: {
        size: content.length,
        lines: content.split('\n').length,
        lastModified: fs.statSync(filePath).mtime.toISOString()
      }
    };
    
    // Extract functions
    const functionMatches = content.match(/(?:function\s+(\w+)|async\s+function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g);
    if (functionMatches) {
      functionMatches.forEach(match => {
        const name = match.match(/(\w+)/)[1];
        if (name && !knowledge.functions.includes(name)) {
          knowledge.functions.push(name);
        }
      });
    }
    
    // Extract classes
    const classMatches = content.match(/class\s+(\w+)/g);
    if (classMatches) {
      classMatches.forEach(match => {
        const name = match.match(/class\s+(\w+)/)[1];
        if (name && !knowledge.classes.includes(name)) {
          knowledge.classes.push(name);
        }
      });
    }
    
    // Extract events
    const eventMatches = content.match(/(?:emit|Event)[\s\S]*?{[\s\S]*?}/g);
    if (eventMatches) {
      eventMatches.forEach(match => {
        const eventTypes = match.match(/type:\s*['"]([^'"]+)['"]/g);
        if (eventTypes) {
          eventTypes.forEach(type => {
            const eventType = type.match(/type:\s*['"]([^'"]+)['"]/)[1];
            if (eventType && !knowledge.events.includes(eventType)) {
              knowledge.events.push(eventType);
            }
          });
        }
      });
    }
    
    // Extract concepts (important terms)
    const conceptMatches = content.match(/\b[A-Z][a-zA-Z]+\b/g);
    if (conceptMatches) {
      conceptMatches.forEach(concept => {
        if (concept.length > 3 && !knowledge.concepts.includes(concept)) {
          knowledge.concepts.push(concept);
        }
      });
    }
    
    return knowledge;
  }

  tokenizeContent(content) {
    return content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(token => token.length >= 3);
  }

  categorizeKnowledge(filePath, knowledge) {
    const path = filePath.toLowerCase();
    const content = JSON.stringify(knowledge).toLowerCase();
    
    // Module categorization
    if (path.includes('module') || path.includes('lib') || path.includes('core')) {
      this.semanticGroups.modules.add(filePath);
    }
    
    // Infrastructure categorization
    if (path.includes('server') || path.includes('database') || path.includes('infra') || 
        content.includes('port') || content.includes('host') || content.includes('database')) {
      this.semanticGroups.infrastructure.add(filePath);
    }
    
    // Events categorization
    if (path.includes('event') || knowledge.events.length > 0 || content.includes('emit')) {
      this.semanticGroups.events.add(filePath);
    }
    
    // Revenue categorization
    if (path.includes('revenue') || path.includes('payment') || path.includes('billing') ||
        content.includes('price') || content.includes('cost') || content.includes('revenue')) {
      this.semanticGroups.revenue.add(filePath);
    }
    
    // Testing categorization
    if (path.includes('test') || path.includes('spec') || content.includes('test') || content.includes('assert')) {
      this.semanticGroups.testing.add(filePath);
    }
    
    // Deployment categorization
    if (path.includes('deploy') || path.includes('build') || content.includes('deploy') || content.includes('build')) {
      this.semanticGroups.deployment.add(filePath);
    }
  }

  async implementRanking() {
    console.log('Phase 3: Implementing ranking system...');
    
    // Calculate frequency scores
    const frequencyScores = this.calculateFrequencyScores();
    
    // Calculate proximity scores
    const proximityScores = this.calculateProximityScores();
    
    // Calculate importance scores
    const importanceScores = this.calculateImportanceScores();
    
    // Apply ranking weights
    for (const [filePath, knowledge] of this.knowledgeBase) {
      const frequencyScore = frequencyScores.get(filePath) || 0;
      const proximityScore = proximityScores.get(filePath) || 0;
      const importanceScore = importanceScores.get(filePath) || 0;
      
      knowledge.rank = {
        frequency: frequencyScore,
        proximity: proximityScore,
        importance: importanceScore,
        total: (frequencyScore * this.rankingWeights.frequency) +
               (proximityScore * this.rankingWeights.proximity) +
               (importanceScore * this.rankingWeights.importance)
      };
    }
  }

  calculateFrequencyScores() {
    const scores = new Map();
    const tokenFrequency = new Map();
    
    // Calculate token frequency across all files
    for (const [filePath, knowledge] of this.knowledgeBase) {
      for (const token of knowledge.tokens) {
        tokenFrequency.set(token, (tokenFrequency.get(token) || 0) + 1);
      }
    }
    
    // Score files based on frequency of their tokens
    for (const [filePath, knowledge] of this.knowledgeBase) {
      let score = 0;
      for (const token of knowledge.tokens) {
        score += tokenFrequency.get(token) || 0;
      }
      scores.set(filePath, score / knowledge.tokens.length);
    }
    
    return scores;
  }

  calculateProximityScores() {
    const scores = new Map();
    
    // Score files based on their position in the directory structure
    for (const [filePath, knowledge] of this.knowledgeBase) {
      let score = 0;
      
      // Root level files get higher scores
      const depth = filePath.split(/[/\\]/).length - 1;
      score += Math.max(0, 5 - depth);
      
      // Files in important directories get higher scores
      if (filePath.includes('core') || filePath.includes('main') || filePath.includes('index')) {
        score += 3;
      }
      
      scores.set(filePath, score);
    }
    
    return scores;
  }

  calculateImportanceScores() {
    const scores = new Map();
    
    // Score files based on their content importance
    for (const [filePath, knowledge] of this.knowledgeBase) {
      let score = 0;
      
      // More functions = more important
      score += knowledge.functions.length * 0.5;
      
      // More classes = more important
      score += knowledge.classes.length * 1;
      
      // More events = more important
      score += knowledge.events.length * 0.8;
      
      // Larger files might be more important (but penalize too large)
      const sizeScore = Math.min(knowledge.metadata.lines / 100, 5);
      score += sizeScore;
      
      scores.set(filePath, score);
    }
    
    return scores;
  }

  async detectConflicts() {
    console.log('Phase 4: Detecting conflicts...');
    
    const conceptMap = new Map();
    
    // Group concepts by name
    for (const [filePath, knowledge] of this.knowledgeBase) {
      for (const concept of knowledge.concepts) {
        if (!conceptMap.has(concept)) {
          conceptMap.set(concept, []);
        }
        conceptMap.get(concept).push({
          filePath,
          context: knowledge.tokens.slice(0, 10).join(' ')
        });
      }
    }
    
    // Detect contradictions
    for (const [concept, occurrences] of conceptMap) {
      if (occurrences.length > 1) {
        // Check if the concept is used differently in different files
        const contexts = occurrences.map(occ => occ.context);
        
        // Simple contradiction detection: if contexts are very different
        for (let i = 0; i < contexts.length; i++) {
          for (let j = i + 1; j < contexts.length; j++) {
            const similarity = this.calculateContextSimilarity(contexts[i], contexts[j]);
            
            if (similarity < 0.3) {
              this.contradictions.push({
                concept,
                file1: occurrences[i].filePath,
                file2: occurrences[j].filePath,
                context1: contexts[i],
                context2: contexts[j],
                similarity
              });
            }
          }
        }
      }
    }
    
    console.log(`Detected ${this.contradictions.length} potential contradictions`);
  }

  calculateContextSimilarity(context1, context2) {
    const tokens1 = new Set(context1.split(' '));
    const tokens2 = new Set(context2.split(' '));
    
    const intersection = new Set([...tokens1].filter(x => tokens2.has(x)));
    const union = new Set([...tokens1, ...tokens2]);
    
    return intersection.size / union.size;
  }

  async generateTruthOutput() {
    console.log('Phase 5: Generating truth layer output...');
    
    const fs = require('fs');
    
    // Generate truth layer output
    const truthLayerOutput = {
      timestamp: new Date().toISOString(),
      summary: {
        totalFiles: this.knowledgeBase.size,
        totalConcepts: Array.from(this.knowledgeBase.values()).reduce((sum, k) => sum + k.concepts.length, 0),
        totalFunctions: Array.from(this.knowledgeBase.values()).reduce((sum, k) => sum + k.functions.length, 0),
        totalEvents: Array.from(this.knowledgeBase.values()).reduce((sum, k) => sum + k.events.length, 0),
        contradictions: this.contradictions.length
      },
      semanticGroups: Object.keys(this.semanticGroups).reduce((acc, key) => {
        acc[key] = Array.from(this.semanticGroups[key]);
        return acc;
      }, {}),
      knowledgeBase: Array.from(this.knowledgeBase.entries()).map(([path, knowledge]) => ({
        path,
        ...knowledge
      })),
      contradictions: this.contradictions,
      rankingWeights: this.rankingWeights,
      confidenceThresholds: this.confidenceThresholds
    };
    
    fs.writeFileSync('cascade-truth-layer.json', JSON.stringify(truthLayerOutput, null, 2));
    
    console.log('Truth layer output generated: cascade-truth-layer.json');
  }

  query(query, options = {}) {
    const queryTokens = this.tokenizeQuery(query);
    const results = [];
    
    for (const [filePath, knowledge] of this.knowledgeBase) {
      const relevance = this.calculateRelevance(queryTokens, knowledge);
      
      if (relevance > 0.1) {
        results.push({
          filePath,
          relevance,
          knowledge,
          rank: knowledge.rank.total
        });
      }
    }
    
    // Sort by relevance and rank
    results.sort((a, b) => (b.relevance * 0.7 + b.rank * 0.3) - (a.relevance * 0.7 + a.rank * 0.3));
    
    // Check for contradictions
    const contradictions = this.contradictions.filter(contradiction =>
      queryTokens.some(token => 
        contradiction.concept.toLowerCase().includes(token) ||
        token.includes(contradiction.concept.toLowerCase())
      )
    );
    
    return {
      results,
      contradictions,
      confidence: this.calculateConfidence(results, contradictions),
      semanticGroups: this.getSemanticGroups(results)
    };
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

  calculateRelevance(queryTokens, knowledge) {
    const knowledgeTokens = new Set(knowledge.tokens);
    const concepts = new Set(knowledge.concepts.map(c => c.toLowerCase()));
    
    let relevance = 0;
    let matches = 0;
    
    for (const token of queryTokens) {
      if (knowledgeTokens.has(token)) {
        relevance += 1;
        matches++;
      }
      
      // Boost for concept matches
      for (const concept of concepts) {
        if (concept.includes(token) || token.includes(concept)) {
          relevance += 2;
          matches++;
        }
      }
    }
    
    return matches > 0 ? relevance / queryTokens.length : 0;
  }

  calculateConfidence(results, contradictions) {
    if (results.length === 0) return 0;
    
    let confidence = 0;
    
    // Base confidence from result quality
    const topResult = results[0];
    confidence += Math.min(topResult.relevance, 1) * 0.4;
    confidence += Math.min(topResult.rank / 10, 1) * 0.3;
    
    // Boost for multiple results
    confidence += Math.min(results.length / 10, 1) * 0.2;
    
    // Penalize for contradictions
    if (contradictions.length > 0) {
      confidence -= contradictions.length * 0.1;
    }
    
    return Math.max(0, Math.min(1, confidence));
  }

  getSemanticGroups(results) {
    const groups = new Set();
    
    for (const result of results) {
      for (const [groupName, files] of Object.entries(this.semanticGroups)) {
        if (files.has(result.filePath)) {
          groups.add(groupName);
        }
      }
    }
    
    return Array.from(groups);
  }
}

// CLI interface
if (require.main === module) {
  const truthLayer = new CascadeTruthLayer();
  
  (async () => {
    try {
      const results = await truthLayer.buildTruthLayer();
      console.log('Truth layer building complete:', results);
    } catch (error) {
      console.log('Truth layer building failed:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = { CascadeTruthLayer };
