#!/usr/bin/env node
/**
 * HEIDI Operational Intelligence — Diagnostic Command
 *
 * `node src/heidi-executive/DiagnosticCommand.js`
 *
 * Produces a bounded operational status report:
 *   1. system health
 *   2. dependency graph status
 *   3. recent incidents
 *   4. current anomalies
 *   5. probable causes
 *   6. recommended action
 *   7. permitted autonomous action
 *   8. action actually taken
 *   9. verification result
 *
 * All output is read-only by default. No recovery actions are executed.
 */

const { HealthAggregator } = require('./HealthAggregator');
const { LocalHealthProbes } = require('./LocalHealthProbes');
const { RuntimeObserver } = require('./RuntimeObserver');
const { IncidentStore } = require('./IncidentStore');
const { FailureClassifier } = require('./FailureClassifier');

async function run(options = {}) {
  const out = {
    timestamp: new Date().toISOString(),
    source: 'HEIDI_DIAGNOSTIC',
    overall: 'UNKNOWN',
    sections: [],
  };

  const health = new HealthAggregator();
  const probes = new LocalHealthProbes(options.localHealthProbes);
  for (const [name, fn] of Object.entries(probes.all())) {
    health.register(name, fn);
  }
  const observer = new RuntimeObserver(options.runtimeObserver);
  observer.registerWith(health);

  // 1. System health
  const healthResults = await health.inspectAll();
  out.sections.push({
    label: 'system-health',
    kind: 'OBSERVED',
    data: healthResults,
    summary: health.summary(),
  });

  // 2. Dependency graph status
  const deps = {
    heidi: { status: 'HEALTHY', detail: 'control plane active' },
    wsl: healthResults.wsl || { status: 'UNKNOWN' },
    docker: healthResults['docker-daemon'] || { status: 'UNKNOWN' },
    postgres: healthResults['postgres-tcp'] || { status: 'UNKNOWN' },
    redis: healthResults['redis-tcp'] || { status: 'UNKNOWN' },
    supabase: healthResults['kong'] || { status: 'UNKNOWN' },
    protohub: healthResults['protohub-compose'] || { status: 'UNKNOWN' },
    'memory-engine': healthResults['memory-engine'] || { status: 'UNKNOWN' },
    'hydi-core': healthResults['hydi-core'] || { status: 'UNKNOWN' },
    'heidi-bridge': healthResults['heidi-bridge'] || { status: 'UNKNOWN' },
    'next-app': healthResults['next-app'] || { status: 'UNKNOWN' },
  };
  out.sections.push({
    label: 'dependency-graph',
    kind: 'OBSERVED',
    data: deps,
  });

  // 3. Recent incidents
  const store = new IncidentStore(options.incidentStore);
  out.sections.push({
    label: 'recent-incidents',
    kind: 'OBSERVED',
    data: store.recent(10),
    summary: store.summary(),
  });

  // 4-6. Anomalies, diagnosis, recommendation
  const classifier = new FailureClassifier();
  const anomalies = [];
  const recommendations = [];
  for (const [component, result] of Object.entries(healthResults)) {
    if (result && result.status !== 'HEALTHY' && result.status !== 'NOT_CONFIGURED') {
      const classified = classifier.classify({
        type: result.status,
        error: result.detail,
        component,
      });
      let recommendation = 'Observe and collect more evidence.';
      let permitted = false;
      if (classified.failure_class === 'CONTAINER_FAILURE' || classified.failure_class === 'DOCKER_RUNTIME_FAILURE') {
        recommendation = 'Restart the affected container via an approved recovery action.';
        permitted = true;
      } else if (classified.failure_class === 'DEPENDENCY_FAILURE' || classified.failure_class === 'DATABASE_FAILURE' || classified.failure_class === 'CACHE_FAILURE') {
        recommendation = 'Check the dependent service health and attempt a bounded reconnect.';
        permitted = true;
      } else if (classified.failure_class === 'WSL_RUNTIME_FAILURE') {
        recommendation = 'WSL runtime failure; manual or supervised reconciliation required.';
        permitted = false;
      }
      anomalies.push({
        component,
        state: result.status,
        detail: result.detail,
        classified,
      });
      recommendations.push({
        component,
        recommendation,
        permitted_autonomous: permitted,
      });
    }
  }

  out.sections.push({
    label: 'current-anomalies',
    kind: 'OBSERVED',
    data: anomalies,
  });
  out.sections.push({
    label: 'probable-causes',
    kind: 'INFERRED',
    data: anomalies.map((a) => ({
      component: a.component,
      cause: a.classified.failure_class,
      confidence: a.classified.confidence,
      matched: a.classified.matched,
    })),
  });
  out.sections.push({
    label: 'recommended-actions',
    kind: 'RECOMMENDED',
    data: recommendations,
  });

  // 7-9. Permitted autonomous action, action actually taken, verification
  out.sections.push({
    label: 'permitted-autonomous-actions',
    kind: 'RECOMMENDED',
    data: recommendations.filter((r) => r.permitted_autonomous).map((r) => ({
      component: r.component,
      capability: 'health.recover or wsl_docker.local restart',
      requires_approval: false,
    })),
  });
  out.sections.push({
    label: 'action-executed',
    kind: 'EXECUTED',
    data: 'NONE — diagnostic is read-only',
  });
  out.sections.push({
    label: 'verification',
    kind: 'VERIFIED',
    data: 'N/A — no action executed',
  });

  const critical = Object.entries(healthResults).filter(([k]) => ['wsl', 'docker-daemon', 'kong', 'postgres-tcp', 'redis-tcp', 'protohub-compose', 'memory-engine', 'hydi-core', 'heidi-bridge', 'next-app'].includes(k));
  const degraded = critical.some(([, r]) => r && (r.status === 'DEGRADED' || r.status === 'UNAVAILABLE'));
  const unknown = critical.some(([, r]) => !r || r.status === 'UNKNOWN');
  if (degraded) out.overall = 'DEGRADED';
  else if (unknown) out.overall = 'UNKNOWN';
  else out.overall = 'HEALTHY';

  return out;
}

async function main() {
  const report = await run();
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((e) => { console.error('heidi diagnose failed:', e); process.exit(1); });
}

module.exports = { run, DiagnosticCommand: { run } };
