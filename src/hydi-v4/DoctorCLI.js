'use strict';

const RepositoryAuditor = require('./RepositoryAuditor');

/**
 * DoctorCLI 2.0 is the interactive maintenance and diagnostics surface for HYDI.
 *
 * Every command returns structured JSON and an optional human-readable report.
 */
class DoctorCLI {
  constructor(kernel) {
    this.kernel = kernel;
    this.commands = new Map([
      ['doctor', this.cmdDoctor.bind(this)],
      ['benchmark', this.cmdBenchmark.bind(this)],
      ['audit', this.cmdAudit.bind(this)],
      ['optimize', this.cmdOptimize.bind(this)],
      ['repair', this.cmdRepair.bind(this)],
      ['profile', this.cmdProfile.bind(this)],
      ['memory', this.cmdMemory.bind(this)],
      ['intelligence', this.cmdIntelligence.bind(this)],
      ['modules', this.cmdModules.bind(this)],
      ['kernel', this.cmdKernel.bind(this)],
      ['plugins', this.cmdPlugins.bind(this)],
      ['update', this.cmdUpdate.bind(this)],
      ['backup', this.cmdBackup.bind(this)],
      ['restore', this.cmdRestore.bind(this)],
      ['replay', this.cmdReplay.bind(this)],
      ['recover', this.cmdRecover.bind(this)],
      ['services', this.cmdServices.bind(this)],
      ['diagnostics', this.cmdDiagnostics.bind(this)],
      ['validate', this.cmdValidate.bind(this)],
      ['upgrade', this.cmdUpgrade.bind(this)],
      ['rollback', this.cmdRollback.bind(this)],
      ['release', this.cmdRelease.bind(this)],
    ]);
  }

  async run(argv, options = {}) {
    const [cmd, ...args] = argv;
    if (!cmd || cmd === '--help' || cmd === '-h') return this.help();
    const handler = this.commands.get(cmd);
    if (!handler) return { ok: false, error: `unknown command: ${cmd}` };
    const result = await handler(args);
    if (options.human || argv.includes('--human')) {
      result.report = this._toHuman(cmd, result);
    }
    return result;
  }

  help() {
    const list = Array.from(this.commands.keys()).join(', ');
    return { ok: true, message: `HYDI Doctor CLI. Commands: ${list}` };
  }

  _toHuman(cmd, result) {
    const lines = [`=== HYDI Doctor: ${cmd} ===`];
    if (result.ok !== undefined) lines.push(`Status: ${result.ok ? 'OK' : 'FAILED'}`);
    if (result.moduleCount !== undefined) lines.push(`Modules: ${result.moduleCount}`);
    if (result.health) lines.push(`Failed modules: ${result.health.failed || 0}`);
    if (result.modules) lines.push(`Module list: ${result.modules.length} items`);
    if (result.issues) lines.push(`Issues: ${result.issues.length}`);
    if (result.recommendation) lines.push(`Recommendation: ${result.recommendation}`);
    return lines.join('\n');
  }

  async cmdDoctor() {
    const health = await this.kernel.healthMonitor.check();
    const modules = this.kernel.moduleRegistry.list();
    const graph = this.kernel.capabilityGraph.detectMissingCapabilities();
    return {
      ok: health.failed === 0 && graph.length === 0,
      health,
      moduleCount: modules.length,
      missingCapabilities: graph,
    };
  }

  async cmdBenchmark() {
    const start = Date.now();
    await this.kernel.healthMonitor.check();
    const elapsed = Date.now() - start;
    return { ok: true, elapsedMs: elapsed };
  }

  async cmdAudit() {
    const modules = this.kernel.moduleRegistry.list();
    const issues = [];
    for (const m of modules) {
      if (!m.capabilities || !m.dependencies) {
        issues.push({ module: m.id, issue: 'missing manifest fields' });
      }
    }
    return { ok: issues.length === 0, issues };
  }

  async cmdOptimize() {
    const modules = this.kernel.moduleRegistry.list();
    const disabled = modules.filter((m) => !m.enabled).map((m) => m.id);
    return { ok: true, recommendation: `Consider removing disabled modules: ${disabled.join(', ') || 'none'}` };
  }

  async cmdRepair() {
    const missing = this.kernel.capabilityGraph.detectMissingCapabilities();
    if (missing.length === 0) return { ok: true, repaired: [] };
    return { ok: false, repaired: [], missing };
  }

  async cmdProfile() {
    const mem = process.memoryUsage();
    return { ok: true, memory: mem, uptime: process.uptime() };
  }

  async cmdMemory() {
    const mem = process.memoryUsage();
    const storeSize = this.kernel.memoryBus.adapter?.store?.size ?? 0;
    return { ok: true, process: mem, memoryBusEntries: storeSize };
  }

  async cmdIntelligence() {
    const adapters = await this.kernel.intelligenceBus.getStatus().catch(() => ({}));
    return { ok: true, adapters };
  }

  async cmdModules() {
    return { ok: true, modules: this.kernel.moduleRegistry.list() };
  }

  async cmdKernel() {
    return { ok: true, status: this.kernel.getStatus() };
  }

  async cmdPlugins() {
    const plugins = this.kernel.moduleRegistry.list().filter((m) => m.id !== 'kernel');
    return { ok: true, plugins };
  }

  async cmdUpdate() {
    return { ok: true, message: 'update check not implemented in this phase' };
  }

  async cmdBackup(args) {
    const dest = args[0] || `${this.kernel.config.dataPath}/backup-${Date.now()}.json`;
    const result = await this.kernel.memoryBus.backup(dest);
    await this.kernel.eventLedger.flush();
    return { ok: true, destination: dest, result };
  }

  async cmdRestore(args) {
    const source = args[0];
    if (!source) return { ok: false, error: 'source required' };
    const result = await this.kernel.memoryBus.restore(source);
    return { ok: true, source, result };
  }

  async cmdReplay() {
    const results = await this.kernel.eventLedger.replay((event) => event);
    return { ok: true, replayed: results.length, results };
  }

  async cmdRecover(args) {
    const moduleId = args[0];
    if (moduleId) {
      await this.kernel.stopModule(moduleId);
      await this.kernel.startModule(moduleId);
      return { ok: true, recovered: moduleId };
    }
    const modules = this.kernel.moduleRegistry.list().filter((m) => !m.running);
    for (const m of modules) {
      await this.kernel.stopModule(m.id).catch(() => {});
      await this.kernel.startModule(m.id).catch(() => {});
    }
    return { ok: true, recovered: modules.map((m) => m.id) };
  }

  async cmdServices() {
    const auditor = new RepositoryAuditor(this.kernel, { rootDir: process.cwd() });
    const scan = await auditor.scan();
    const services = scan.modules.filter((m) => m.category === 'service' || m.category === 'agent');
    return { ok: true, services };
  }

  async cmdDiagnostics() {
    const doctor = await this.cmdDoctor();
    const validate = await this.cmdValidate();
    const profile = await this.cmdProfile();
    return { ok: doctor.ok && validate.ok, doctor, validate, profile };
  }

  async cmdValidate() {
    const graphOk = this.kernel.capabilityGraph.detectMissingCapabilities().length === 0;
    const ledgerOk = this.kernel.eventLedger.verify().valid;
    return { ok: graphOk && ledgerOk, graphOk, ledgerOk };
  }

  async cmdUpgrade(args) {
    const moduleId = args[0];
    if (!moduleId) return { ok: false, error: 'moduleId required' };
    return { ok: false, error: 'Upgrade requires a module payload; use hot reload via the kernel.' };
  }

  async cmdRollback(args) {
    const moduleId = args[0];
    if (!moduleId) return { ok: false, error: 'moduleId required' };
    return this.kernel.moduleRegistry.rollback(moduleId);
  }

  async cmdRelease() {
    const generator = new (require('./ManifestGenerator'))(this.kernel);
    const manifest = await generator.generate();
    return { ok: true, manifestPath: 'manifests/system-manifest.json', modules: manifest.modules.modules.length };
  }
}

module.exports = DoctorCLI;
