'use strict';

const Kernel = require('./Kernel');
const HModule = require('./HModule');
const EventBus = require('./EventBus');
const CapabilityGraph = require('./CapabilityGraph');
const ModuleRegistry = require('./ModuleRegistry');
const PermissionModel = require('./PermissionModel');
const Telemetry = require('./Telemetry');
const HealthMonitor = require('./HealthMonitor');
const SecretVault = require('./SecretVault');
const MemoryBus = require('./MemoryBus');
const IntelligenceBus = require('./IntelligenceBus');
const EventLedger = require('./EventLedger');
const ManifestGenerator = require('./ManifestGenerator');
const DoctorCLI = require('./DoctorCLI');
const AutonomousOperator = require('./AutonomousOperator');
const ProtoForgeFactory = require('./ProtoForgeFactory');
const OllamaIntelligenceAdapter = require('./adapters/OllamaIntelligenceAdapter');
const V3AutonomyAdapter = require('./adapters/V3AutonomyAdapter');
const UnifiedRuntime = require('./UnifiedRuntime');
const SystemIntelligence = require('./SystemIntelligence');
const AutonomousEngineering = require('./AutonomousEngineering');
const Scorecard = require('./Scorecard');
const Dashboard = require('./Dashboard');
const RepositoryAuditor = require('./RepositoryAuditor');
const EvolutionEngine = require('./EvolutionEngine');

module.exports = {
  Kernel,
  HModule,
  EventBus,
  CapabilityGraph,
  ModuleRegistry,
  PermissionModel,
  Telemetry,
  HealthMonitor,
  SecretVault,
  MemoryBus,
  IntelligenceBus,
  EventLedger,
  ManifestGenerator,
  DoctorCLI,
  AutonomousOperator,
  ProtoForgeFactory,
  OllamaIntelligenceAdapter,
  V3AutonomyAdapter,
  UnifiedRuntime,
  SystemIntelligence,
  AutonomousEngineering,
  Scorecard,
  Dashboard,
  RepositoryAuditor,
  EvolutionEngine,
};
