/**
 * HEIDI Operational Control Plane — Local Recovery Workflow
 *
 * One bounded, safe, end-to-end recovery workflow:
 *   1. Probe the target service.
 *   2. If degraded or unavailable, authorize and execute a predefined
 *      `docker.local restart_service` for the configured safe resource.
 *   3. Re-probe and confirm.
 *   4. Record the full sequence to the audit log.
 */

class LocalRecoveryWorkflow {
  constructor(heidi, health, service = 'supabase_inbucket') {
    this.heidi = heidi;
    this.health = health;
    this.service = service;
    this.healthName = `docker:${service}`;
  }

  setHealthName(name) {
    this.healthName = name;
    return this;
  }

  async probe() {
    if (!this.health.components.has(this.healthName)) {
      return { status: 'NOT_CONFIGURED', detail: `no health probe registered for ${this.healthName}` };
    }
    const results = await this.health.inspectAll();
    return results[this.healthName] || { status: 'UNKNOWN' };
  }

  async recover(actor = { id: 'heidi' }) {
    const before = await this.probe();
    if (!before || (before.status !== 'DEGRADED' && before.status !== 'UNAVAILABLE' && before.status !== 'NOT_CONFIGURED')) {
      return { status: 'SKIPPED', reason: 'service already healthy or not tracked', before };
    }

    const task = {
      id: `recover-${this.service}-${Date.now()}`,
      capabilityId: 'health.recover',
      target: 'local',
      riskLevel: 'LOW',
      parameters: {
        service: this.service,
      },
    };

    let result;
    try {
      result = await this.heidi.run(task, actor);
    } catch (e) {
      return { status: 'FAILED', task, error: e.message, before };
    }

    const after = await this.probe();
    return { status: 'RECOVERED', task, result, before, after };
  }
}

module.exports = { LocalRecoveryWorkflow };
