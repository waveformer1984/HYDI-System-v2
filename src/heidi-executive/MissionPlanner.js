/**
 * HEIDI Operational Control Plane — Mission Planner
 * Turn high-level requests into bounded task graphs.
 */

class MissionPlanner {
  constructor(registry) {
    this.registry = registry;
  }

  plan(goal, context = {}) {
    const missionId = `mission-${Date.now()}`;
    switch (goal) {
      case 'make_operational':
        return this.makeOperationalPlan(missionId, context);
      case 'prepare_for_production':
        return this.prepareForProductionPlan(missionId, context);
      default:
        throw new Error(`Unknown mission goal: ${goal}`);
    }
  }

  makeOperationalPlan(id, _context) {
    return {
      id,
      goal: 'make_operational',
      tasks: [
        { id: `${id}-t1`, capabilityId: 'health.read', title: 'Inspect system health' },
        { id: `${id}-t2`, capabilityId: 'health.read', title: 'Inspect Ollama' },
        { id: `${id}-t3`, capabilityId: 'health.read', title: 'Inspect Heidi' },
        { id: `${id}-t4`, capabilityId: 'health.read', title: 'Inspect Ursula' },
        { id: `${id}-t5`, capabilityId: 'health.read', title: 'Inspect local persistence' },
        { id: `${id}-t6`, capabilityId: 'health.read', title: 'Inspect Docker' },
        { id: `${id}-t7`, capabilityId: 'health.read', title: 'Inspect APIs' },
        { id: `${id}-t8`, capabilityId: 'test.run', title: 'Run readiness' },
        { id: `${id}-t9`, capabilityId: 'health.recover', title: 'Repair permitted local failures', parameters: { service: 'safe-local' } },
        { id: `${id}-t10`, capabilityId: 'test.run', title: 'Verify recovery' },
        { id: `${id}-t11`, capabilityId: 'build.run', title: 'Produce evidence report' },
      ],
    };
  }

  prepareForProductionPlan(id, _context) {
    return {
      id,
      goal: 'prepare_for_production',
      tasks: [
        { id: `${id}-t1`, capabilityId: 'health.read', title: 'Inspect' },
        { id: `${id}-t2`, capabilityId: 'health.read', title: 'Identify blockers' },
        { id: `${id}-t3`, capabilityId: 'health.recover', title: 'Remediate safe blockers' },
        { id: `${id}-t4`, capabilityId: 'test.run', title: 'Validate' },
        { id: `${id}-t5`, capabilityId: 'test.run', title: 'Request approvals' },
        { id: `${id}-t6`, capabilityId: 'test.run', title: 'Execute approved actions' },
        { id: `${id}-t7`, capabilityId: 'test.run', title: 'Verify' },
        { id: `${id}-t8`, capabilityId: 'build.run', title: 'Report' },
      ],
    };
  }
}

module.exports = { MissionPlanner };
