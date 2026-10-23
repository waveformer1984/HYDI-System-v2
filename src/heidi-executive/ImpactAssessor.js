/**
 * HEIDI Operational Decision Engine — Impact Assessment
 */

const IMPACT_LEVELS = Object.freeze(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const CRITICAL_COMPONENTS = new Set([
  'postgres-compose', 'postgres-tcp', 'supabase-db-container', 'supabase-kong-container', 'docker-daemon',
  'memory-engine', 'hydi-core',
]);

const USER_FACING = new Set(['next-app', 'heidi-mobile', 'kong']);

const DATA_INTEGRITY = new Set([
  'postgres-compose', 'postgres-tcp', 'supabase-db-container', 'database.local',
]);

class ImpactAssessor {
  constructor(options = {}) {
    this.dependencyGraph = options.dependencyGraph || {};
    this.critical = new Set([...CRITICAL_COMPONENTS, ...(options.critical || [])]);
    this.userFacing = new Set([...USER_FACING, ...(options.userFacing || [])]);
    this.dataIntegrity = new Set([...DATA_INTEGRITY, ...(options.dataIntegrity || [])]);
  }

  dependents(name) {
    const deps = [];
    for (const [child, parents] of Object.entries(this.dependencyGraph)) {
      if (parents.includes(name) || parents.includes('*')) deps.push(child);
    }
    return deps;
  }

  assess(component, state, context = {}) {
    const dependents = this.dependents(component);
    const isCritical = this.critical.has(component);
    const isUserFacing = this.userFacing.has(component);
    const isData = this.dataIntegrity.has(component);
    const isDown = state && (state.status === 'UNAVAILABLE' || state.status === 'DEGRADED');

    let impact = 'NONE';
    let factors = [];

    if (!isDown && state.status !== 'INCIDENT') {
      return { impact: 'NONE', factors: ['component is not degraded'] };
    }

    if (isCritical) {
      impact = 'HIGH';
      factors.push('critical component');
    }

    if (dependents.length > 0) {
      impact = bump(impact);
      factors.push(`${dependents.length} dependent(s) affected`);
    }

    if (isData && state.status === 'UNAVAILABLE') {
      impact = bump(impact);
      factors.push('data integrity risk');
    }

    if (isUserFacing) {
      impact = bump(impact);
      factors.push('user-facing impact');
    }

    if (context.durationMinutes && context.durationMinutes > 30) {
      impact = bump(impact);
      factors.push('prolonged duration');
    }

    return { impact, factors, dependents };
  }
}

function bump(level) {
  const i = IMPACT_LEVELS.indexOf(level);
  return i < 0 || i >= IMPACT_LEVELS.length - 1 ? level : IMPACT_LEVELS[i + 1];
}

module.exports = { ImpactAssessor, IMPACT_LEVELS };
