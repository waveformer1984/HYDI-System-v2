#!/usr/bin/env node
'use strict';

const fs = require('fs').promises;
const path = require('path');
const ObservabilityDashboard = require('../src/hydi-v3/ObservabilityDashboard');
const MissionPlanner = require('../src/hydi-v3/MissionPlanner');
const DecisionIntelligence = require('../src/hydi-v3/DecisionIntelligence');
const ReflectionEngine = require('../src/hydi-v3/ReflectionEngine');
const HeartbeatSystem = require('../src/hydi-v3/HeartbeatSystem');
const WatchdogSupervisor = require('../src/hydi-v3/WatchdogSupervisor');
const SelfHealingEngine = require('../src/hydi-v3/SelfHealingEngine');

const DATA_DIR = path.join(__dirname, '..', 'data', 'observability');
const OUTPUT_PATH = path.join(__dirname, '..', 'dashboard.json');

function createCoreLoop() {
  return {
    isRunning: false,
    activeLoops: new Map(),
    metrics: { loopsCompleted: 0, loopsFailed: 0, revenueGenerated: 0 },
    getStatus: () => ({
      timestamp: Date.now(),
      cpu: 0.1,
      memory: 0.2,
      queueDepth: 0,
      activeLoopCount: 1,
      retryCount: 0,
    }),
    getMemoryUsage: () => 0.2,
    getGPUUsage: () => 1,
    getNetworkLatency: () => 0,
  };
}

async function main() {
  const dashboard = new ObservabilityDashboard();
  const coreLoop = createCoreLoop();
  const watchdog = new WatchdogSupervisor();
  const missionPlanner = new MissionPlanner({ storagePath: path.join(DATA_DIR, 'missions') });
  const decisionIntelligence = new DecisionIntelligence({ storagePath: path.join(DATA_DIR, 'decisions') });
  const reflectionEngine = new ReflectionEngine({ storagePath: path.join(DATA_DIR, 'reflections') });
  const heartbeat = new HeartbeatSystem();
  const selfHealing = new SelfHealingEngine();

  await missionPlanner.initialize();
  await decisionIntelligence.initialize();
  await reflectionEngine.initialize();

  watchdog.registerAgent('coreLoop', coreLoop, { type: 'core' });
  heartbeat.registerPublisher('coreLoop', coreLoop);

  const sources = {
    coreLoop,
    watchdog,
    missionPlanner,
    decisionIntelligence,
    heartbeat,
    reflectionEngine,
    selfHealing,
  };

  const json = dashboard.exportDashboard('json', { sources });
  console.log(json);

  await fs.writeFile(OUTPUT_PATH, json);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
