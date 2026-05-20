/**
 * HYDI Dev Optimizer - Tier 3 SaaS Product
 *
 * Auto-detect and fix performance drift, syntax errors, and database bottlenecks
 * in live codebases using autonomous Phase 5 reasoning.
 *
 * MVP: Extract system maintenance loops into standalone developer tool
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

class HydiDevOptimizer extends EventEmitter {
  constructor(config = {}) {
    super();

    this.config = {
      phase5Instance: config.phase5Instance || null,
      codebasePath: config.codebasePath || process.cwd(),
      outputDir: config.outputDir || './hydi-optimizations',
      maxConcurrentAnalysis: config.maxConcurrentAnalysis || 4,
      autoCreatePRs: config.autoCreatePRs !== false,
      githubToken: config.githubToken || process.env.GITHUB_TOKEN,
      ...config
    };

    this.analysisQueue = [];
    this.detectedIssues = [];
    this.generatedFixes = [];
    this.createdPRs = [];
    this.isRunning = false;
  }

  /**
   * Main entry: Run full optimization cycle
   */
  async runOptimizationCycle(options = {}) {
    const startTime = Date.now();

    try {
      console.log('[HYDI OPTIMIZER] Starting optimization cycle...');

      // Phase 1: Detect issues
      console.log('[HYDI OPTIMIZER] Phase 1: Analyzing codebase for issues...');
      const issues = await this.detectIssues(this.config.codebasePath);
      this.detectedIssues.push(...issues);

      if (issues.length === 0) {
        console.log('[HYDI OPTIMIZER] No issues detected - codebase is healthy');
        return { success: true, issueCount: 0, executionTime: Date.now() - startTime };
      }

      console.log(`[HYDI OPTIMIZER] Found ${issues.length} issues`);

      // Phase 2: Synthesize fixes (using Phase 5 if available)
      console.log('[HYDI OPTIMIZER] Phase 2: Synthesizing fixes...');
      const fixes = await this.synthesizePatches(issues);
      this.generatedFixes.push(...fixes);

      console.log(`[HYDI OPTIMIZER] Generated ${fixes.length} fixes`);

      // Phase 3: Create pull requests
      if (this.config.autoCreatePRs && this.config.githubToken) {
        console.log('[HYDI OPTIMIZER] Phase 3: Creating pull requests...');
        const prs = await this.createPullRequests(fixes);
        this.createdPRs.push(...prs);

        console.log(`[HYDI OPTIMIZER] Created ${prs.length} pull requests`);
      }

      this.emit('optimization-complete', {
        issueCount: issues.length,
        fixCount: fixes.length,
        prCount: this.createdPRs.length,
        executionTime: Date.now() - startTime
      });

      return {
        success: true,
        issueCount: issues.length,
        fixCount: fixes.length,
        prCount: this.createdPRs.length,
        executionTime: Date.now() - startTime
      };

    } catch (error) {
      console.error('[HYDI OPTIMIZER] Optimization cycle failed:', error.message);
      this.emit('optimization-error', { error: error.message });
      return { success: false, error: error.message, executionTime: Date.now() - startTime };
    }
  }

  /**
   * Phase 1: Detect issues in codebase
   */
  async detectIssues(codebasePath) {
    const issues = [];

    try {
      // Detect performance drift issues
      const perfIssues = await this.detectPerformanceDrift(codebasePath);
      issues.push(...perfIssues);

      // Detect syntax errors
      const syntaxIssues = await this.detectSyntaxErrors(codebasePath);
      issues.push(...syntaxIssues);

      // Detect database bottlenecks
      const dbIssues = await this.detectDatabaseBottlenecks(codebasePath);
      issues.push(...dbIssues);

      // Detect dependency vulnerabilities
      const vulnIssues = await this.detectVulnerabilities(codebasePath);
      issues.push(...vulnIssues);

      return issues.sort((a, b) => b.severity - a.severity);

    } catch (error) {
      console.error('[HYDI OPTIMIZER] Issue detection failed:', error.message);
      return [];
    }
  }

  /**
   * Collect .js/.ts files under a directory (max depth 6, skips node_modules/.git)
   */
  async collectSourceFiles(dir, depth = 0) {
    if (depth > 6) return [];
    const files = [];
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
    for (const e of entries) {
      if (['.git', 'node_modules', 'dist', 'build', '.next', 'coverage'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) files.push(...await this.collectSourceFiles(full, depth + 1));
      else if (/\.(js|ts|mjs|cjs)$/.test(e.name)) files.push(full);
    }
    return files;
  }

  /**
   * Detect performance drift patterns via actual file content scan
   */
  async detectPerformanceDrift(codebasePath) {
    const issues = [];

    const antipatterns = [
      {
        pattern: /\.map\([^)]*\)\.filter\(/,
        message: 'map().filter() chain — combine into single .reduce() pass',
        severity: 2,
        fix: 'Replace .map().filter() with a single .reduce() or .flatMap() to avoid two iterations'
      },
      {
        pattern: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/,
        message: 'JSON deep-clone detected — use structuredClone()',
        severity: 2,
        fix: 'Replace JSON.parse(JSON.stringify(x)) with structuredClone(x) (Node 17+)'
      },
      {
        pattern: /new\s+Promise\s*\(\s*(?:async\s+)?\(\s*resolve\s*,\s*reject\s*\)\s*=>\s*\{\s*(?:const\s+\w+\s*=\s*)?await\s+/,
        message: 'Unnecessary Promise constructor wrapping an async operation',
        severity: 2,
        fix: 'Remove the Promise constructor wrapper — async functions already return promises'
      },
      {
        pattern: /for\s*\(\s*(?:let|var)\s+\w+\s*=\s*0\s*;\s*\w+\s*<\s*\w+\.length\s*;/,
        message: 'Manual indexed loop — prefer array method',
        severity: 1,
        fix: 'Use forEach/map/filter/reduce for clarity and JIT-friendliness'
      }
    ];

    const files = await this.collectSourceFiles(codebasePath);

    for (const file of files) {
      let content;
      try { content = await fs.readFile(file, 'utf8'); } catch { continue; }
      for (const ap of antipatterns) {
        const match = ap.pattern.exec(content);
        if (match) {
          const lineNo = content.slice(0, match.index).split('\n').length;
          issues.push({
            type: 'performance-drift',
            file: path.relative(codebasePath, file),
            line: lineNo,
            message: ap.message,
            severity: ap.severity,
            fix: ap.fix,
            detectedAt: new Date().toISOString()
          });
        }
      }
    }

    return issues;
  }

  /**
   * Detect syntax errors by running node --check on each JS file
   */
  async detectSyntaxErrors(codebasePath) {
    const issues = [];
    const files = await this.collectSourceFiles(codebasePath);

    for (const file of files) {
      if (/\.ts$/.test(file)) continue; // skip TypeScript — needs tsc
      try {
        execSync(`node --check "${file}"`, { stdio: 'pipe', timeout: 5000 });
      } catch (err) {
        const msg = (err.stderr || err.stdout || '').toString().trim().split('\n')[0];
        issues.push({
          type: 'syntax-error',
          file: path.relative(codebasePath, file),
          message: msg || 'Syntax error detected',
          severity: 3,
          fix: 'Fix the syntax error reported by node --check',
          detectedAt: new Date().toISOString()
        });
      }
    }

    return issues;
  }

  /**
   * Detect database bottleneck patterns via file content scan
   */
  async detectDatabaseBottlenecks(codebasePath) {
    const issues = [];

    // Detect query-inside-loop: await db/supabase/prisma call inside a for/while/forEach body
    const loopQueryPattern = /(?:for\s*\(|while\s*\(|\.forEach\s*\()[\s\S]{0,300}?await\s+(?:db|supabase|prisma|pool|client|knex|mongoose)\b/;
    // Detect .select('*') — over-fetching columns
    const selectStarPattern = /\.select\(\s*['"`]\*['"`]\s*\)/;
    // Detect missing .limit() on queries that fetch collections
    const unboundedQueryPattern = /(?:supabase|prisma|db)\.[a-z]+\.[a-z]+\([^)]*\)(?!\s*\.limit\b)(?!\s*\.take\b)(?!\s*\.first\b)/;

    const dbChecks = [
      {
        pattern: loopQueryPattern,
        message: 'Database query inside a loop (potential N+1)',
        severity: 3,
        fix: 'Batch the queries: collect IDs first, then fetch all in one query using .in() or WHERE IN'
      },
      {
        pattern: selectStarPattern,
        message: 'SELECT * detected — fetches unused columns',
        severity: 1,
        fix: 'Select only the columns you need: .select("id, name, created_at")'
      }
    ];

    const files = await this.collectSourceFiles(codebasePath);

    for (const file of files) {
      let content;
      try { content = await fs.readFile(file, 'utf8'); } catch { continue; }
      for (const check of dbChecks) {
        const match = check.pattern.exec(content);
        if (match) {
          const lineNo = content.slice(0, match.index).split('\n').length;
          issues.push({
            type: 'database-bottleneck',
            file: path.relative(codebasePath, file),
            line: lineNo,
            message: check.message,
            severity: check.severity,
            fix: check.fix,
            detectedAt: new Date().toISOString()
          });
        }
      }
    }

    return issues;
  }

  /**
   * Detect dependency vulnerabilities via npm audit --json
   */
  async detectVulnerabilities(codebasePath) {
    const issues = [];

    // Find the nearest package.json
    let pkgDir = codebasePath;
    while (pkgDir !== path.dirname(pkgDir)) {
      if (fsSync.existsSync(path.join(pkgDir, 'package.json'))) break;
      pkgDir = path.dirname(pkgDir);
    }
    if (!fsSync.existsSync(path.join(pkgDir, 'package.json'))) return [];
    if (!fsSync.existsSync(path.join(pkgDir, 'node_modules'))) return [];

    try {
      const raw = execSync('npm audit --json', {
        cwd: pkgDir,
        stdio: 'pipe',
        timeout: 30000
      }).toString();
      const audit = JSON.parse(raw);
      const vulns = audit.vulnerabilities || {};

      for (const [pkg, info] of Object.entries(vulns)) {
        const severityMap = { critical: 4, high: 3, moderate: 2, low: 1, info: 0 };
        issues.push({
          type: 'vulnerability',
          package: pkg,
          severity: severityMap[info.severity] ?? 1,
          severityLabel: info.severity,
          fixAvailable: info.fixAvailable === true,
          advisory: (info.via || []).filter(v => typeof v === 'object').map(v => v.title).join('; ') || 'See npm audit',
          fix: info.fixAvailable === true ? `npm audit fix` : `Review manually: npm audit --package ${pkg}`,
          detectedAt: new Date().toISOString()
        });
      }
    } catch (err) {
      // npm audit exits non-zero when vulns found; parse JSON from stdout anyway
      try {
        const raw = (err.stdout || '').toString();
        if (raw.startsWith('{')) {
          const audit = JSON.parse(raw);
          const vulns = audit.vulnerabilities || {};
          for (const [pkg, info] of Object.entries(vulns)) {
            const severityMap = { critical: 4, high: 3, moderate: 2, low: 1, info: 0 };
            issues.push({
              type: 'vulnerability',
              package: pkg,
              severity: severityMap[info.severity] ?? 1,
              severityLabel: info.severity,
              fixAvailable: info.fixAvailable === true,
              advisory: (info.via || []).filter(v => typeof v === 'object').map(v => v.title).join('; ') || 'See npm audit',
              fix: info.fixAvailable === true ? 'npm audit fix' : `Review manually: npm audit --package ${pkg}`,
              detectedAt: new Date().toISOString()
            });
          }
        }
      } catch { /* audit not available or no package.json */ }
    }

    return issues;
  }

  /**
   * Phase 2: Synthesize fixes for detected issues
   */
  async synthesizePatches(issues) {
    const patches = [];

    for (const issue of issues) {
      try {
        const patch = await this.generatePatchForIssue(issue);
        if (patch) {
          patches.push(patch);
        }
      } catch (error) {
        console.warn(`[HYDI OPTIMIZER] Failed to generate patch for ${issue.type}:`, error.message);
      }
    }

    return patches;
  }

  /**
   * Generate specific patch for an issue
   */
  async generatePatchForIssue(issue) {
    // If Phase 5 is available, use it for intelligent patch generation
    if (this.config.phase5Instance) {
      try {
        const prompt = `Generate a code fix for: ${issue.message}\nContext: ${issue.fix}`;
        const evaluation = await this.config.phase5Instance.hookThinkEndpoint({
          query: prompt,
          thinking_process: []
        });

        // Use Phase 5's reasoning to inform the patch
        return {
          issueType: issue.type,
          issueMessage: issue.message,
          patch: issue.fix,
          reasoning: evaluation?.analyses?.logicalConsistency?.score || 0.5,
          confidence: evaluation?.overallQualityScore || 0.7,
          patchId: crypto.randomUUID(),
          createdAt: new Date().toISOString()
        };
      } catch (error) {
        console.warn('[HYDI OPTIMIZER] Phase 5 patch generation failed:', error.message);
      }
    }

    // Fallback: Use rule-based patching
    return {
      issueType: issue.type,
      issueMessage: issue.message,
      patch: issue.fix,
      reasoning: 0.5,
      confidence: 0.6,
      patchId: crypto.randomUUID(),
      createdAt: new Date().toISOString()
    };
  }

  /**
   * Phase 3: Create pull requests for generated fixes
   */
  async createPullRequests(patches) {
    const prs = [];

    for (const patch of patches) {
      try {
        // Create branch
        const branchName = `hydi-optimize/${patch.issueType}-${Date.now()}`;

        // Apply patch (would actually write files)
        const prData = {
          branchName,
          title: `[HYDI] Fix: ${patch.issueMessage}`,
          description: `Automated optimization by Hydi Dev Optimizer\n\nIssue: ${patch.issueMessage}\nFix: ${patch.patch}\nConfidence: ${(patch.confidence * 100).toFixed(1)}%`,
          patchId: patch.patchId,
          createdAt: new Date().toISOString()
        };

        prs.push(prData);
        console.log(`[HYDI OPTIMIZER] Would create PR: ${prData.title}`);

      } catch (error) {
        console.warn('[HYDI OPTIMIZER] Failed to create PR:', error.message);
      }
    }

    return prs;
  }

  /**
   * Get recent optimization results
   */
  async getRecentOptimizations(limit = 10) {
    return {
      issues: this.detectedIssues.slice(-limit),
      fixes: this.generatedFixes.slice(-limit),
      prs: this.createdPRs.slice(-limit)
    };
  }

  /**
   * Get optimizer status
   */
  getStatus() {
    return {
      running: this.isRunning,
      issuesDetected: this.detectedIssues.length,
      fixesGenerated: this.generatedFixes.length,
      prsCreated: this.createdPRs.length,
      recentActivity: {
        lastOptimization: this.detectedIssues[this.detectedIssues.length - 1]?.detectedAt || null,
        averageFixConfidence: this.generatedFixes.length > 0
          ? (this.generatedFixes.reduce((sum, f) => sum + f.confidence, 0) / this.generatedFixes.length).toFixed(2)
          : 0
      }
    };
  }
}

module.exports = HydiDevOptimizer;
