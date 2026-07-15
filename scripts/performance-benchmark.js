#!/usr/bin/env node
'use strict';

const path = require('path');
const PerformanceBenchmark = require('../src/hydi-v3/PerformanceBenchmark');
const MissionPlanner = require('../src/hydi-v3/MissionPlanner');
const DecisionIntelligence = require('../src/hydi-v3/DecisionIntelligence');
const ReflectionEngine = require('../src/hydi-v3/ReflectionEngine');
const HeartbeatSystem = require('../src/hydi-v3/HeartbeatSystem');

const DATA_DIR = path.join(__dirname, '..', 'data', 'perf-benchmark');

async function main() {
  const components = {
    missionPlanner: new MissionPlanner({ storagePath: path.join(DATA_DIR, 'missions') }),
    decisionIntelligence: new DecisionIntelligence({ storagePath: path.join(DATA_DIR, 'decisions') }),
    reflectionEngine: new ReflectionEngine({ storagePath: path.join(DATA_DIR, 'reflections') }),
    heartbeat: new HeartbeatSystem(),
  };

  await components.missionPlanner.initialize();
  await components.decisionIntelligence.initialize();
  await components.reflectionEngine.initialize();

  const benchmark = new PerformanceBenchmark({ iterations: 50 });
  const report = await benchmark.runAll(components);

  console.log(JSON.stringify(report, null, 2));

  process.exit(report.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
