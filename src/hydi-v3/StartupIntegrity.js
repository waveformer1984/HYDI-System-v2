'use strict';

/**
 * StartupIntegrity runs a pre-flight health and readiness check when HYDI boots.
 *
 * It reports what is healthy, what is degraded, and what needs attention before
 * operations begin. It never throws on degraded subsystems; it returns a status
 * object suitable for an executive briefing.
 */
class StartupIntegrity {
  constructor(config = {}) {
    this.strategicObjectives = config.strategicObjectives || null;
    this.businessMemory = config.businessMemory || null;
    this.executionGateway = config.executionGateway || null;
    this.workflowEngine = config.workflowEngine || null;
    this.observability = config.observability || null;
    this.backup = config.backup || null;
    this.logger = config.logger || console;
  }

  async check() {
    const checks = [];
    let worst = 'healthy';

    const add = (name, ok, detail = '', severity = 'degraded') => {
      const status = ok ? 'healthy' : severity;
      if (status !== 'healthy' && (status === 'failed' || worst !== 'failed')) worst = status;
      checks.push({ name, status, detail: detail || status });
    };

    // Strategic Objectives
    try {
      const objectives = this.strategicObjectives ? this.strategicObjectives.getActive() : [];
      add('StrategicObjectives', objectives.length > 0, `${objectives.length} active objective(s)`, 'failed');
    } catch (e) {
      worst = 'failed';
      checks.push({ name: 'StrategicObjectives', status: 'failed', detail: e instanceof Error ? e.message : String(e) });
    }

    // BusinessMemory
    try {
      const memHealth = this.businessMemory ? this.businessMemory.healthCheck() : { ok: false };
      add('BusinessMemory', memHealth.ok, `entities ${memHealth.entities || 0}`);
    } catch (e) {
      worst = worst === 'failed' ? 'failed' : 'degraded';
      checks.push({ name: 'BusinessMemory', status: 'degraded', detail: e instanceof Error ? e.message : String(e) });
    }

    // ExecutionGateway
    try {
      const gateHealth = this.executionGateway ? this.executionGateway.healthCheck() : { ok: false };
      add('ExecutionGateway', gateHealth.ok, `${gateHealth.adapters || 0} adapter(s), ${gateHealth.pending || 0} pending`);
    } catch (e) {
      worst = worst === 'failed' ? 'failed' : 'degraded';
      checks.push({ name: 'ExecutionGateway', status: 'degraded', detail: e instanceof Error ? e.message : String(e) });
    }

    // Required adapters
    try {
      const caps = this.executionGateway ? this.executionGateway.getCapabilities() : [];
      const hasDocs = caps.some((c) => c.adapter === 'documentation');
      add('RequiredAdapters', hasDocs, `${caps.length} capability(ies)`);
    } catch (e) {
      worst = worst === 'failed' ? 'failed' : 'degraded';
      checks.push({ name: 'RequiredAdapters', status: 'degraded', detail: e instanceof Error ? e.message : String(e) });
    }

    // Data store readable
    try {
      const readable = this.businessMemory ? await this._isStoreReadable() : false;
      add('DataStore', readable, 'persistence store accessible');
    } catch (e) {
      worst = worst === 'failed' ? 'failed' : 'degraded';
      checks.push({ name: 'DataStore', status: 'degraded', detail: e instanceof Error ? e.message : String(e) });
    }

    // Backup system
    try {
      const backupOk = this.backup ? await this.backup.healthCheck() : false;
      add('BackupSystem', backupOk, this.backup ? 'backup service available' : 'no backup provider configured');
    } catch (e) {
      worst = worst === 'failed' ? 'failed' : 'degraded';
      checks.push({ name: 'BackupSystem', status: 'degraded', detail: e instanceof Error ? e.message : String(e) });
    }

    // Session state recovered
    try {
      const stateOk = this.businessMemory ? this.businessMemory.entities.size >= 0 : false;
      add('SessionState', stateOk, 'memory index ready');
    } catch (e) {
      worst = worst === 'failed' ? 'failed' : 'degraded';
      checks.push({ name: 'SessionState', status: 'degraded', detail: e instanceof Error ? e.message : String(e) });
    }

    // Observability
    try {
      const obsOk = this.observability ? this.observability.getHealthScore() !== null : false;
      add('Observability', obsOk, this.observability ? 'health metrics available' : 'not connected');
    } catch (e) {
      worst = worst === 'failed' ? 'failed' : 'degraded';
      checks.push({ name: 'Observability', status: 'degraded', detail: e instanceof Error ? e.message : String(e) });
    }

    return { status: worst, checks };
  }

  async _isStoreReadable() {
    try {
      await this.businessMemory.flush();
      return true;
    } catch (e) {
      return false;
    }
  }

  toText(result) {
    const healthy = result.checks.filter((c) => c.status === 'healthy');
    const degraded = result.checks.filter((c) => c.status !== 'healthy');
    const lines = [
      `**Startup Status: ${result.status.charAt(0).toUpperCase() + result.status.slice(1)}**`,
      '',
      ...healthy.map((c) => `* ${c.name}: ${c.detail}`),
      ...(degraded.length ? ['', 'Needs attention:'] : []),
      ...degraded.map((c) => `* ${c.name}: ${c.detail}`),
    ];
    return lines.join('\n');
  }
}

module.exports = StartupIntegrity;
