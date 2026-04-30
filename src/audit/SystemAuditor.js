/**
 * SYSTEM AUDITOR - Live Inventory Scanner
 * 
 * This is the brutal truth layer that scans reality instead of trusting memory.
 * 
 * What it does:
 * 1. Scans all files and functions in the repo
 * 2. Detects duplicates and redundancies
 * 3. Validates against system-manifest.json
 * 4. Enforces pre-flight checks before new additions
 * 5. Generates dependency graphs
 * 6. Runs automated audits
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class SystemAuditor {
  constructor(config = {}) {
    this.config = {
      repoRoot: config.repoRoot || path.resolve(__dirname, '../..'),
      manifestPath: config.manifestPath || path.resolve(__dirname, '../../system-manifest.json'),
      enableDuplicateDetection: config.enableDuplicateDetection !== false,
      enableDependencyTracking: config.enableDependencyTracking !== false,
      scanPatterns: config.scanPatterns || ['**/*.js', '**/*.json', '**/*.ps1', '**/*.sql'],
      excludePatterns: config.excludePatterns || ['node_modules/**', '.git/**', '**/test/**'],
      
      // Pre-flight check settings
      requireRegistration: config.requireRegistration !== false,
      blockUnregistered: config.blockUnregistered !== false,
      
      // Duplicate detection patterns
      duplicatePatterns: [
        'checkout',
        'webhook',
        'reflect',
        'drift',
        'audit',
        'payment',
        'model_selection',
        'action_gating',
        'revenue_tracking',
        'stripe',
        'supabase'
      ]
    };
    
    this.manifest = null;
    this.inventory = null;
    this.duplicates = [];
    this.violations = [];
    this.dependencyGraph = null;
    
    console.log('[SYSTEM AUDITOR] Initialized');
    console.log(`[AUDITOR] Repo root: ${this.config.repoRoot}`);
    console.log(`[AUDITOR] Manifest: ${this.config.manifestPath}`);
  }
  
  /**
   * 1. Load and validate system manifest
   */
  async loadManifest() {
    try {
      const manifestData = await fs.readFile(this.config.manifestPath, 'utf8');
      this.manifest = JSON.parse(manifestData);
      
      console.log('[AUDITOR] System manifest loaded successfully');
      console.log(`[AUDITOR] Manifest version: ${this.manifest.manifest.version}`);
      
      return true;
    } catch (error) {
      console.error('[AUDITOR] Failed to load manifest:', error.message);
      this.manifest = null;
      return false;
    }
  }
  
  /**
   * 2. Live inventory scan - discover what actually exists
   */
  async scanInventory() {
    console.log('[AUDITOR] Starting live inventory scan...');
    
    this.inventory = {
      files: [],
      functions: [],
      classes: [],
      imports: [],
      exports: [],
      scheduled: [],
      webhooks: [],
      endpoints: [],
      externalIntegrations: [],
      lastScan: new Date().toISOString()
    };
    
    // Scan all files
    const files = await this.scanFiles();
    this.inventory.files = files;
    
    // Analyze each file
    for (const file of files) {
      await this.analyzeFile(file);
    }
    
    console.log(`[AUDITOR] Inventory scan completed:`);
    console.log(`  Files scanned: ${files.length}`);
    console.log(`  Functions found: ${this.inventory.functions.length}`);
    console.log(`  Classes found: ${this.inventory.classes.length}`);
    console.log(`  Imports found: ${this.inventory.imports.length}`);
    
    return this.inventory;
  }
  
  async scanFiles() {
    const files = [];
    
    // Use find to get all matching files
    try {
      const output = execSync(`find "${this.config.repoRoot}" -type f \\( ${this.config.scanPatterns.map(pattern => `-name "${pattern}"`).join(' -o ')} \\)`, { encoding: 'utf8' });
      const filePaths = output.trim().split('\n').filter(f => f.length > 0);
      
      for (const filePath of filePaths) {
        // Skip excluded patterns
        const relativePath = path.relative(this.config.repoRoot, filePath);
        const excluded = this.config.excludePatterns.some(pattern => 
          relativePath.includes(pattern.replace('**/', '').replace('*', ''))
        );
        
        if (!excluded) {
          files.push({
            path: filePath,
            relativePath,
            size: (await fs.stat(filePath)).size,
            modified: (await fs.stat(filePath)).mtime.toISOString()
          });
        }
      }
    } catch (error) {
      console.error('[AUDITOR] File scan failed:', error.message);
    }
    
    return files;
  }
  
  async analyzeFile(file) {
    try {
      const content = await fs.readFile(file.path, 'utf8');
      const lines = content.split('\n');
      
      // Extract functions
      const functions = this.extractFunctions(content, file.relativePath);
      this.inventory.functions.push(...functions);
      
      // Extract classes
      const classes = this.extractClasses(content, file.relativePath);
      this.inventory.classes.push(...classes);
      
      // Extract imports
      const imports = this.extractImports(content, file.relativePath);
      this.inventory.imports.push(...imports);
      
      // Extract exports
      const exports = this.extractExports(content, file.relativePath);
      this.inventory.exports.push(...exports);
      
      // Look for scheduled jobs
      const scheduled = this.extractScheduledJobs(content, file.relativePath);
      this.inventory.scheduled.push(...scheduled);
      
      // Look for webhooks
      const webhooks = this.extractWebhooks(content, file.relativePath);
      this.inventory.webhooks.push(...webhooks);
      
      // Look for API endpoints
      const endpoints = this.extractEndpoints(content, file.relativePath);
      this.inventory.endpoints.push(...endpoints);
      
      // Look for external integrations
      const integrations = this.extractExternalIntegrations(content, file.relativePath);
      this.inventory.externalIntegrations.push(...integrations);
      
    } catch (error) {
      console.error(`[AUDITOR] Failed to analyze ${file.relativePath}:`, error.message);
    }
  }
  
  extractFunctions(content, filePath) {
    const functions = [];
    const lines = content.split('\n');
    
    // Function patterns
    const patterns = [
      /function\s+(\w+)\s*\(/,
      /const\s+(\w+)\s*=\s*(?:async\s+)?\(/,
      /(\w+)\s*:\s*(?:async\s+)?function\s*\(/,
      /async\s+function\s+(\w+)\s*\(/,
      /exports\.(\w+)\s*=\s*(?:async\s+)?function/
    ];
    
    lines.forEach((line, index) => {
      patterns.forEach(pattern => {
        const match = line.match(pattern);
        if (match) {
          functions.push({
            name: match[1],
            line: index + 1,
            file: filePath,
            type: 'function',
            signature: line.trim()
          });
        }
      });
    });
    
    return functions;
  }
  
  extractClasses(content, filePath) {
    const classes = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      const match = line.match(/class\s+(\w+)/);
      if (match) {
        classes.push({
          name: match[1],
          line: index + 1,
          file: filePath,
          type: 'class'
        });
      }
    });
    
    return classes;
  }
  
  extractImports(content, filePath) {
    const imports = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // require() patterns
      const requireMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
      if (requireMatch) {
        imports.push({
          source: requireMatch[1],
          line: index + 1,
          file: filePath,
          type: 'require'
        });
      }
      
      // import patterns
      const importMatch = line.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        imports.push({
          source: importMatch[1],
          line: index + 1,
          file: filePath,
          type: 'import'
        });
      }
    });
    
    return imports;
  }
  
  extractExports(content, filePath) {
    const exports = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // module.exports patterns
      const moduleExportMatch = line.match(/module\.exports\s*=\s*(\w+)/);
      if (moduleExportMatch) {
        exports.push({
          name: moduleExportMatch[1],
          line: index + 1,
          file: filePath,
          type: 'module.exports'
        });
      }
      
      // exports.X patterns
      const exportMatch = line.match(/exports\.(\w+)/);
      if (exportMatch) {
        exports.push({
          name: exportMatch[1],
          line: index + 1,
          file: filePath,
          type: 'exports'
        });
      }
    });
    
    return exports;
  }
  
  extractScheduledJobs(content, filePath) {
    const scheduled = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // Cron pattern
      if (line.includes('cron') || line.includes('schedule') || line.includes('setInterval')) {
        scheduled.push({
          pattern: line.trim(),
          line: index + 1,
          file: filePath,
          type: 'scheduled'
        });
      }
    });
    
    return scheduled;
  }
  
  extractWebhooks(content, filePath) {
    const webhooks = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      if (line.includes('webhook') || line.includes('stripe') || line.includes('webhook')) {
        webhooks.push({
          pattern: line.trim(),
          line: index + 1,
          file: filePath,
          type: 'webhook'
        });
      }
    });
    
    return webhooks;
  }
  
  extractEndpoints(content, filePath) {
    const endpoints = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // Express route patterns
      const routeMatch = line.match(/(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/);
      if (routeMatch) {
        endpoints.push({
          method: routeMatch[1].toUpperCase(),
          path: routeMatch[2],
          line: index + 1,
          file: filePath,
          type: 'endpoint'
        });
      }
    });
    
    return endpoints;
  }
  
  extractExternalIntegrations(content, filePath) {
    const integrations = [];
    const lines = content.split('\n');
    
    lines.forEach((line, index) => {
      // Look for common integration patterns
      this.config.duplicatePatterns.forEach(pattern => {
        if (line.toLowerCase().includes(pattern.toLowerCase())) {
          integrations.push({
            service: pattern,
            line: index + 1,
            file: filePath,
            context: line.trim(),
            type: 'integration'
          });
        }
      });
    });
    
    return integrations;
  }
  
  /**
   * 3. Redundancy detection
   */
  async detectRedundancies() {
    if (!this.inventory) {
      throw new Error('Inventory not loaded. Run scanInventory() first.');
    }
    
    console.log('[AUDITOR] Detecting redundancies...');
    this.duplicates = [];
    
    // Check for duplicate function names
    const functionGroups = this.groupBy(this.inventory.functions, 'name');
    for (const [name, functions] of functionGroups) {
      if (functions.length > 1) {
        this.duplicates.push({
          type: 'duplicate_function',
          name,
          locations: functions.map(f => ({ file: f.file, line: f.line })),
          severity: 'high'
        });
      }
    }
    
    // Check for duplicate class names
    const classGroups = this.groupBy(this.inventory.classes, 'name');
    for (const [name, classes] of classGroups) {
      if (classes.length > 1) {
        this.duplicates.push({
          type: 'duplicate_class',
          name,
          locations: classes.map(c => ({ file: c.file, line: c.line })),
          severity: 'high'
        });
      }
    }
    
    // Check for duplicate patterns
    for (const pattern of this.config.duplicatePatterns) {
      const patternMatches = this.inventory.externalIntegrations.filter(i => 
        i.service.toLowerCase() === pattern.toLowerCase()
      );
      
      if (patternMatches.length > 1) {
        this.duplicates.push({
          type: 'duplicate_pattern',
          pattern,
          locations: patternMatches.map(m => ({ file: m.file, line: m.line, context: m.context })),
          severity: 'medium'
        });
      }
    }
    
    console.log(`[AUDITOR] Found ${this.duplicates.length} redundancies:`);
    this.duplicates.forEach(dup => {
      console.log(`  ${dup.type}: ${dup.name || dup.pattern} (${dup.locations.length} locations)`);
    });
    
    return this.duplicates;
  }
  
  /**
   * 4. Build dependency graph
   */
  buildDependencyGraph() {
    if (!this.inventory) {
      throw new Error('Inventory not loaded. Run scanInventory() first.');
    }
    
    console.log('[AUDITOR] Building dependency graph...');
    
    this.dependencyGraph = {
      nodes: [],
      edges: [],
      orphans: [],
      circular: []
    };
    
    // Create nodes from classes and exported functions
    const allNodes = [
      ...this.inventory.classes.map(c => ({ id: c.name, type: 'class', file: c.file })),
      ...this.inventory.exports.map(e => ({ id: e.name, type: 'export', file: e.file }))
    ];
    
    this.dependencyGraph.nodes = allNodes;
    
    // Create edges from imports
    this.inventory.imports.forEach(imp => {
      const sourceNode = allNodes.find(n => imp.file.includes(n.file));
      const targetNode = allNodes.find(n => imp.source.includes(n.id));
      
      if (sourceNode && targetNode) {
        this.dependencyGraph.edges.push({
          from: sourceNode.id,
          to: targetNode.id,
          type: 'import',
          file: imp.file
        });
      }
    });
    
    // Detect circular dependencies
    this.dependencyGraph.circular = this.detectCircularDependencies();
    
    // Find orphan nodes
    const connectedNodes = new Set();
    this.dependencyGraph.edges.forEach(edge => {
      connectedNodes.add(edge.from);
      connectedNodes.add(edge.to);
    });
    
    this.dependencyGraph.orphans = allNodes.filter(node => !connectedNodes.has(node.id));
    
    console.log(`[AUDITOR] Dependency graph built:`);
    console.log(`  Nodes: ${this.dependencyGraph.nodes.length}`);
    console.log(`  Edges: ${this.dependencyGraph.edges.length}`);
    console.log(`  Circular dependencies: ${this.dependencyGraph.circular.length}`);
    console.log(`  Orphan nodes: ${this.dependencyGraph.orphans.length}`);
    
    return this.dependencyGraph;
  }
  
  detectCircularDependencies() {
    const circular = [];
    const visited = new Set();
    const recursionStack = new Set();
    
    const dfs = (node, path) => {
      if (recursionStack.has(node)) {
        const cycleStart = path.indexOf(node);
        circular.push(path.slice(cycleStart).concat(node));
        return;
      }
      
      if (visited.has(node)) return;
      
      visited.add(node);
      recursionStack.add(node);
      
      const edges = this.dependencyGraph.edges.filter(e => e.from === node);
      for (const edge of edges) {
        dfs(edge.to, path.concat(node));
      }
      
      recursionStack.delete(node);
    };
    
    for (const node of this.dependencyGraph.nodes) {
      if (!visited.has(node)) {
        dfs(node.id, []);
      }
    }
    
    return circular;
  }
  
  /**
   * 5. Pre-flight check for new additions
   */
  async preFlightCheck(newComponent) {
    console.log('[AUDITOR] Running pre-flight check...');
    
    const check = {
      allowed: true,
      violations: [],
      recommendations: [],
      existingAlternatives: []
    };
    
    // Check if component already exists
    const existing = this.findExistingComponent(newComponent);
    if (existing) {
      check.violations.push({
        type: 'duplicate_component',
        message: `Component already exists: ${existing.name} in ${existing.file}`,
        severity: 'high'
      });
      check.existingAlternatives.push(existing);
    }
    
    // Check for similar patterns
    const similar = this.findSimilarPatterns(newComponent);
    if (similar.length > 0) {
      check.violations.push({
        type: 'similar_patterns',
        message: `Similar patterns found: ${similar.map(s => s.name).join(', ')}`,
        severity: 'medium'
      });
      check.existingAlternatives.push(...similar);
    }
    
    // Check if it would create circular dependencies
    const circularRisk = this.assessCircularDependencyRisk(newComponent);
    if (circularRisk) {
      check.violations.push({
        type: 'circular_dependency_risk',
        message: `Would create circular dependency: ${circularRisk}`,
        severity: 'high'
      });
    }
    
    // Check if it's an orphan
    const orphanRisk = this.assessOrphanRisk(newComponent);
    if (orphanRisk) {
      check.recommendations.push({
        type: 'orphan_risk',
        message: `Component may be orphaned: ${orphanRisk}`,
        severity: 'low'
      });
    }
    
    // Make decision
    if (this.config.blockUnregistered && check.violations.some(v => v.severity === 'high')) {
      check.allowed = false;
    }
    
    console.log(`[AUDITOR] Pre-flight check result: ${check.allowed ? 'ALLOWED' : 'BLOCKED'}`);
    console.log(`  Violations: ${check.violations.length}`);
    console.log(`  Recommendations: ${check.recommendations.length}`);
    
    return check;
  }
  
  findExistingComponent(newComponent) {
    if (!this.inventory) return null;
    
    // Check functions
    const existingFunc = this.inventory.functions.find(f => 
      f.name === newComponent.name
    );
    if (existingFunc) return existingFunc;
    
    // Check classes
    const existingClass = this.inventory.classes.find(c => 
      c.name === newComponent.name
    );
    if (existingClass) return existingClass;
    
    return null;
  }
  
  findSimilarPatterns(newComponent) {
    if (!this.inventory) return [];
    
    const similar = [];
    
    // Check for similar names
    const allNames = [
      ...this.inventory.functions.map(f => f.name),
      ...this.inventory.classes.map(c => c.name)
    ];
    
    for (const name of allNames) {
      if (this.stringSimilarity(newComponent.name, name) > 0.7 && name !== newComponent.name) {
        const component = this.inventory.functions.find(f => f.name === name) ||
                          this.inventory.classes.find(c => c.name === name);
        if (component) similar.push(component);
      }
    }
    
    return similar;
  }
  
  assessCircularDependencyRisk(newComponent) {
    // Simple assessment - would need more sophisticated analysis
    return null;
  }
  
  assessOrphanRisk(newComponent) {
    // Simple assessment - would need more sophisticated analysis
    return null;
  }
  
  stringSimilarity(s1, s2) {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    
    if (longer.length === 0) return 1.0;
    
    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }
  
  levenshteinDistance(s1, s2) {
    const matrix = [];
    
    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[s2.length][s1.length];
  }
  
  /**
   * 6. Automated system audit
   */
  async runAudit() {
    console.log('[AUDITOR] Running automated system audit...');
    
    const audit = {
      timestamp: new Date().toISOString(),
      manifest: null,
      inventory: null,
      duplicates: [],
      violations: [],
      recommendations: [],
      summary: {
        totalFiles: 0,
        totalFunctions: 0,
        totalClasses: 0,
        totalDuplicates: 0,
        totalViolations: 0,
        healthScore: 0
      }
    };
    
    try {
      // Load manifest
      const manifestLoaded = await this.loadManifest();
      audit.manifest = {
        loaded: manifestLoaded,
        version: this.manifest?.manifest?.version || 'unknown'
      };
      
      // Scan inventory
      await this.scanInventory();
      audit.inventory = {
        scanned: true,
        files: this.inventory.files.length,
        functions: this.inventory.functions.length,
        classes: this.inventory.classes.length,
        imports: this.inventory.imports.length,
        exports: this.inventory.exports.length
      };
      
      // Update summary
      audit.summary.totalFiles = this.inventory.files.length;
      audit.summary.totalFunctions = this.inventory.functions.length;
      audit.summary.totalClasses = this.inventory.classes.length;
      
      // Detect redundancies
      await this.detectRedundancies();
      audit.duplicates = this.duplicates;
      audit.summary.totalDuplicates = this.duplicates.length;
      
      // Build dependency graph
      this.buildDependencyGraph();
      
      // Validate against manifest
      const manifestValidation = this.validateAgainstManifest();
      audit.violations.push(...manifestValidation);
      audit.summary.totalViolations = audit.violations.length;
      
      // Generate recommendations
      audit.recommendations = this.generateRecommendations();
      
      // Calculate health score
      audit.summary.healthScore = this.calculateHealthScore(audit);
      
      // Store audit results
      await this.storeAuditResults(audit);
      
      console.log(`[AUDITOR] Audit completed:`);
      console.log(`  Health score: ${audit.summary.healthScore.toFixed(2)}/1.0`);
      console.log(`  Duplicates: ${audit.summary.totalDuplicates}`);
      console.log(`  Violations: ${audit.summary.totalViolations}`);
      console.log(`  Recommendations: ${audit.recommendations.length}`);
      
      return audit;
      
    } catch (error) {
      console.error('[AUDITOR] Audit failed:', error.message);
      audit.error = error.message;
      return audit;
    }
  }
  
  validateAgainstManifest() {
    const violations = [];
    
    if (!this.manifest) {
      violations.push({
        type: 'manifest_missing',
        message: 'System manifest not found or invalid',
        severity: 'high'
      });
      return violations;
    }
    
    // Check if all manifest services exist in inventory
    for (const [category, services] of Object.entries(this.manifest.services)) {
      for (const [serviceName, serviceInfo] of Object.entries(services)) {
        const exists = this.inventory.classes.find(c => c.name === serviceName) ||
                     this.inventory.exports.find(e => e.name === serviceName);
        
        if (!exists && serviceInfo.status === 'active') {
          violations.push({
            type: 'missing_service',
            message: `Service ${serviceName} declared in manifest but not found in inventory`,
            severity: 'medium'
          });
        }
      }
    }
    
    // Check for unregistered services
    for (const cls of this.inventory.classes) {
      const registered = this.isServiceRegistered(cls.name);
      if (!registered) {
        violations.push({
          type: 'unregistered_service',
          message: `Service ${cls.name} found but not registered in manifest`,
          severity: 'low'
        });
      }
    }
    
    return violations;
  }
  
  isServiceRegistered(serviceName) {
    if (!this.manifest) return false;
    
    for (const category of Object.values(this.manifest.services)) {
      if (category[serviceName]) return true;
    }
    
    return false;
  }
  
  generateRecommendations() {
    const recommendations = [];
    
    // Redundancy recommendations
    if (this.duplicates.length > 0) {
      recommendations.push({
        type: 'consolidation',
        message: `Found ${this.duplicates.length} duplicates. Consider consolidation.`,
        priority: 'high'
      });
    }
    
    // Orphan recommendations
    if (this.dependencyGraph && this.dependencyGraph.orphans.length > 0) {
      recommendations.push({
        type: 'cleanup',
        message: `Found ${this.dependencyGraph.orphans.length} orphan components. Consider removal.`,
        priority: 'medium'
      });
    }
    
    // Circular dependency recommendations
    if (this.dependencyGraph && this.dependencyGraph.circular.length > 0) {
      recommendations.push({
        type: 'refactoring',
        message: `Found ${this.dependencyGraph.circular.length} circular dependencies. Refactor required.`,
        priority: 'high'
      });
    }
    
    return recommendations;
  }
  
  calculateHealthScore(audit) {
    let score = 1.0;
    
    // Penalize duplicates
    score -= (audit.summary.totalDuplicates * 0.1);
    
    // Penalize violations
    score -= (audit.summary.totalViolations * 0.05);
    
    // Penalize circular dependencies
    if (this.dependencyGraph) {
      score -= (this.dependencyGraph.circular.length * 0.2);
    }
    
    return Math.max(0, score);
  }
  
  async storeAuditResults(audit) {
    try {
      const auditPath = path.join(this.config.repoRoot, 'audit-results.json');
      await fs.writeFile(auditPath, JSON.stringify(audit, null, 2));
      console.log(`[AUDITOR] Audit results stored to ${auditPath}`);
    } catch (error) {
      console.error('[AUDITOR] Failed to store audit results:', error.message);
    }
  }
  
  /**
   * Utility methods
   */
  groupBy(items, key) {
    const groups = new Map();
    for (const item of items) {
      const value = item[key];
      if (!groups.has(value)) {
        groups.set(value, []);
      }
      groups.get(value).push(item);
    }
    return groups;
  }
  
  /**
   * Get audit status
   */
  getAuditStatus() {
    return {
      manifestLoaded: !!this.manifest,
      inventoryScanned: !!this.inventory,
      duplicatesDetected: this.duplicates.length,
      dependencyGraphBuilt: !!this.dependencyGraph,
      lastAudit: this.inventory?.lastScan || null
    };
  }
}

module.exports = SystemAuditor;
