const path = require('path');
const fs = require('fs');

const DEFAULT_HYDI_PATH = path.resolve(__dirname);
const HYDI_ROOT = process.env.HYDI_SYSTEM_PATH || DEFAULT_HYDI_PATH;

function hydiModule(mod) {
  const p = path.join(HYDI_ROOT, 'modules', mod);
  if (fs.existsSync(p + '.js')) return require(p);
  return null;
}

const DeploymentManager = hydiModule('deployment-manager');
const ServiceRegistry = hydiModule('service-registry');
const StateManager = hydiModule('state-manager');
const HealthManager = hydiModule('health-manager');
const RecoveryEngine = hydiModule('recovery-engine');

if (!DeploymentManager) {
  console.error('DeploymentManager module not found');
  process.exit(1);
}

const DM = DeploymentManager.DeploymentManager || DeploymentManager;
const SR = ServiceRegistry ? (ServiceRegistry.ServiceRegistry || ServiceRegistry) : null;
const SM = StateManager ? (StateManager.StateManager || StateManager) : null;
const HM = HealthManager ? (HealthManager.HealthManager || HealthManager) : null;
const RE = RecoveryEngine ? (RecoveryEngine.RecoveryEngine || RecoveryEngine) : null;

const dm = new DM({ autoRollback: true });

if (SR) {
  const sr = new SR();
  sr.register('ursula', { name: 'Ursula', status: 'healthy', dependencies: [] });
  sr.register('operator', { name: 'Operator', status: 'healthy', dependencies: [] });
  dm.setRegistry(sr);
}
if (HM) dm.setHealthManager(new HM());
if (RE) dm.setRecoveryEngine(new RE());
if (SM) {
  const sm = new SM({ dbPath: path.join(HYDI_ROOT, 'data', 'dm-test.db') });
  sm.initialize().catch(() => {});
  dm.setStateManager(sm);
}

process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', err.message);
  console.error(err.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('UNHANDLED REJECTION at:', promise, 'reason:', reason);
});

(async () => {
  console.log('Testing deploy with local Ursula (http://localhost:3005)...');
  process.env.URSULA_URL = 'http://localhost:3005';
  try {
    const result = await dm.deploy({ version: '2.0.1-test', description: 'Module test', changes: [] });
    console.log('DEPLOY RESULT:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('DEPLOY ERROR:', e.message);
    console.error(e.stack);
  }
  console.log('Done.');
  process.exit(0);
})();
