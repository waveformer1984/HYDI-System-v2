// Cascade Knowledge Base Expansion - Full System Ingestion
require('dotenv').config();

class CascadeKnowledgeExpansion {
  constructor() {
    this.rootPath = process.cwd();
    this.knowledgeBase = new Map();
    this.index = new Map();
    this.diagnostics = {
      filesScanned: 0,
      filesIngested: 0,
      totalTokens: 0,
      functionsFound: 0,
      modulesFound: 0,
      eventsFound: 0,
      relationshipsFound: 0,
      errors: []
    };
  }

  async expandKnowledgeBase() {
    console.log('=== CASCADE KNOWLEDGE BASE EXPANSION ===');
    console.log(`Root Path: ${this.rootPath}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    try {
      // Phase 1: Scan entire system recursively
      await this.scanEntireSystem();
      
      // Phase 2: Extract and index content
      await this.extractAndIndex();
      
      // Phase 3: Build relationships
      await this.buildRelationships();
      
      // Phase 4: Save results
      await this.saveResults();
      
      console.log('=== CASCADE KNOWLEDGE BASE EXPANSION COMPLETE ===');
      
      return this.diagnostics;
      
    } catch (error) {
      console.log(`Knowledge base expansion failed: ${error.message}`);
      throw error;
    }
  }

  async scanEntireSystem() {
    console.log('Scanning entire system recursively...');
    
    const fs = require('fs');
    const path = require('path');
    
    const scanDirectory = (dirPath, depth = 0) => {
      if (depth > 10) return; // Prevent infinite recursion
      
      try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        
        for (const item of items) {
          const itemPath = path.join(dirPath, item.name);
          
          if (item.isDirectory()) {
            // Skip certain directories
            if (item.name === 'node_modules' || item.name === '.git' || item.name === 'snapshots') {
              continue;
            }
            
            scanDirectory(itemPath, depth + 1);
          } else if (item.isFile()) {
            // Process relevant files
            const ext = path.extname(item.name).toLowerCase();
            
            if (['.js', '.md', '.json', '.ts'].includes(ext)) {
              this.processFile(itemPath, ext);
              this.diagnostics.filesScanned++;
            }
          }
        }
      } catch (error) {
        console.log(`Error scanning directory ${dirPath}: ${error.message}`);
        this.diagnostics.errors.push({
          type: 'scan_error',
          path: dirPath,
          error: error.message
        });
      }
    };
    
    scanDirectory(this.rootPath);
    
    console.log(`Scanned ${this.diagnostics.filesScanned} files`);
  }

  processFile(filePath, extension) {
    const fs = require('fs');
    const path = require('path');
    
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const stats = fs.statSync(filePath);
      
      const fileData = {
        path: filePath,
        relativePath: path.relative(this.rootPath, filePath),
        name: path.basename(filePath),
        extension,
        size: stats.size,
        modified: stats.mtime,
        content,
        functions: [],
        modules: [],
        events: [],
        relationships: [],
        tokens: [],
        indexed: false
      };
      
      // Extract based on file type
      switch (extension) {
        case '.js':
          this.extractJavaScriptContent(fileData);
          break;
        case '.ts':
          this.extractTypeScriptContent(fileData);
          break;
        case '.json':
          this.extractJSONContent(fileData);
          break;
        case '.md':
          this.extractMarkdownContent(fileData);
          break;
      }
      
      this.knowledgeBase.set(filePath, fileData);
      this.diagnostics.filesIngested++;
      
      console.log(`  Ingested: ${fileData.relativePath}`);
      
    } catch (error) {
      console.log(`Error processing file ${filePath}: ${error.message}`);
      this.diagnostics.errors.push({
        type: 'process_error',
        path: filePath,
        error: error.message
      });
    }
  }

  extractJavaScriptContent(fileData) {
    // Extract function names
    const functionMatches = fileData.content.match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\([^)]*\)\s*=>)|class\s+(\w+)|async\s+(\w+)\s*\()/g);
    if (functionMatches) {
      const functions = [];
      fileData.content.replace(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:function|\([^)]*\)\s*=>)|class\s+(\w+)|async\s+(\w+)\s*\()/g, (match, func1, func2, className, asyncFunc) => {
        const name = func1 || func2 || className || asyncFunc;
        if (name) functions.push(name);
      });
      fileData.functions = functions;
      this.diagnostics.functionsFound += functions.length;
    }
    
    // Extract module exports/imports
    const moduleMatches = fileData.content.match(/(?:require\s*\(['"]([^'"]+)['"]\)|module\.exports|exports\.|import.*from\s*['"]([^'"]+)['"])/g);
    if (moduleMatches) {
      const modules = [];
      fileData.content.replace(/(?:require\s*\(['"]([^'"]+)['"]\)|module\.exports|exports\.|import.*from\s*['"]([^'"]+)['"])/g, (match, requirePath, importPath) => {
        const path = requirePath || importPath;
        if (path && !path.startsWith('.')) modules.push(path);
      });
      fileData.modules = modules;
      this.diagnostics.modulesFound += modules.length;
    }
    
    // Extract event structures
    const eventMatches = fileData.content.match(/(?:event_id|type|source|timestamp|payload|emit|subscribe|event)/g);
    if (eventMatches) {
      fileData.events = eventMatches;
      this.diagnostics.eventsFound += eventMatches.length;
    }
    
    // Tokenize content
    fileData.tokens = this.tokenizeContent(fileData.content);
    this.diagnostics.totalTokens += fileData.tokens.length;
  }

  extractTypeScriptContent(fileData) {
    // Similar to JavaScript but with TypeScript specifics
    this.extractJavaScriptContent(fileData);
    
    // Add TypeScript specific patterns
    const interfaceMatches = fileData.content.match(/interface\s+(\w+)/g);
    if (interfaceMatches) {
      const interfaces = [];
      fileData.content.replace(/interface\s+(\w+)/g, (match, name) => {
        interfaces.push(name);
      });
      fileData.interfaces = interfaces;
    }
  }

  extractJSONContent(fileData) {
    try {
      const jsonData = JSON.parse(fileData.content);
      
      // Extract keys and values
      const extractKeys = (obj, prefix = '') => {
        const keys = [];
        
        for (const [key, value] of Object.entries(obj)) {
          const fullKey = prefix ? `${prefix}.${key}` : key;
          keys.push(fullKey);
          
          if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            keys.push(...extractKeys(value, fullKey));
          }
        }
        
        return keys;
      };
      
      fileData.jsonKeys = extractKeys(jsonData);
      
      // Tokenize JSON content
      fileData.tokens = this.tokenizeContent(JSON.stringify(jsonData));
      this.diagnostics.totalTokens += fileData.tokens.length;
      
    } catch (error) {
      // Invalid JSON, treat as plain text
      fileData.tokens = this.tokenizeContent(fileData.content);
      this.diagnostics.totalTokens += fileData.tokens.length;
    }
  }

  extractMarkdownContent(fileData) {
    // Extract headers
    const headerMatches = fileData.content.match(/^#+\s+(.+)$/gm);
    if (headerMatches) {
      const headers = [];
      fileData.content.replace(/^#+\s+(.+)$/gm, (match, header) => {
        headers.push(header.trim());
      });
      fileData.headers = headers;
    }
    
    // Extract code blocks
    const codeBlockMatches = fileData.content.match(/```[\s\S]*?```/g);
    if (codeBlockMatches) {
      fileData.codeBlocks = codeBlockMatches;
    }
    
    // Tokenize content (excluding code blocks)
    let textContent = fileData.content;
    textContent = textContent.replace(/```[\s\S]*?```/g, ''); // Remove code blocks
    textContent = textContent.replace(/^#+\s+/gm, ''); // Remove headers
    textContent = textContent.replace(/`[^`]*`/g, ''); // Remove inline code
    
    fileData.tokens = this.tokenizeContent(textContent);
    this.diagnostics.totalTokens += fileData.tokens.length;
  }

  tokenizeContent(content) {
    // Convert to lowercase and extract meaningful tokens
    const tokens = content
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Replace non-word chars with space
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim()
      .split(' ')
      .filter(token => token.length >= 3) // Filter short tokens
      .filter(token => !this.isCommonWord(token)); // Filter common words
    
    return [...new Set(tokens)]; // Remove duplicates
  }

  isCommonWord(word) {
    const commonWords = [
      'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'as', 'is', 'was', 'are', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'now', 'also', 'here', 'there', 'use', 'used', 'using', 'from', 'into', 'over', 'under', 'up', 'down', 'back', 'out', 'off', 'through', 'between', 'after', 'before', 'during', 'since', 'until', 'while', 'about', 'against', 'among', 'around', 'because', 'beside', 'besides', 'despite', 'except', 'inside', 'outside', 'per', 'plus', 'round', 'since', 'than', 'till', 'unto', 'upon', 'versus', 'via', 'vs', 'within', 'without'
    ];
    
    return commonWords.includes(word);
  }

  async extractAndIndex() {
    console.log('Extracting and indexing content...');
    
    // Build inverted index
    for (const [filePath, fileData] of this.knowledgeBase.entries()) {
      for (const token of fileData.tokens) {
        if (!this.index.has(token)) {
          this.index.set(token, []);
        }
        
        // Find context snippet
        const snippet = this.extractContextSnippet(fileData.content, token);
        
        this.index.get(token).push({
          file: filePath,
          relativePath: fileData.relativePath,
          snippet,
          relevance: this.calculateRelevance(token, fileData),
          type: fileData.extension,
          functions: fileData.functions || [],
          modules: fileData.modules || [],
          events: fileData.events || []
        });
      }
      
      fileData.indexed = true;
    }
    
    // Sort index by relevance
    for (const [token, results] of this.index.entries()) {
      results.sort((a, b) => b.relevance - a.relevance);
    }
    
    console.log(`Built inverted index: ${this.index.size} tokens`);
  }

  extractContextSnippet(content, token, contextSize = 100) {
    const tokenIndex = content.toLowerCase().indexOf(token.toLowerCase());
    
    if (tokenIndex === -1) return '';
    
    const start = Math.max(0, tokenIndex - contextSize);
    const end = Math.min(content.length, tokenIndex + token.length + contextSize);
    
    let snippet = content.substring(start, end);
    
    // Highlight the token
    snippet = snippet.replace(new RegExp(token, 'gi'), `**${token}**`);
    
    return snippet;
  }

  calculateRelevance(token, fileData) {
    let score = 0;
    
    // Token frequency
    const tokenCount = fileData.tokens.filter(t => t === token).length;
    score += tokenCount * 10;
    
    // Function name match
    if (fileData.functions && fileData.functions.includes(token)) {
      score += 50;
    }
    
    // Module name match
    if (fileData.modules && fileData.modules.includes(token)) {
      score += 30;
    }
    
    // Event match
    if (fileData.events && fileData.events.includes(token)) {
      score += 20;
    }
    
    // File name match
    if (fileData.name.toLowerCase().includes(token)) {
      score += 40;
    }
    
    // Path match
    if (fileData.relativePath.toLowerCase().includes(token)) {
      score += 25;
    }
    
    return score;
  }

  async buildRelationships() {
    console.log('Building system relationships...');
    
    // Find relationships between modules
    for (const [filePath, fileData] of this.knowledgeBase.entries()) {
      if (fileData.modules) {
        for (const module of fileData.modules) {
          // Find files that match this module
          for (const [otherPath, otherData] of this.knowledgeBase.entries()) {
            if (otherPath !== filePath && otherData.name.toLowerCase().includes(module.toLowerCase())) {
              fileData.relationships.push({
                type: 'module_dependency',
                target: otherPath,
                module,
                strength: 'strong'
              });
              
              this.diagnostics.relationshipsFound++;
            }
          }
        }
      }
    }
    
    console.log(`Built ${this.diagnostics.relationshipsFound} relationships`);
  }

  async saveResults() {
    console.log('Saving results...');
    
    const fs = require('fs');
    const path = require('path');
    
    // Save index
    const indexData = {
      timestamp: new Date().toISOString(),
      diagnostics: this.diagnostics,
      index: Object.fromEntries(this.index)
    };
    
    const indexPath = path.join(this.rootPath, 'cascade-index.json');
    fs.writeFileSync(indexPath, JSON.stringify(indexData, null, 2));
    
    // Save diagnostics
    const diagnosticsData = {
      timestamp: new Date().toISOString(),
      diagnostics: this.diagnostics,
      summary: {
        totalFiles: this.diagnostics.filesScanned,
        ingestedFiles: this.diagnostics.filesIngested,
        totalTokens: this.diagnostics.totalTokens,
        uniqueTokens: this.index.size,
        functionsFound: this.diagnostics.functionsFound,
        modulesFound: this.diagnostics.modulesFound,
        eventsFound: this.diagnostics.eventsFound,
        relationshipsFound: this.diagnostics.relationshipsFound,
        errors: this.diagnostics.errors.length
      }
    };
    
    const diagnosticsPath = path.join(this.rootPath, 'cascade-kb-diagnostics.json');
    fs.writeFileSync(diagnosticsPath, JSON.stringify(diagnosticsData, null, 2));
    
    console.log(`Index saved to: ${indexPath}`);
    console.log(`Diagnostics saved to: ${diagnosticsPath}`);
    
    return { indexPath, diagnosticsPath };
  }

  // Search method
  search(query) {
    const queryTokens = this.tokenizeContent(query);
    const results = new Map();
    
    for (const token of queryTokens) {
      if (this.index.has(token)) {
        const matches = this.index.get(token);
        
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

  getStats() {
    return {
      filesScanned: this.diagnostics.filesScanned,
      filesIngested: this.diagnostics.filesIngested,
      totalTokens: this.diagnostics.totalTokens,
      uniqueTokens: this.index.size,
      functionsFound: this.diagnostics.functionsFound,
      modulesFound: this.diagnostics.modulesFound,
      eventsFound: this.diagnostics.eventsFound,
      relationshipsFound: this.diagnostics.relationshipsFound,
      errors: this.diagnostics.errors.length
    };
  }
}

// CLI interface
if (require.main === module) {
  const expansion = new CascadeKnowledgeExpansion();
  
  (async () => {
    try {
      await expansion.expandKnowledgeBase();
      
      console.log('\n=== EXPANSION COMPLETE ===');
      console.log('Stats:', expansion.getStats());
      
    } catch (error) {
      console.log(`Expansion failed: ${error.message}`);
      process.exit(1);
    }
  })();
}

module.exports = { CascadeKnowledgeExpansion };
