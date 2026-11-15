'use strict';

const { PERMISSIONS } = require('./types');

/**
 * Assigns work to registered agents via ExecutionGateway — no parallel executor.
 */
class DevWorkforceCoordinator {
  /**
   * @param {import('../execution-fabric/gateway').ExecutionGateway} gateway
   * @param {import('./registry').DevWorkforceRegistry} registry
   */
  constructor(gateway, registry) {
    this.gateway = gateway;
    this.registry = registry;
  }

  async assign({ agent_id, capabilityId, args = {}, confirm = false, role = 'operator', objective = null, idempotencyKey = null }) {
    const agent = this.registry.get(agent_id);
    if (!agent) return { ok: false, error: 'agent_not_registered', classification: 'BLOCKED' };
    if (!this.registry.hasPermission(agent_id, PERMISSIONS.FABRIC_SUBMIT) && !this.registry.hasPermission(agent_id, PERMISSIONS.FABRIC_CONTROL)) {
      return { ok: false, error: 'insufficient_agent_permission', classification: 'BLOCKED' };
    }
    const submitted = await this.gateway.submit({
      capabilityId,
      args,
      confirm,
      role,
      actor: `agent:${agent_id}`,
      objective: objective || `${agent.role}:${capabilityId}`,
      idempotencyKey: idempotencyKey || `workforce-${agent_id}-${capabilityId}`,
      correlationId: agent_id,
    });
    return {
      ...submitted,
      workforce_agent_id: agent_id,
      workforce_role: agent.role,
      classification: submitted.ok ? 'VERIFIED_SIMULATED' : 'BLOCKED',
    };
  }

  status() {
    return {
      ok: true,
      agents: this.registry.list().length,
      execution_authority: 'ExecutionGateway',
    };
  }
}

module.exports = { DevWorkforceCoordinator };