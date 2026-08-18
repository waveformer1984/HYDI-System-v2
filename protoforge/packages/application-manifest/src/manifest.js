const fs = require('fs');
const path = require('path');

const LIFECYCLE_EVENT_TYPES = [
  'application.created',
  'application.registered',
  'application.started',
  'application.health.changed',
  'application.deprecated'
];

const DEFAULT_MANIFEST = {
  name: '',
  version: '0.0.0',
  capabilities: [],
  eventsProduced: [],
  eventsConsumed: [],
  providers: [],
  dependencies: { services: [], packages: [] },
  healthRequirements: [],
  deprecated: false
};

function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

function isStringArray(v) {
  return Array.isArray(v) && v.every(item => typeof item === 'string');
}

function validateManifest(input) {
  const errors = [];
  const manifest = input || {};

  if (!isNonEmptyString(manifest.name)) {
    errors.push('name is required and must be a non-empty string');
  }
  if (!isNonEmptyString(manifest.version)) {
    errors.push('version is required and must be a non-empty string');
  }
  if (!isStringArray(manifest.capabilities)) {
    errors.push('capabilities must be an array of strings');
  }
  if (!isStringArray(manifest.eventsProduced)) {
    errors.push('eventsProduced must be an array of strings');
  }
  if (!isStringArray(manifest.eventsConsumed)) {
    errors.push('eventsConsumed must be an array of strings');
  }
  if (!isStringArray(manifest.providers)) {
    errors.push('providers must be an array of strings');
  }
  if (manifest.healthRequirements !== undefined && !isStringArray(manifest.healthRequirements)) {
    errors.push('healthRequirements must be an array of strings');
  }
  if (manifest.deprecated !== undefined && typeof manifest.deprecated !== 'boolean') {
    errors.push('deprecated must be a boolean');
  }
  if (manifest.dependencies !== undefined) {
    const deps = manifest.dependencies;
    if (typeof deps !== 'object' || deps === null || Array.isArray(deps)) {
      errors.push('dependencies must be an object');
    } else {
      if (deps.services !== undefined && !isStringArray(deps.services)) {
        errors.push('dependencies.services must be an array of strings');
      }
      if (deps.packages !== undefined && !isStringArray(deps.packages)) {
        errors.push('dependencies.packages must be an array of strings');
      }
    }
  }

  const allEvents = new Set([
    ...(manifest.eventsProduced || []),
    ...(manifest.eventsConsumed || [])
  ]);
  for (const ev of allEvents) {
    if (!ev.includes('.')) {
      errors.push(`event type "${ev}" must be dot-namespaced`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function createManifest(overrides = {}) {
  return {
    ...DEFAULT_MANIFEST,
    ...overrides,
    dependencies: { ...DEFAULT_MANIFEST.dependencies, ...(overrides.dependencies || {}) }
  };
}

function loadManifest(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    const filled = createManifest(parsed);
    const validation = validateManifest(filled);
    if (!validation.ok) {
      return { ok: false, error: validation.errors.join('; ') };
    }
    return { ok: true, manifest: filled, path: filePath };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

function loadAll(searchPaths) {
  const paths = searchPaths || [
    path.join(process.cwd(), 'switchboard', 'manifest.json'),
    path.join(process.cwd(), 'protoforge-applications', 'rezonate', 'manifest.json')
  ];

  const results = [];
  for (const p of paths) {
    if (fs.existsSync(p)) {
      const loaded = loadManifest(p);
      if (loaded.ok) results.push(loaded.manifest);
    }
  }
  return results;
}

function discover(searchDirs) {
  const dirs = searchDirs || ['protoforge-applications', 'switchboard'];
  const manifests = [];
  for (const dir of dirs) {
    const fullDir = path.isAbsolute(dir) ? dir : path.join(process.cwd(), dir);
    if (!fs.existsSync(fullDir)) continue;

    const rootManifest = path.join(fullDir, 'manifest.json');
    if (fs.existsSync(rootManifest)) {
      const loaded = loadManifest(rootManifest);
      if (loaded.ok) manifests.push(loaded.manifest);
    }

    const entries = fs.readdirSync(fullDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(fullDir, entry.name, 'manifest.json');
      if (fs.existsSync(manifestPath)) {
        const loaded = loadManifest(manifestPath);
        if (loaded.ok) manifests.push(loaded.manifest);
      }
    }
  }
  return manifests;
}

module.exports = {
  LIFECYCLE_EVENT_TYPES,
  DEFAULT_MANIFEST,
  validateManifest,
  createManifest,
  loadManifest,
  loadAll,
  discover
};
