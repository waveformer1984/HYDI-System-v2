/**
 * HEIDI Operational Intelligence unit tests
 */

const path = require('path');
const fs = require('fs');
const { FailureClassifier, TAXONOMY } = require('../../../src/heidi-executive/FailureClassifier');
const { IncidentStore } = require('../../../src/heidi-executive/IncidentStore');
const { WslExecutor } = require('../../../src/heidi-executive/WslExecutor');
const { HeidiExecutive } = require('../../../src/heidi-executive/HeidiExecutive');
const { RuntimeObserver } = require('../../../src/heidi-executive/RuntimeObserver');
const { HealthAggregator } = require('../../../src/heidi-executive/HealthAggregator');

describe('FailureClassifier', () => {
  test('classifies Docker daemon unavailability', () => {
    const c = new FailureClassifier();
    const r = c.classify({ type: 'UNAVAILABLE', detail: 'Cannot connect to the docker daemon' });
    expect(r.failure_class).toBe('DOCKER_RUNTIME_FAILURE');
    expect(r.confidence).toBe('MEDIUM');
  });

  test('classifies postgres connection refused', () => {
    const c = new FailureClassifier();
    const r = c.classify({ error: 'ECONNREFUSED 127.0.0.1:5432' });
    expect(r.failure_class).toBe('NETWORK_FAILURE');
    expect(r.confidence).toBe('MEDIUM');
  });

  test('returns UNKNOWN for unmatched symptom', () => {
    const c = new FailureClassifier();
    const r = c.classify({ error: 'something entirely novel' });
    expect(r.failure_class).toBe('UNKNOWN_FAILURE');
    expect(r.confidence).toBe('LOW');
  });
});

describe('IncidentStore', () => {
  const tmpDir = path.join(__dirname, '.tmp-incidents');

  beforeEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  test('appends and queries incidents', () => {
    const store = new IncidentStore({ dataDir: tmpDir });
    const inc = store.append({
      component: 'postgres',
      failure_class: 'DATABASE_FAILURE',
      final_state: 'RECOVERED',
    });
    expect(inc.incident_id).toMatch(/^inc-/);
    expect(inc.component).toBe('postgres');
    expect(store.query({ component: 'postgres' })).toHaveLength(1);
    expect(store.summary().total).toBe(1);
  });

  test('redacts secrets in evidence', () => {
    const store = new IncidentStore({ dataDir: tmpDir });
    const inc = store.append({
      component: 'api',
      evidence: { token: 'sk-1234567890abcdef' },
    });
    expect(inc.evidence.token).not.toBe('sk-1234567890abcdef');
  });
});

describe('WslExecutor', () => {
  test('allowlist enforces operation and resource', () => {
    const wsl = new WslExecutor();
    expect(() => wsl.validateTask({ capabilityId: 'wsl_docker.local', parameters: { operation: 'restart_container', resource: 'postgres' } })).toThrow('DENIED: resource not allowed');
    expect(() => wsl.validateTask({ capabilityId: 'wsl_docker.local', parameters: { operation: 'delete', resource: 'supabase_db' } })).toThrow('DENIED: operation not allowed');
    const ok = wsl.validateTask({ capabilityId: 'wsl_docker.local', parameters: { operation: 'restart_container', resource: 'supabase_db' } });
    expect(ok.operation).toBe('restart_container');
    expect(ok.resource).toBe('supabase_db');
  });
});

describe('HeidiExecutive WSL registration', () => {
  test('registers wsl_docker.local and wsl_compose.local', () => {
    const heidi = new HeidiExecutive();
    expect(heidi.registry.has('wsl_docker.local')).toBe(true);
    expect(heidi.registry.has('wsl_compose.local')).toBe(true);
    expect(typeof heidi.executor.executors.get('wsl_docker.local')).toBe('function');
  });
});

describe('RuntimeObserver registration', () => {
  test('registers health probes for docker, wsl, and services', () => {
    const health = new HealthAggregator();
    const observer = new RuntimeObserver({ manifestPath: path.join(__dirname, 'nonexistent.json') });
    observer.registerWith(health);
    expect(health.components.has('docker-daemon')).toBe(true);
    expect(health.components.has('wsl')).toBe(true);
    expect(health.components.has('postgres-tcp')).toBe(true);
  });
});
