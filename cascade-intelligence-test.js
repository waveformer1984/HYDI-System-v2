// Cascade Intelligence Test - Validation and Performance
require('dotenv').config();

class CascadeIntelligenceTest {
  constructor() {
    this.expansion = null;
    this.index = null;
    this.testResults = {
      queries: [],
      passed: 0,
      failed: 0,
      total: 0,
      hitRate: 0,
      avgResponseTime: 0
    };
  }

  async runValidationTests() {
    console.log('=== CASCADE INTELLIGENCE VALIDATION TESTS ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Load expanded knowledge base
      await this.loadKnowledgeBase();
      
      // Run validation queries
      await this.runValidationQueries();
      
      // Calculate metrics
      this.calculateMetrics();
      
      // Generate report
      await this.generateReport();
      
      console.log('=== CASCADE INTELLIGENCE VALIDATION TESTS COMPLETE ===');
      
      return this.testResults;
      
    } catch (error) {
      console.log(`Validation tests failed: ${error.message}`);
      throw error;
    }
  }

  async loadKnowledgeBase() {
    console.log('Loading expanded knowledge base...');
    
    const fs = require('fs');
    const path = require('path');
    
    const indexPath = path.join(process.cwd(), 'cascade-index.json');
    
    if (fs.existsSync(indexPath)) {
      const indexData = fs.readFileSync(indexPath, 'utf8');
      const index = JSON.parse(indexData);
      
      this.index = index.index;
      console.log(`Loaded index with ${Object.keys(this.index).length} tokens`);
      
    } else {
      throw new Error('Index file not found. Run cascade-knowledge-expansion.js first.');
    }
  }

  async runValidationQueries() {
    console.log('Running validation queries...');
    
    const validationQueries = [
      {
        query: 'protoforge',
        description: 'ProtoForge system components',
        minResults: 1,
        required: true
      },
      {
        query: 'event pipeline',
        description: 'Event pipeline components',
        minResults: 1,
        required: true
      },
      {
        query: 'hydi processor',
        description: 'HYDI processor components',
        minResults: 1,
        required: true
      },
      {
        query: 'orchestrator',
        description: 'Orchestrator components',
        minResults: 1,
        required: true
      },
      {
        query: 'cascade',
        description: 'Cascade system components',
        minResults: 1,
        required: true
      },
      {
        query: 'heidi',
        description: 'HEIDI system components',
        minResults: 1,
        required: true
      },
      {
        query: 'event',
        description: 'Event-related components',
        minResults: 5,
        required: true
      },
      {
        query: 'schema',
        description: 'Schema-related components',
        minResults: 1,
        required: true
      },
      {
        query: 'knowledge',
        description: 'Knowledge base components',
        minResults: 1,
        required: true
      },
      {
        query: 'monitoring',
        description: 'Monitoring components',
        minResults: 1,
        required: true
      }
    ];
    
    for (const test of validationQueries) {
      await this.runSingleQuery(test);
    }
    
    console.log(`Validation queries complete: ${this.testResults.passed}/${this.testResults.total} passed`);
  }

  async runSingleQuery(test) {
    const startTime = Date.now();
    
    console.log(`Testing query: "${test.query}" (${test.description})`);
    
    try {
      const results = this.search(test.query);
      const endTime = Date.now();
      const responseTime = endTime - startTime;
      
      const passed = results.length >= test.minResults;
      
      const result = {
        query: test.query,
        description: test.description,
        results: results.length,
        minResults: test.minResults,
        passed,
        required: test.required,
        responseTime,
        timestamp: new Date().toISOString(),
        topResults: results.slice(0, 3).map(r => ({
          file: r.relativePath,
          relevance: r.totalRelevance,
          snippet: r.snippets[0]?.snippet || ''
        }))
      };
      
      this.testResults.queries.push(result);
      
      if (passed) {
        this.testResults.passed++;
        console.log(`  PASSED: ${results.length} results found (${responseTime}ms)`);
      } else {
        this.testResults.failed++;
        console.log(`  FAILED: Only ${results.length} results found (min: ${test.minResults})`);
        
        if (test.required) {
          console.log(`  CRITICAL: Required query failed!`);
        }
      }
      
      this.testResults.total++;
      
    } catch (error) {
      console.log(`  ERROR: ${error.message}`);
      
      this.testResults.failed++;
      this.testResults.total++;
      
      this.testResults.queries.push({
        query: test.query,
        description: test.description,
        results: 0,
        minResults: test.minResults,
        passed: false,
        required: test.required,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  search(query) {
    const queryTokens = this.tokenizeQuery(query);
    const results = new Map();
    
    for (const token of queryTokens) {
      if (this.index[token]) {
        const matches = this.index[token];
        
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

  tokenizeQuery(query) {
    return query
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(token => token.length >= 3);
  }

  calculateMetrics() {
    console.log('Calculating metrics...');
    
    // Hit rate
    this.testResults.hitRate = (this.testResults.passed / this.testResults.total) * 100;
    
    // Average response time
    const validQueries = this.testResults.queries.filter(q => q.responseTime);
    if (validQueries.length > 0) {
      const totalTime = validQueries.reduce((sum, q) => sum + q.responseTime, 0);
      this.testResults.avgResponseTime = totalTime / validQueries.length;
    }
    
    console.log(`Hit Rate: ${this.testResults.hitRate.toFixed(1)}%`);
    console.log(`Avg Response Time: ${this.testResults.avgResponseTime.toFixed(2)}ms`);
  }

  async generateReport() {
    console.log('Generating validation report...');
    
    const fs = require('fs');
    const path = require('path');
    
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalQueries: this.testResults.total,
        passedQueries: this.testResults.passed,
        failedQueries: this.testResults.failed,
        hitRate: this.testResults.hitRate,
        avgResponseTime: this.testResults.avgResponseTime,
        status: this.testResults.hitRate >= 80 ? 'PASS' : 'FAIL'
      },
      queries: this.testResults.queries,
      recommendations: this.generateRecommendations()
    };
    
    const reportPath = path.join(process.cwd(), 'cascade-validation-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`Validation report saved to: ${reportPath}`);
    
    return reportPath;
  }

  generateRecommendations() {
    const recommendations = [];
    
    if (this.testResults.hitRate < 100) {
      const failedQueries = this.testResults.queries.filter(q => !q.passed);
      
      recommendations.push({
        type: 'improve_search',
        message: `${failedQueries.length} queries failed to meet minimum result requirements`,
        failedQueries: failedQueries.map(q => q.query)
      });
    }
    
    if (this.testResults.avgResponseTime > 100) {
      recommendations.push({
        type: 'performance',
        message: `Average response time (${this.testResults.avgResponseTime.toFixed(2)}ms) is above optimal threshold`
      });
    }
    
    const criticalFailures = this.testResults.queries.filter(q => !q.passed && q.required);
    if (criticalFailures.length > 0) {
      recommendations.push({
        type: 'critical',
        message: `${criticalFailures.length} critical queries failed - system may not be fully functional`,
        criticalQueries: criticalFailures.map(q => q.query)
      });
    }
    
    return recommendations;
  }

  async testSystemSelfAwareness() {
    console.log('Testing system self-awareness...');
    
    const selfAwarenessQueries = [
      'what is the cascade system',
      'how does the event pipeline work',
      'what is heidi responsible for',
      'what are the main components',
      'how does the orchestrator function'
    ];
    
    console.log('Self-awareness test results:');
    
    for (const query of selfAwarenessQueries) {
      const results = this.search(query);
      
      console.log(`  "${query}": ${results.length} results`);
      
      if (results.length > 0) {
        const topResult = results[0];
        console.log(`    Top result: ${topResult.relativePath}`);
        console.log(`    Snippet: ${topResult.snippets[0]?.snippet?.substring(0, 100)}...`);
      }
    }
  }

  getTestResults() {
    return this.testResults;
  }
}

// CLI interface
if (require.main === module) {
  const test = new CascadeIntelligenceTest();
  
  const command = process.argv[2] || 'validate';
  
  (async () => {
    switch (command) {
      case 'validate':
        await test.runValidationTests();
        
        // Check if validation passed
        if (test.testResults.hitRate >= 80) {
          console.log('\n=== VALIDATION PASSED ===');
          console.log('Cascade intelligence system is functional');
        } else {
          console.log('\n=== VALIDATION FAILED ===');
          console.log('Cascade intelligence system needs improvement');
          process.exit(1);
        }
        break;
        
      case 'self-aware':
        await test.loadKnowledgeBase();
        await test.testSystemSelfAwareness();
        break;
        
      case 'search':
        const query = process.argv[3] || 'protoforge';
        await test.loadKnowledgeBase();
        const results = test.search(query);
        
        console.log(`Search results for "${query}": ${results.length}`);
        results.forEach((result, index) => {
          console.log(`${index + 1}. ${result.relativePath} (relevance: ${result.totalRelevance})`);
          if (result.snippets[0]) {
            console.log(`   ${result.snippets[0].snippet.substring(0, 200)}...`);
          }
        });
        break;
        
      default:
        console.log('Usage: node cascade-intelligence-test.js [validate|self-aware|search]');
    }
  })();
}

module.exports = { CascadeIntelligenceTest };
