'use strict';

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * RepositoryAuditor statically analyzes the HYDI repository to discover
 * subsystems, build dependency graphs, and identify architectural risks.
 *
 * It is the foundation for the autonomous engineering and continuous
 * validation layers.
 */
class RepositoryAuditor {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.config = {
      rootDir: options.rootDir || path.resolve(__dirname, '../..'),
      sourceDirs: options.sourceDirs || ['src'],
      exclude: options.exclude || [
        'node_modules',
        '.next',
        '.git',
        'data',
        'manifests',
        'tmp',
        'coverage',
        'dist',
      ],
      ...options,
    };
    this.files = new Map();
    this.modules = [];
    this.graph = { nodes: [], edges: [] };
    this.issues = [];
  }

  async scan() {
    this.files.clear();
    this.modules = [];
    this.issues = [];
    for (const dir of this.config.sourceDirs) {
      await this._walk(path.join(this.config.rootDir, dir), dir);
    }
    this._buildGraph();
    return {
      modules: this.modules,
      graph: this.graph,
      issues: this.issues,
      summary: this._summary(),
    };
  }

  async _walk(dir, rootLabel) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(this.config.rootDir, full);
      if (this._shouldExclude(rel, entry.name)) continue;
      if (entry.isDirectory()) {
        await this._walk(full, rootLabel);
      } else {
        await this._analyzeFile(full, rel, rootLabel);
      }
    }
  }

  _shouldExclude(rel, name) {
    const parts = rel.split(path.sep);
    return parts.some((p) => this.config.exclude.includes(p));
  }

  async _analyzeFile(full, rel, rootLabel) {
    const ext = path.extname(full);
    const info = {
      path: full,
      rel,
      ext,
      lineCount: 0,
      bytes: 0,
      imports: [],
      exports: [],
      classes: [],
      functions: [],
      timers: { setInterval: 0, setTimeout: 0, clearInterval: 0, clearTimeout: 0 },
      childProcesses: 0,
      eventEmitters: 0,
      promises: false,
      sqlTables: [],
      category: this._categorize(rel),
    };

    try {
      const content = await fs.readFile(full, 'utf8');
      info.content = content;
      info.bytes = content.length;
      info.lineCount = content.split('\n').length;

      if (ext === '.js' || ext === '.mjs' || ext === '.ts') {
        this._analyzeJs(content, info);
      } else if (ext === '.sql') {
        this._analyzeSql(content, info);
      } else if (ext === '.json') {
        this._analyzeJson(content, info);
      }

      this.files.set(rel, info);

      if (info.category) {
        this.modules.push({
          id: this._moduleId(rel),
          path: rel,
          category: info.category,
          classes: info.classes,
          functions: info.functions,
          exports: info.exports,
        });
      }
    } catch (err) {
      this.issues.push({ file: rel, type: 'read_error', message: err.message });
    }
  }

  _analyzeJs(content, info) {
    // Imports / requires
    const importRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+.*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = importRegex.exec(content)) !== null) {
      const target = m[1] || m[2] || m[3];
      if (target && !info.imports.includes(target)) info.imports.push(target);
    }

    // Exports
    const exportRegex = /module\.exports\s*=\s*([A-Za-z0-9_]+)|module\.exports\.([A-Za-z0-9_]+)|exports\.([A-Za-z0-9_]+)/g;
    while ((m = exportRegex.exec(content)) !== null) {
      const name = m[1] || m[2] || m[3];
      if (name && !info.exports.includes(name)) info.exports.push(name);
    }

    // Classes
    const classRegex = /class\s+([A-Za-z0-9_]+)\s+(?:extends\s+\S+\s+)?\{/g;
    while ((m = classRegex.exec(content)) !== null) {
      info.classes.push(m[1]);
    }

    // Functions
    const fnRegex = /(?:async\s+)?(?:function\s+([A-Za-z0-9_]+)|([A-Za-z0-9_]+)\s*[:=]\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>))/g;
    while ((m = fnRegex.exec(content)) !== null) {
      const name = m[1] || m[2];
      if (name && !info.functions.includes(name)) info.functions.push(name);
    }

    // Timers
    info.timers.setInterval = (content.match(/setInterval\s*\(/g) || []).length;
    info.timers.setTimeout = (content.match(/setTimeout\s*\(/g) || []).length;
    info.timers.clearInterval = (content.match(/clearInterval\s*\(/g) || []).length;
    info.timers.clearTimeout = (content.match(/clearTimeout\s*\(/g) || []).length;

    // Unqualified child-process invocation
    info.childProcesses = (content.match(/(?:^|[^.$\w])(execFile|exec|spawn|fork)\s*\(/gm) || []).length;

    // EventEmitter
    info.eventEmitters = (content.match(/new\s+EventEmitter\s*\(/g) || []).length;

    info.promises = /\basync\b/.test(content) && /\bawait\b/.test(content);
  }

  _analyzeSql(content, info) {
    const matches = content.match(/CREATE\s+(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_.]*)/gi);
    if (matches) {
      info.sqlTables = matches.map((m) => m.replace(/CREATE\s+(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, '').trim());
    }
  }

  _analyzeJson(content, info) {
    try {
      const parsed = JSON.parse(content);
      if (parsed.scripts) info.scripts = Object.keys(parsed.scripts);
      if (parsed.bin) info.bin = Object.keys(parsed.bin);
      if (parsed.dependencies) info.dependencies = Object.keys(parsed.dependencies);
    } catch {
      // ignore malformed JSON
    }
  }

  _categorize(rel) {
    const lower = rel.toLowerCase();
    if (lower.includes('agent')) return 'agent';
    if (lower.includes('service')) return 'service';
    if (lower.includes('adapter')) return 'adapter';
    if (lower.includes('watchdog')) return 'watchdog';
    if (lower.includes('memory')) return 'memory';
    if (lower.includes('event')) return 'event';
    if (lower.includes('bus')) return 'bus';
    if (lower.includes('kernel')) return 'kernel';
    if (lower.includes('doctor')) return 'cli';
    if (lower.includes('factory')) return 'factory';
    if (lower.includes('dashboard')) return 'dashboard';
    if (lower.includes('server')) return 'server';
    if (lower.includes('route')) return 'route';
    if (lower.includes('test')) return 'test';
    if (lower.includes('hydi-v4')) return 'v4-core';
    if (lower.includes('hydi-v3')) return 'v3-layer';
    return 'module';
  }

  _moduleId(rel) {
    return rel.replace(/\\/g, '/').replace(/\.(js|ts|mjs)$/, '').replace(/\//g, '.');
  }

  _buildGraph() {
    const nodes = Array.from(this.files.values()).map((f) => ({
      id: this._moduleId(f.rel),
      path: f.rel,
      category: f.category,
      classes: f.classes,
    }));
    const edges = [];

    for (const f of this.files.values()) {
      const sourceId = this._moduleId(f.rel);
      for (const imp of f.imports) {
        if (imp.startsWith('.')) {
          const resolved = this._resolveImport(f.rel, imp);
          if (resolved) {
            edges.push({ source: sourceId, target: this._moduleId(resolved), type: 'internal' });
          }
        } else if (!imp.startsWith('/') && !imp.startsWith('@')) {
          edges.push({ source: sourceId, target: imp, type: 'external' });
        }
      }
    }

    this.graph = { nodes, edges };
  }

  _resolveImport(sourceRel, imp) {
    const dir = path.dirname(path.join(this.config.rootDir, sourceRel));
    const candidates = [
      path.join(dir, imp),
      path.join(dir, `${imp}.js`),
      path.join(dir, `${imp}.json`),
      path.join(dir, imp, 'index.js'),
    ];
    for (const c of candidates) {
      const rel = path.relative(this.config.rootDir, c);
      if (this.files.has(rel)) return rel;
    }
    return null;
  }

  findDeadCode() {
    const issues = [];
    const internalExports = new Map();
    for (const f of this.files.values()) {
      for (const exp of f.exports) {
        internalExports.set(`${f.rel}:${exp}`, { file: f.rel, name: exp });
      }
    }

    const used = new Set();
    for (const f of this.files.values()) {
      for (const imp of f.imports) {
        if (imp.startsWith('.')) {
          const resolved = this._resolveImport(f.rel, imp);
          if (resolved) used.add(`${resolved}:*`);
        }
      }
    }

    for (const [key, { file, name }] of internalExports) {
      const fileOnly = used.has(`${file}:*`);
      if (!fileOnly && name !== 'index' && !file.endsWith('index.js')) {
        issues.push({ file, name, type: 'potentially_unused_export' });
      }
    }
    return issues;
  }

  findDuplicateLogic() {
    const chunks = new Map();
    for (const f of this.files.values()) {
      if (f.ext !== '.js' && f.ext !== '.ts') continue;
      const lines = this._normalizeLines(this.files.get(f.rel)?.content || '').split('\n');
      for (let i = 0; i < lines.length - 4; i++) {
        const block = lines.slice(i, i + 5).join('\n');
        const hash = crypto.createHash('sha256').update(block).digest('hex').slice(0, 24);
        if (!chunks.has(hash)) chunks.set(hash, []);
        chunks.get(hash).push({ file: f.rel, startLine: i + 1 });
      }
    }
    return Array.from(chunks.values()).filter((locations) => locations.length > 1);
  }

  findCircularImports() {
    const adj = new Map();
    for (const edge of this.graph.edges) {
      if (edge.type !== 'internal') continue;
      if (!adj.has(edge.source)) adj.set(edge.source, []);
      adj.get(edge.source).push(edge.target);
    }
    const cycles = [];
    const visited = new Set();
    const stack = new Set();

    const dfs = (node, path) => {
      if (stack.has(node)) {
        const cycleStart = path.indexOf(node);
        cycles.push(path.slice(cycleStart).concat(node));
        return;
      }
      if (visited.has(node)) return;
      visited.add(node);
      stack.add(node);
      for (const next of adj.get(node) || []) {
        dfs(next, [...path, next]);
      }
      stack.delete(node);
    };

    for (const n of adj.keys()) dfs(n, [n]);
    return cycles;
  }

  findTimerLeaks() {
    const issues = [];
    for (const f of this.files.values()) {
      const { setInterval, setTimeout, clearInterval, clearTimeout } = f.timers;
      if (setInterval > clearInterval) {
        issues.push({ file: f.rel, type: 'timer_leak', detail: `${setInterval} setInterval vs ${clearInterval} clearInterval` });
      }
      if (setTimeout > clearTimeout) {
        issues.push({ file: f.rel, type: 'timer_imbalance', detail: `${setTimeout} setTimeout vs ${clearTimeout} clearTimeout` });
      }
    }
    return issues;
  }

  findResourceLeaks() {
    const issues = [];
    for (const f of this.files.values()) {
      if (f.childProcesses > 0 && !f.rel.includes('test')) {
        issues.push({ file: f.rel, type: 'child_process_usage', count: f.childProcesses });
      }
    }
    return issues;
  }

  generateReport() {
    const deadCode = this.findDeadCode();
    const duplicates = this.findDuplicateLogic();
    const cycles = this.findCircularImports();
    const timers = this.findTimerLeaks();
    const resources = this.findResourceLeaks();
    const categories = {};
    for (const m of this.modules) {
      categories[m.category] = (categories[m.category] || 0) + 1;
    }

    return {
      generatedAt: new Date().toISOString(),
      summary: this._summary(),
      categories,
      deadCodeCount: deadCode.length,
      duplicateBlockCount: duplicates.length,
      circularImportCount: cycles.length,
      timerLeakCount: timers.length,
      resourceLeakCount: resources.length,
      deadCode,
      duplicates: duplicates.slice(0, 20),
      cycles,
      timers,
      resources,
    };
  }

  _summary() {
    let totalLines = 0;
    let jsFiles = 0;
    for (const f of this.files.values()) {
      totalLines += f.lineCount;
      if (f.ext === '.js' || f.ext === '.ts') jsFiles += 1;
    }
    return {
      rootDir: this.config.rootDir,
      filesAnalyzed: this.files.size,
      jsFiles,
      modulesDiscovered: this.modules.length,
      totalLines,
    };
  }

  _normalizeLines(content) {
    return content
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter((l) => l.length > 0)
      .join('\n');
  }
}

module.exports = RepositoryAuditor;
