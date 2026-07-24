'use strict';

const Kernel = require('./Kernel');
const RepositoryAuditor = require('./RepositoryAuditor');
const ManifestGenerator = require('./ManifestGenerator');
const DoctorCLI = require('./DoctorCLI');
const AutonomousOperator = require('./AutonomousOperator');

/**
 * UnifiedRuntime is the top-level HYDI operating-system orchestrator.
 *
 * It boots the kernel, loads the V3 autonomy layer through the V3 adapter,
 * starts autonomous diagnostics, and exposes a single point of control for
 * boot, shutdown, checkpoint, hot reload, and safe mode.
 */
class UnifiedRuntime {
  constructor(config = {}) {
    this.config = {
      dataPath: config.dataPath,
      enableV3: config.enableV3 !== false,
      enableAutonomousOperator: config.enableAutonomousOperator !== false,
      ...config,
    };

    this.kernel = new Kernel({ ...this.config, autoStartModules: false });
    this.auditor = new RepositoryAuditor(this.kernel, config.auditor);
    this.manifestGenerator = new ManifestGenerator(this.kernel, config.manifestGenerator);
    this.doctor = new DoctorCLI(this.kernel);
    this.autonomousOperator = null;
    this._booted = false;
  }

  async boot() {
    if (this._booted) return;

    await this.kernel.start();

    if (this.config.enableAutonomousOperator) {
      this.autonomousOperator = new AutonomousOperator(this.kernel, { id: 'autonomous-operator' });
      this.kernel.registerModule(this.autonomousOperator);
      await this.kernel.startModule('autonomous-operator');
    }

    if (this.config.enableV3) {
      const V3AutonomyAdapter = require('./adapters/V3AutonomyAdapter');
      const v3 = new V3AutonomyAdapter(this.kernel, { id: 'hydi-v3-autonomy' }, { config: this.config });
      this.kernel.registerModule(v3);
      await this.kernel.startModule('hydi-v3-autonomy');
    }

    this._booted = true;
    this.kernel.emit('runtime_booted');
    return { booted: true };
  }

  async shutdown() {
    if (!this._booted) return;
    await this.kernel.eventLedger.flush();
    await this.kernel.stop();
    this._booted = false;
    return { shutdown: true };
  }

  async hotReload(module) {
    const id = module.id;
    await this.kernel.stopModule(id);
    this.kernel.moduleRegistry.unregister(id);
    this.kernel.registerModule(module);
    await this.kernel.startModule(id);
    return { reloaded: id };
  }

  async safeMode() {
    await this.kernel.moduleRegistry.stopAll();
    await this.kernel.moduleRegistry.disposeAll();
    const modules = this.kernel.moduleRegistry.list();
    return { safeMode: true, activeModules: modules.filter((m) => m.running).length };
  }

  async checkpoint() {
    await this.kernel.eventLedger.flush();
    await this.kernel.telemetry.flush();
    return { checkpointed: true };
  }

  async generateManifests() {
    const audit = await this.auditor.scan();
    const manifest = await this.manifestGenerator.generate();
    return { audit: audit.summary, manifest };
  }

  getStatus() {
    return {
      booted: this._booted,
      kernel: this.kernel.getStatus(),
      modules: this.kernel.moduleRegistry.list(),
    };
  }
}

module.exports = UnifiedRuntime;
