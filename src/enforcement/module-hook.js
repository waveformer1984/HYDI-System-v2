/**
 * MODULE LOADER HOOK - Runtime Import Enforcement
 * 
 * This hooks into Node.js module loading to enforce registration
 * before imports resolve. This is the turnstile that prevents
 * unregistered modules from entering the building.
 * 
 * Usage: require('./module-hook').install();
 */

const RuntimeEnforcer = require('./RuntimeEnforcer');
const logger = require('../../lib/structured-logger').child({ component: 'ModuleHook' });

let enforcer = null;

/**
 * Install the module hook
 */
function install() {
  if (enforcer) {
    logger.info('Already installed');
    return;
  }

  enforcer = new RuntimeEnforcer({
    manifestPath: require('path').resolve(__dirname, '../../system-manifest.json'),
    enforcementMode: 'strict',
    enableModuleHooking: true,
    validateImports: true,
    enableServiceValidation: true
  });

  // Load manifest
  enforcer.loadManifest().then(() => {
    logger.info('Runtime enforcement active');
  }).catch(error => {
    logger.error('Failed to load manifest', { error });
  });

  logger.info('Installed');
}

/**
 * Get the runtime enforcer instance
 */
function getEnforcer() {
  return enforcer;
}

/**
 * Validate an import before it resolves
 */
function validateImport(request, parent) {
  if (!enforcer) {
    return { allowed: true, reason: 'Module hook not installed' };
  }
  
  return enforcer.validateImport(request, parent);
}

/**
 * Create a service proxy with runtime validation
 */
function createServiceProxy(serviceName) {
  if (!enforcer) {
    throw new Error('Module hook not installed');
  }
  
  return enforcer.createServiceProxy(serviceName);
}

// Auto-install if this module is required
if (require.main === module) {
  logger.info('Auto-installing module hook...');
  install();
}

module.exports = {
  install,
  getEnforcer,
  validateImport,
  createServiceProxy
};
