'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * ArchitectureAudit performs a static architecture review of the HYDI V3 module
 * set and the HYDISystem entry point.
 *
 * It detects:
 *   - circular require dependencies
 *   - duplicate exported functionality (method names)
 *   - unused exports / dead code
 *   - inconsistent naming
 *   - blocking fs.*Sync operations
 *   - async correctness issues (missing await, new Promise without reject)
 *   - race conditions
 *
 * Usage:
 *   const audit = new ArchitectureAudit({ rootDir: '...' });
 *   const report = await audit.run();
 */
class ArchitectureAudit {
  constructor(config = {}) {
    this.rootDir = config.rootDir || path.resolve(__dirname, '..', '..');
    this.v3Dir = config.v3Dir || path.join(this.rootDir, 'src', 'hydi-v3');
    this.systemFile = config.systemFile || path.join(this.rootDir, 'src', 'HYDISystem.js');
    this.includeSystem = config.includeSystem !== false;

    this.builtinModules = new Set([
      'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console',
      'constants', 'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain',
      'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
      'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'punycode',
      'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
      'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
      'worker_threads', 'zlib',
    ]);

    this.lifecycleMethods = new Set([
      'start', 'stop', 'destroy', 'initialize', 'getStatus', 'persist', 'load',
      'emit', 'on', 'once', 'off', 'addListener', 'removeListener', 'removeAllListeners',
      'toString', 'toJSON', 'valueOf',
    ]);

    // Method names that are commonly called synchronously and should not be
    // flagged for missing await because the target is usually a sync lifecycle.
    this.asyncSkipNames = new Set(['start', 'stop', 'shutdown']);

    this._fileSet = new Set();
  }

  async run() {
    const rawModules = await this._collectFiles();
    const modules = this._parseModules(rawModules);
    const v3Modules = modules.filter((m) => !m.isSystem);
    const dependencyGraph = this._buildDependencyGraph(modules);
    const circularDependencies = this._findCircularDependencies(dependencyGraph);
    const moduleBoundary = this._assessModuleBoundaries(modules);

    const issues = [];
    issues.push(...this._findDuplicateMethods(v3Modules));
    issues.push(...this._findUnusedExports(v3Modules, modules));
    issues.push(...this._findNamingIssues(v3Modules));
    issues.push(...this._findBlockingOperations(modules));
    issues.push(...this._findAsyncIssues(modules));
    issues.push(...this._findRaceConditions(modules));
    if (circularDependencies.length) {
      for (const cycle of circularDependencies) {
        issues.push(this._cycleToIssue(cycle));
      }
    }

    const recommendations = this._generateRecommendations(issues, moduleBoundary);
    const scores = this._computeScores(issues, v3Modules.length);
    const passed = !issues.some((i) => i.severity === 'critical' || i.severity === 'high');

    return {
      summary: {
        modulesAudited: v3Modules.length,
        systemFile: this.includeSystem ? path.relative(this.rootDir, this.systemFile) : null,
        totalFiles: modules.length,
        totalMethods: v3Modules.reduce((sum, m) => sum + m.methods.length, 0),
        issueCounts: this._countBySeverity(issues),
        passed,
        score: scores.overall,
        boundaries: moduleBoundary,
      },
      dependencyGraph,
      circularDependencies,
      issues,
      recommendations,
      scores,
    };
  }

  async _collectFiles() {
    const modules = [];
    const entries = await fs.readdir(this.v3Dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        modules.push({ filePath: path.join(this.v3Dir, entry.name), isSystem: false });
      }
    }

    if (this.includeSystem) {
      modules.push({ filePath: this.systemFile, isSystem: true });
    }

    for (const mod of modules) {
      mod.content = await fs.readFile(mod.filePath, 'utf8');
      mod.relPath = path.relative(this.rootDir, mod.filePath);
      mod.moduleName = path.basename(mod.filePath, '.js');
    }

    this._fileSet = new Set(modules.map((m) => m.filePath));
    return modules;
  }

  _parseModules(rawModules) {
    const modules = rawModules.map((raw) => this._parseModule(raw));
    this._instanceAliases = this._buildInstanceAliases(modules);

    for (const mod of modules) {
      mod.lines = mod.content.split('\n');
      mod.methods.sort((a, b) => a.line - b.line);
      for (let i = 0; i < mod.methods.length; i++) {
        const method = mod.methods[i];
        const next = mod.methods[i + 1];
        method.endLine = next ? next.line - 1 : mod.lines.length;
        method.bodyLines = mod.lines.slice(method.line - 1, method.endLine);
      }
    }

    return modules;
  }

  _parseModule(raw) {
    const mod = { ...raw };
    mod.exports = this._extractExports(mod);
    mod.requires = this._extractRequires(mod);
    mod.methods = this._extractMethods(mod);
    return mod;
  }

  _extractExports(mod) {
    const exports = [];
    const exportRegex = /module\.exports(?:\.([a-zA-Z_$][\w$]*))?\s*=\s*([^;\n]+);?/g;
    let match;
    while ((match = exportRegex.exec(mod.content)) !== null) {
      const name = match[1] ? match[1].trim() : null;
      const value = match[2].trim();
      const line = mod.content.slice(0, match.index).split('\n').length;
      exports.push({ name, value, line });
    }
    const classMatch = /class\s+([a-zA-Z_$][\w$]*)\s*\{/.exec(mod.content);
    mod.className = classMatch ? classMatch[1] : null;
    return exports;
  }

  _extractRequires(mod) {
    const requires = [];
    const regex = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    let match;
    while ((match = regex.exec(mod.content)) !== null) {
      const source = match[1];
      const line = mod.content.slice(0, match.index).split('\n').length;
      const resolved = this._resolveRequire(source, mod.filePath);
      requires.push({ source, line, ...resolved });
    }
    return requires;
  }

  _resolveRequire(source, fromFile) {
    if (!source.startsWith('.')) {
      return {
        isInternal: false,
        isBuiltin: this.builtinModules.has(source),
        resolved: null,
        externalName: source,
      };
    }

    const dir = path.dirname(fromFile);
    const base = path.resolve(dir, source);
    const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];

    for (const candidate of candidates) {
      if (this._fileSet.has(candidate)) {
        return {
          isInternal: true,
          isBuiltin: false,
          resolved: candidate,
          rel: path.relative(this.rootDir, candidate),
          externalName: null,
        };
      }
    }

    return {
      isInternal: false,
      isBuiltin: false,
      resolved: null,
      externalName: source,
    };
  }

  _extractMethods(mod) {
    const methods = [];
    const methodRegex = /^(\s*)((?:static\s+)?(?:async\s+)?)([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
    const keywordFilter = new Set([
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'catch', 'try',
      'finally', 'with', 'function', 'return', 'throw', 'new', 'await', 'async',
      'typeof', 'delete', 'void', 'instanceof', 'in', 'of', 'class', 'interface',
      'enum', 'import', 'export', 'default', 'extends', 'static', 'public',
      'private', 'protected', 'continue', 'break', 'debugger', 'var', 'let', 'const',
    ]);

    let match;
    while ((match = methodRegex.exec(mod.content)) !== null) {
      const name = match[3];
      if (keywordFilter.has(name) || name === 'constructor') {
        continue;
      }
      const line = mod.content.slice(0, match.index).split('\n').length;
      const isAsync = /\basync\b/.test(match[2]);
      methods.push({ name, line, async: isAsync });
    }

    return methods;
  }

  _buildInstanceAliases(modules) {
    const classToAliases = new Map();
    const regex = /this\.([a-zA-Z_$][\w$]*)\s*=\s*new\s+([a-zA-Z_$][\w$]*)\s*\(/g;

    for (const mod of modules) {
      let match;
      while ((match = regex.exec(mod.content)) !== null) {
        const alias = match[1];
        const className = match[2];
        if (!classToAliases.has(className)) {
          classToAliases.set(className, new Set());
        }
        classToAliases.get(className).add(alias);
      }
    }

    return classToAliases;
  }

  _getObjectNamesForModule(mod) {
    const names = new Set(['this', mod.moduleName, mod.className]);
    const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
    names.add(lowerFirst(mod.moduleName));
    names.add(lowerFirst(mod.className));

    const aliases = this._instanceAliases.get(mod.className) || new Set();
    for (const alias of aliases) {
      names.add(alias);
      names.add(`components.${alias}`);
      names.add(`manager.${alias}`);
    }

    // ChaosRunner and SoakTest receive a HYDIAutonomyManager instance as `manager`.
    if (mod.className === 'HYDIAutonomyManager' || mod.moduleName === 'AutonomyManager') {
      names.add('manager');
    }

    return Array.from(names).filter(Boolean);
  }

  _isDefinitionAt(mod, name, line) {
    return mod.methods.some((m) => m.name === name && m.line === line);
  }

  _isMethodUsed(method, mod, allModules) {
    const objectNames = this._getObjectNamesForModule(mod);
    if (!objectNames.length) {
      return false;
    }

    const escaped = objectNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const regex = new RegExp(`(?:^|[^\\w$])(?:${escaped})\\.${method.name}\\b`, 'g');

    for (const other of allModules) {
      const content = other.content;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const line = content.slice(0, match.index).split('\n').length;
        if (other.filePath === mod.filePath && this._isDefinitionAt(other, method.name, line)) {
          continue;
        }
        return true;
      }
    }

    return false;
  }

  _buildDependencyGraph(modules) {
    const nodes = modules.map((m) => ({
      id: m.relPath,
      name: m.moduleName,
      isSystem: m.isSystem,
    }));

    const internalEdges = [];
    const externalEdges = [];

    for (const mod of modules) {
      for (const req of mod.requires) {
        if (req.isInternal && req.resolved) {
          const target = modules.find((m) => m.filePath === req.resolved);
          if (target) {
            internalEdges.push({
              source: mod.relPath,
              target: target.relPath,
              sourceModule: mod.moduleName,
              targetModule: target.moduleName,
            });
          }
        } else {
          externalEdges.push({
            source: mod.relPath,
            module: req.externalName,
            builtin: req.isBuiltin,
          });
        }
      }
    }

    return { nodes, internalEdges, externalEdges };
  }

  _findCircularDependencies(graph) {
    const adj = new Map();
    for (const edge of graph.internalEdges) {
      if (!adj.has(edge.source)) {
        adj.set(edge.source, new Set());
      }
      adj.get(edge.source).add(edge.target);
    }

    const visited = new Set();
    const stack = [];
    const inStack = new Set();
    const cycles = [];

    const dfs = (node) => {
      visited.add(node);
      stack.push(node);
      inStack.add(node);

      for (const neighbor of adj.get(node) || []) {
        if (!visited.has(neighbor)) {
          dfs(neighbor);
        } else if (inStack.has(neighbor)) {
          const idx = stack.indexOf(neighbor);
          cycles.push(stack.slice(idx).concat([neighbor]));
        }
      }

      stack.pop();
      inStack.delete(node);
    };

    for (const node of adj.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  _cycleToIssue(cycle) {
    return {
      severity: 'high',
      category: 'circular_dependency',
      message: `Circular require dependency detected: ${cycle.join(' -> ')}`,
      details: { cycle },
    };
  }

  _assessModuleBoundaries(modules) {
    const v3Modules = modules.filter((m) => !m.isSystem);
    const system = modules.find((m) => m.isSystem);

    const externalToV3 = [];
    for (const mod of v3Modules) {
      for (const req of mod.requires) {
        if (!req.isInternal && !req.isBuiltin) {
          externalToV3.push({ module: mod.moduleName, require: req.externalName || req.source });
        }
      }
    }

    const systemToV3 = [];
    if (system) {
      for (const req of system.requires) {
        if (req.isInternal && req.resolved && req.resolved.startsWith(this.v3Dir)) {
          systemToV3.push(req.externalName || req.source);
        }
      }
    }

    return {
      v3OnlyUsesBuiltinsAndV3: externalToV3.length === 0,
      systemUsesV3Aggregator: systemToV3.some((s) => s === './hydi-v3' || s.endsWith('hydi-v3')),
      externalToV3,
      systemToV3,
    };
  }

  _findDuplicateMethods(v3Modules) {
    const map = new Map();
    for (const mod of v3Modules) {
      for (const m of mod.methods) {
        if (!map.has(m.name)) {
          map.set(m.name, []);
        }
        map.get(m.name).push({ module: mod.moduleName, file: mod.relPath, line: m.line });
      }
    }

    const issues = [];
    const common = [];
    for (const [name, locations] of map.entries()) {
      if (locations.length < 2) {
        continue;
      }
      const modulesList = locations.map((l) => l.module).join(', ');
      if (this.lifecycleMethods.has(name)) {
        common.push({ name, count: locations.length, modules: locations.map((l) => l.module) });
      } else {
        issues.push({
          severity: 'low',
          category: 'duplicate_functionality',
          file: locations[0].file,
          line: locations[0].line,
          message: `Method '${name}' is exported by ${locations.length} modules (${modulesList}).`,
          details: { name, modules: locations.map((l) => l.module) },
        });
      }
    }

    if (common.length) {
      const summary = common
        .sort((a, b) => b.count - a.count)
        .map((c) => `${c.name} (${c.count})`)
        .join(', ');
      issues.push({
        severity: 'info',
        category: 'duplicate_functionality',
        message: `Common lifecycle/status methods are duplicated across modules: ${summary}.`,
        details: { methods: common },
      });
    }

    return issues;
  }

  _findUnusedExports(v3Modules, allModules) {
    const issues = [];

    for (const mod of v3Modules) {
      const unused = [];
      for (const method of mod.methods) {
        if (this.lifecycleMethods.has(method.name)) {
          continue;
        }
        if (!this._isMethodUsed(method, mod, allModules)) {
          unused.push({ name: method.name, line: method.line });
        }
      }

      if (unused.length) {
        const names = unused.map((u) => u.name).join(', ');
        issues.push({
          severity: 'info',
          category: 'unused_export',
          file: mod.relPath,
          line: unused[0].line,
          message: `${mod.moduleName} has ${unused.length} public method(s) not referenced within the audited scope: ${names}.`,
          details: { module: mod.moduleName, methods: unused },
        });
      }
    }

    return issues;
  }

  _findNamingIssues(v3Modules) {
    const issues = [];
    const camelCase = /^[a-z_$][a-zA-Z0-9_$]*$/;

    for (const mod of v3Modules) {
      for (const m of mod.methods) {
        let name = m.name;
        if (name.startsWith('_')) {
          name = name.slice(1);
        }
        if (!camelCase.test(name) && !['toJSON', 'toString', 'valueOf'].includes(name)) {
          issues.push({
            severity: 'low',
            category: 'naming_convention',
            file: mod.relPath,
            line: m.line,
            message: `Method '${m.name}' in ${mod.moduleName} does not follow camelCase conventions.`,
            details: { method: m.name },
          });
        }
      }
    }

    return issues;
  }

  _findBlockingOperations(modules) {
    const issues = [];
    const blockingRegex = /\b(fs|child_process|crypto|os)?\.[\w$]*Sync\s*\(|\b(readFileSync|writeFileSync|mkdirSync|appendFileSync|existsSync|readdirSync|opendirSync|copyFileSync|renameSync|rmSync|rmdirSync|unlinkSync|statSync|accessSync|readlinkSync|realpathSync|mkdtempSync)\s*\(/g;

    for (const mod of modules) {
      for (let i = 0; i < mod.lines.length; i++) {
        const line = mod.lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
          continue;
        }
        let match;
        while ((match = blockingRegex.exec(line)) !== null) {
          issues.push({
            severity: 'critical',
            category: 'blocking_operation',
            file: mod.relPath,
            line: i + 1,
            message: `Blocking operation detected: ${match[0]}`,
            details: { match: match[0] },
          });
        }
      }
    }

    return issues;
  }

  _findAsyncIssues(modules) {
    const asyncMethods = new Set();
    for (const mod of modules) {
      for (const m of mod.methods) {
        if (m.async && !this.asyncSkipNames.has(m.name)) {
          asyncMethods.add(m.name);
        }
      }
    }

    const raw = [];
    for (const mod of modules) {
      for (const method of mod.methods) {
        for (let i = 0; i < method.bodyLines.length; i++) {
          const line = method.bodyLines[i];
          const lineNo = method.line + i;
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
            continue;
          }

          for (const asyncMethod of asyncMethods) {
            const regex = new RegExp(`\\b${asyncMethod}\\s*\\(`, 'g');
            let match;
            while ((match = regex.exec(line)) !== null) {
              const before = line.substring(0, match.index);
              if (/\bawait\b/.test(before)) {
                continue;
              }
              if (line.trim().startsWith('return')) {
                continue;
              }
              if (line.includes('setInterval') || line.includes('setTimeout')) {
                continue;
              }
              if (line.includes('=>') && /\basync\b/.test(line.substring(0, line.indexOf('=>'))) && match.index > line.indexOf('=>')) {
                continue;
              }
              const after = line.substring(match.index + asyncMethod.length + 1).trimStart();
              if (after.startsWith('.catch') || after.startsWith('.then')) {
                continue;
              }
              if ((line.includes('Promise.all(') || line.includes('Promise.race(')) && /\bawait\b/.test(line)) {
                continue;
              }
              if (this._isDefinitionAt(mod, asyncMethod, lineNo)) {
                continue;
              }

              const severity = method.async ? 'medium' : 'low';
              raw.push({
                mod,
                caller: method.name,
                line: lineNo,
                asyncMethod,
                severity,
              });
            }
          }
        }
      }
    }

    // Aggregate by module and async method.
    const grouped = new Map();
    for (const r of raw) {
      const key = `${r.mod.filePath}:${r.asyncMethod}:${r.severity}`;
      if (!grouped.has(key)) {
        grouped.set(key, { ...r, callers: [] });
      }
      grouped.get(key).callers.push({ method: r.caller, line: r.line });
    }

    const issues = [];
    for (const g of grouped.values()) {
      const callers = g.callers
        .map((c) => `${c.method} (line ${c.line})`)
        .join(', ');
      issues.push({
        severity: g.severity,
        category: 'async_correctness',
        file: g.mod.relPath,
        line: g.callers[0].line,
        message: `${g.mod.moduleName} calls async '${g.asyncMethod}()' without await from: ${callers}.`,
        details: { module: g.mod.moduleName, asyncMethod: g.asyncMethod, callers: g.callers },
      });
    }

    // new Promise without reject handler.
    const newPromiseRaw = [];
    const promiseRegex = /new\s+Promise\s*\(\s*(?:async\s*)?\(\s*([a-zA-Z_$][\w$]*)\s*(?:,\s*([a-zA-Z_$][\w$]*))?\s*\)\s*=>/g;
    for (const mod of modules) {
      const content = mod.content;
      let m;
      while ((m = promiseRegex.exec(content)) !== null) {
        if (!m[2]) {
          const line = content.slice(0, m.index).split('\n').length;
          newPromiseRaw.push({ mod, line });
        }
      }
    }

    if (newPromiseRaw.length) {
      const details = newPromiseRaw.map((r) => `${r.mod.moduleName} (line ${r.line})`);
      issues.push({
        severity: 'info',
        category: 'async_correctness',
        file: newPromiseRaw[0].mod.relPath,
        line: newPromiseRaw[0].line,
        message: `new Promise executor does not declare a reject handler in: ${details.join(', ')}.`,
        details: newPromiseRaw.map((r) => ({ file: r.relPath, line: r.line, module: r.mod.moduleName })),
      });
    }

    return issues;
  }

  _findRaceConditions(modules) {
    const issues = [];

    // Fire-and-forget async writes from synchronous methods.
    for (const mod of modules) {
      const racers = [];
      for (const method of mod.methods) {
        if (['persist', 'persistAll'].includes(method.name)) {
          continue;
        }
        for (let i = 0; i < method.bodyLines.length; i++) {
          const line = method.bodyLines[i];
          if (/\bpersist\s*\(/.test(line) && !/\bawait\b/.test(line.substring(0, line.indexOf('persist')))) {
            racers.push(`${method.name} (line ${method.line + i})`);
            break;
          }
        }
      }

      if (racers.length) {
        issues.push({
          severity: 'low',
          category: 'race_condition',
          file: mod.relPath,
          line: mod.methods[0].line,
          message: `${mod.moduleName} fires async persist() without awaiting from ${racers.length} method(s): ${racers.join(', ')}. Concurrent writes may interleave or be lost.`,
          details: { module: mod.moduleName, methods: racers },
        });
      }
    }

    // SelfHealingEngine.heal increments attempts around an await.
    const selfHealing = modules.find((m) => m.moduleName === 'SelfHealingEngine');
    if (selfHealing) {
      const heal = selfHealing.methods.find((m) => m.name === 'heal');
      if (heal) {
        const body = heal.bodyLines.join('\n');
        if (/this\.attempts\.get\s*\([^)]*\)[\s\S]{0,800}?this\.attempts\.set\s*\([^)]*\)/.test(body)) {
          issues.push({
            severity: 'medium',
            category: 'race_condition',
            file: selfHealing.relPath,
            line: heal.line,
            message: 'SelfHealingEngine.heal reads this.attempts and writes this.attempts around an await; concurrent heals for the same key can lose increments.',
            details: { method: 'heal' },
          });
        }
      }
    }

    // DistributedCompute state mutations.
    const distributed = modules.find((m) => m.moduleName === 'DistributedCompute');
    if (distributed) {
      const schedule = distributed.methods.find((m) => m.name === 'schedule');
      if (schedule && /chosen\.workload\s*\+=/.test(schedule.bodyLines.join('\n'))) {
        issues.push({
          severity: 'low',
          category: 'race_condition',
          file: distributed.relPath,
          line: schedule.line,
          message: 'DistributedCompute.schedule updates chosen.workload and workAssignments without synchronization; concurrent scheduling can miscount workload.',
          details: { method: 'schedule' },
        });
      }

      const redistribute = distributed.methods.find((m) => m.name === 'redistributeWork');
      if (redistribute) {
        const body = redistribute.bodyLines.join('\n');
        if (/this\.workAssignments\.delete\s*\(/.test(body) && /this\.schedule\s*\(/.test(body)) {
          issues.push({
            severity: 'low',
            category: 'race_condition',
            file: distributed.relPath,
            line: redistribute.line,
            message: 'DistributedCompute.redistributeWork mutates workAssignments while scheduling, which can lead to inconsistent state under concurrent access.',
            details: { method: 'redistributeWork' },
          });
        }
      }
    }

    // Runtime core-loop patches.
    const autonomy = modules.find((m) => m.moduleName === 'AutonomyManager');
    if (autonomy) {
      const patched = autonomy.methods.filter((m) => /patchCoreLoop/.test(m.name));
      if (patched.length) {
        const names = patched.map((m) => m.name).join(', ');
        issues.push({
          severity: 'low',
          category: 'race_condition',
          file: autonomy.relPath,
          line: patched[0].line,
          message: `AutonomyManager replaces coreLoop methods at runtime (${names}) without guarding against concurrent loop execution.`,
          details: { methods: names },
        });
      }
    }

    // Async methods invoked from setInterval callbacks without await.
    const timerCallbacks = [];
    for (const mod of modules) {
      const start = mod.methods.find((m) => m.name === 'start' && !m.async);
      if (!start) {
        continue;
      }
      const body = start.bodyLines.join('\n');
      const methods = [];
      if (/setInterval\s*\(\s*\(\)\s*=>\s*this\.heartbeat\.publishAll\s*\(\s*\)/.test(body)) {
        methods.push('heartbeat.publishAll');
      }
      if (/setInterval\s*\(\s*\(\)\s*=>\s*this\.checkAgents\s*\(\s*\)/.test(body)) {
        methods.push('checkAgents');
      }
      if (/setInterval\s*\(\s*\(\)\s*=>\s*this\.runScan\s*\(\s*\)/.test(body)) {
        methods.push('runScan');
      }
      if (methods.length) {
        timerCallbacks.push({ module: mod.moduleName, methods });
      }
    }

    if (timerCallbacks.length) {
      const detail = timerCallbacks.map((m) => `${m.moduleName}: ${m.methods.join(', ')}`).join('; ');
      issues.push({
        severity: 'low',
        category: 'race_condition',
        file: autonomy ? autonomy.relPath : timerCallbacks[0].module,
        line: 1,
        message: `Async methods are invoked from setInterval callbacks without awaiting, risking overlapping executions: ${detail}.`,
        details: timerCallbacks,
      });
    }

    return issues;
  }

  _generateRecommendations(issues, boundaries) {
    const has = (category) => issues.some((i) => i.category === category);
    const recs = [];

    if (has('duplicate_functionality')) {
      recs.push('Consolidate duplicated aggregator/report methods (runAll, runScenario, getReport) into a shared harness base class or mixin.');
    }
    if (has('unused_export')) {
      recs.push('Review public method surface area; remove unused helpers or document them as stable external API entry points.');
    }
    if (has('async_correctness')) {
      recs.push('Await async calls that must complete before subsequent logic, especially persistence and load operations, or use a write queue for background persistence.');
    }
    if (has('race_condition')) {
      recs.push('Serialize state mutations that span awaits; consider atomic updates or a mutex for attempts/escalations and file-system writes.');
    }
    if (!has('circular_dependency')) {
      recs.push('Maintain the current DAG dependency structure; no circular requires are present.');
    }
    if (!has('blocking_operation')) {
      recs.push('Continue using fs.promises and asynchronous I/O in the V3 layer.');
    }
    if (boundaries.v3OnlyUsesBuiltinsAndV3) {
      recs.push('V3 modules depend only on Node.js built-ins and each other; keep the V3 layer decoupled from HYDI core modules.');
    }

    return recs;
  }

  _computeScores(issues, _moduleCount) {
    const configs = {
      architecture: {
        base: 100,
        critical: -20,
        high: -15,
        medium: -10,
        low: -2,
        info: -0.5,
        categories: ['duplicate_functionality', 'unused_export', 'dead_code'],
      },
      dependencies: {
        base: 100,
        critical: -20,
        high: -15,
        medium: -10,
        low: -2,
        info: -0.5,
        categories: ['circular_dependency', 'module_boundary'],
      },
      naming: {
        base: 100,
        critical: -20,
        high: -15,
        medium: -10,
        low: -5,
        info: -1,
        categories: ['naming_convention'],
      },
      async: {
        base: 100,
        critical: -20,
        high: -15,
        medium: -6,
        low: -3,
        info: -0.5,
        categories: ['async_correctness'],
      },
      race: {
        base: 100,
        critical: -20,
        high: -15,
        medium: -6,
        low: -2,
        info: -0.5,
        categories: ['race_condition'],
      },
      blocking: {
        base: 100,
        critical: -20,
        high: -15,
        medium: -10,
        low: -5,
        info: -1,
        categories: ['blocking_operation'],
      },
    };

    const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
    const scores = {};
    let total = 0;

    for (const [key, config] of Object.entries(configs)) {
      let score = config.base;
      for (const issue of issues) {
        if (config.categories.includes(issue.category)) {
          score += config[issue.severity] || 0;
        }
      }
      scores[key] = clamp(score);
      total += scores[key];
    }

    scores.overall = clamp(total / Object.keys(configs).length);
    return scores;
  }

  _countBySeverity(issues) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const issue of issues) {
      counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    }
    return counts;
  }
}

module.exports = ArchitectureAudit;
