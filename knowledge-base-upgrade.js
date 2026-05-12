// Knowledge Base Upgrade - Enhanced Indexing and Search
require('dotenv').config();

class KnowledgeBaseUpgrade {
  constructor() {
    this.knowledgeBase = new Map();
    this.indexed = false;
    this.tokenized = false;
    this.searchIndex = new Map();
  }

  async upgradeKnowledgeBase() {
    console.log('=== KNOWLEDGE BASE UPGRADE ===');
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Load existing knowledge base
      await this.loadExistingKnowledgeBase();
      
      // Re-index with full text content
      await this.reindexWithFullText();
      
      // Tokenize words for better search
      await this.tokenizeContent();
      
      // Build search index
      await this.buildSearchIndex();
      
      // Test enhanced search
      await this.testEnhancedSearch();
      
      this.indexed = true;
      this.tokenized = true;
      
      console.log('=== KNOWLEDGE BASE UPGRADE COMPLETE ===');
      
      return {
        success: true,
        entries: this.knowledgeBase.size,
        indexed: this.indexed,
        tokenized: this.tokenized,
        searchIndex: this.searchIndex.size
      };
      
    } catch (error) {
      console.log(`Knowledge base upgrade failed: ${error.message}`);
      throw error;
    }
  }

  async loadExistingKnowledgeBase() {
    console.log('Loading existing knowledge base...');
    
    const fs = require('fs');
    const path = require('path');
    
    const kbPath = path.join(process.cwd(), 'knowledge_base');
    
    if (fs.existsSync(kbPath)) {
      const files = fs.readdirSync(kbPath, { withFileTypes: true });
      
      for (const file of files) {
        if (file.name.endsWith('.md') || file.name.endsWith('.json')) {
          const filePath = path.join(kbPath, file.name);
          const content = fs.readFileSync(filePath, 'utf8');
          const stats = fs.statSync(filePath);
          
          // Store original content
          this.knowledgeBase.set(file.name, {
            content,
            metadata: {
              name: file.name,
              path: filePath,
              type: file.name.endsWith('.md') ? 'markdown' : 'json',
              size: stats.size,
              modified: stats.mtime
            },
            indexed: false,
            tokenized: false,
            upgraded: false
          });
          
          console.log(`  Loaded: ${file.name}`);
        }
      }
    }
    
    console.log(`Loaded ${this.knowledgeBase.size} knowledge base entries`);
  }

  async reindexWithFullText() {
    console.log('Re-indexing with full text content...');
    
    for (const [name, entry] of this.knowledgeBase.entries()) {
      // Extract full text content
      const fullText = this.extractFullText(entry.content);
      
      // Update entry
      entry.fullText = fullText;
      entry.fullTextLength = fullText.length;
      entry.indexed = true;
      entry.indexedAt = new Date().toISOString();
      
      this.knowledgeBase.set(name, entry);
      
      console.log(`  Indexed: ${name} (${fullText.length} characters)`);
    }
    
    console.log('Full text indexing complete');
  }

  extractFullText(content) {
    // Remove markdown formatting and extract text
    let text = content;
    
    // Remove markdown headers
    text = text.replace(/^#+\s+/gm, '');
    
    // Remove markdown code blocks
    text = text.replace(/```[\s\S]*?```/g, '');
    
    // Remove markdown inline code
    text = text.replace(/`[^`]*`/g, '');
    
    // Remove markdown links
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    
    // Remove markdown emphasis
    text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
    text = text.replace(/\*([^*]+)\*/g, '$1');
    text = text.replace(/_([^_]+)_/g, '$1');
    
    // Remove HTML tags
    text = text.replace(/<[^>]*>/g, '');
    
    // Remove extra whitespace
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }

  async tokenizeContent() {
    console.log('Tokenizing content for better search...');
    
    for (const [name, entry] of this.knowledgeBase.entries()) {
      if (!entry.fullText) continue;
      
      // Tokenize words
      const words = this.tokenizeWords(entry.fullText);
      
      // Count word frequencies
      const wordFreq = new Map();
      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
      
      // Update entry
      entry.tokens = words;
      entry.wordCount = words.length;
      entry.wordFrequency = wordFreq;
      entry.tokenized = true;
      entry.tokenizedAt = new Date().toISOString();
      
      this.knowledgeBase.set(name, entry);
      
      console.log(`  Tokenized: ${name} (${words.length} words)`);
    }
    
    console.log('Content tokenization complete');
  }

  tokenizeWords(text) {
    // Convert to lowercase and split into words
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '') // Remove non-word characters
      .split(/\s+/)
      .filter(word => word.length > 2); // Filter out very short words
    
    return words;
  }

  async buildSearchIndex() {
    console.log('Building search index...');
    
    this.searchIndex.clear();
    
    for (const [name, entry] of this.knowledgeBase.entries()) {
      if (!entry.tokens) continue;
      
      // Index each token
      for (const token of entry.tokens) {
        if (!this.searchIndex.has(token)) {
          this.searchIndex.set(token, []);
        }
        
        this.searchIndex.get(token).push({
          file: name,
          frequency: entry.wordFrequency.get(token) || 0,
          relevance: this.calculateTokenRelevance(token, entry)
        });
      }
    }
    
    // Sort search results by relevance
    for (const [token, results] of this.searchIndex.entries()) {
      results.sort((a, b) => b.relevance - a.relevance);
    }
    
    console.log(`Search index built: ${this.searchIndex.size} unique tokens`);
  }

  calculateTokenRelevance(token, entry) {
    const frequency = entry.wordFrequency.get(token) || 0;
    const wordCount = entry.wordCount || 1;
    const textLength = entry.fullTextLength || 1;
    
    // Calculate relevance based on frequency and document length
    const tf = frequency / wordCount; // Term frequency
    const idf = Math.log(this.knowledgeBase.size / this.searchIndex.get(token)?.length || 1); // Inverse document frequency
    
    return tf * idf;
  }

  async testEnhancedSearch() {
    console.log('Testing enhanced search...');
    
    const testQueries = [
      'protoforge',
      'system overview',
      'asset discovery',
      'recovery',
      'scanner',
      'scorer'
    ];
    
    for (const query of testQueries) {
      const results = this.search(query);
      console.log(`Query "${query}": ${results.length} results`);
      
      results.slice(0, 3).forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.file} (relevance: ${result.relevance.toFixed(3)})`);
      });
    }
    
    console.log('Enhanced search testing complete');
  }

  search(query) {
    if (!this.tokenized) {
      console.log('Knowledge base not tokenized, falling back to simple search');
      return this.simpleSearch(query);
    }
    
    const queryTokens = this.tokenizeWords(query);
    const results = new Map();
    
    // Find matching documents
    for (const token of queryTokens) {
      if (this.searchIndex.has(token)) {
        const matches = this.searchIndex.get(token);
        
        for (const match of matches) {
          if (!results.has(match.file)) {
            const entry = this.knowledgeBase.get(match.file);
            results.set(match.file, {
              file: match.file,
              entry,
              matchedTokens: [],
              totalRelevance: 0
            });
          }
          
          const result = results.get(match.file);
          result.matchedTokens.push(token);
          result.totalRelevance += match.relevance;
        }
      }
    }
    
    // Sort by relevance
    const sortedResults = Array.from(results.values())
      .sort((a, b) => b.totalRelevance - a.totalRelevance);
    
    return sortedResults;
  }

  simpleSearch(query) {
    const results = [];
    const queryLower = query.toLowerCase();
    
    for (const [name, entry] of this.knowledgeBase.entries()) {
      const content = entry.content.toLowerCase();
      
      if (content.includes(queryLower)) {
        results.push({
          file: name,
          entry,
          relevance: this.calculateSimpleRelevance(queryLower, content)
        });
      }
    }
    
    return results.sort((a, b) => b.relevance - a.relevance);
  }

  calculateSimpleRelevance(query, content) {
    const queryWords = query.split(' ').filter(word => word.length > 0);
    const contentWords = content.toLowerCase().split(' ').filter(word => word.length > 0);
    
    let score = 0;
    for (const queryWord of queryWords) {
      if (contentWords.includes(queryWord)) {
        score += 1;
      }
    }
    
    return score / Math.max(queryWords.length, 1);
  }

  getKnowledgeBase() {
    return this.knowledgeBase;
  }

  getSearchIndex() {
    return this.searchIndex;
  }

  getStats() {
    return {
      entries: this.knowledgeBase.size,
      indexed: this.indexed,
      tokenized: this.tokenized,
      searchTokens: this.searchIndex.size,
      totalWords: Array.from(this.knowledgeBase.values()).reduce((sum, entry) => sum + (entry.wordCount || 0), 0),
      avgWordsPerEntry: Array.from(this.knowledgeBase.values()).reduce((sum, entry) => sum + (entry.wordCount || 0), 0) / Math.max(this.knowledgeBase.size, 1)
    };
  }

  saveUpgradedKnowledgeBase() {
    console.log('Saving upgraded knowledge base...');
    
    const fs = require('fs');
    const path = require('path');
    
    const upgradeData = {
      timestamp: new Date().toISOString(),
      stats: this.getStats(),
      entries: Array.from(this.knowledgeBase.entries()).map(([name, entry]) => ({
        name,
        metadata: entry.metadata,
        indexed: entry.indexed,
        tokenized: entry.tokenized,
        wordCount: entry.wordCount,
        fullTextLength: entry.fullTextLength,
        upgraded: true
      })),
      searchIndex: Array.from(this.searchIndex.entries()).map(([token, results]) => ({
        token,
        resultCount: results.length,
        results: results.slice(0, 10) // Top 10 results
      }))
    };
    
    const upgradePath = path.join(process.cwd(), 'knowledge-base-upgrade.json');
    fs.writeFileSync(upgradePath, JSON.stringify(upgradeData, null, 2));
    
    console.log(`Upgraded knowledge base saved to: ${upgradePath}`);
    
    return upgradePath;
  }
}

// CLI interface
if (require.main === module) {
  const upgrade = new KnowledgeBaseUpgrade();
  
  const command = process.argv[2] || 'upgrade';
  
  (async () => {
    switch (command) {
      case 'upgrade':
        await upgrade.upgradeKnowledgeBase();
        await upgrade.saveUpgradedKnowledgeBase();
        break;
        
      case 'search':
        const query = process.argv[3] || 'protoforge';
        const results = upgrade.search(query);
        console.log(`Search results for "${query}":`);
        results.forEach((result, index) => {
          console.log(`${index + 1}. ${result.file} (relevance: ${result.totalRelevance.toFixed(3)})`);
        });
        break;
        
      case 'stats':
        const stats = upgrade.getStats();
        console.log('Knowledge Base Stats:');
        console.log(JSON.stringify(stats, null, 2));
        break;
        
      default:
        console.log('Usage: node knowledge-base-upgrade.js [upgrade|search|stats]');
    }
  })();
}

module.exports = { KnowledgeBaseUpgrade };
