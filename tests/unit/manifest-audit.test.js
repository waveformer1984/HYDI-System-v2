const fs = require('fs');
const path = require('path');

const manifestPath = path.join(__dirname, '..', '..', 'services-manifest.json');

function loadManifest() {
  const raw = fs.readFileSync(manifestPath, 'utf8');
  return JSON.parse(raw);
}

describe('services-manifest configuration audit', () => {
  const manifest = loadManifest();
  const services = manifest.services;

  test('heidi-bridge URSULA_URL must not be self-referential', () => {
    const bridge = services['heidi-bridge'];
    expect(bridge.env.URSULA_URL).not.toBe('http://127.0.0.1:5050');
    expect(bridge.env.URSULA_URL).not.toBe('http://localhost:5050');
    expect(bridge.env.URSULA_URL).not.toMatch(/:5050\/?$/);
    expect(bridge.env.URSULA_URL).toBeTruthy();
  });

  test('heidi-bridge is configured to point at the local Ursula backend (flask-backend)', () => {
    const bridge = services['heidi-bridge'];
    expect(bridge.env.URSULA_URL).toBe('http://localhost:5000');
  });

  test('docker-stack port and health check are aligned with protohub-api', () => {
    const dockerStack = services['docker-stack'];
    expect(dockerStack.port).toBe(4000);
    expect(dockerStack.healthCheck).toBe('http://localhost:4000/health');
    expect(dockerStack.cmd).toContain('postgres redis protohub-api');
  });

  test('docker-stack must not use --no-deps, since protohub-api depends on flask-backend', () => {
    // docker-compose.yml: protohub-api depends_on flask-backend (FLASK_API_URL points at it),
    // and heidi-bridge's URSULA_URL (http://localhost:5000) points at flask-backend directly.
    // --no-deps would suppress compose's auto-start of that dependency and silently break both.
    const dockerStack = services['docker-stack'];
    expect(dockerStack.cmd).not.toContain('--no-deps');
  });

  test('health endpoints and ports are wired consistently', () => {
    expect(services['memory-engine'].healthCheck).toBe('http://localhost:9998/health');
    expect(services['hydi-core'].healthCheck).toBe('http://localhost:9997/health');
    expect(services['heidi-bridge'].healthCheck).toBe('http://localhost:5050/health');
    expect(services['next-app'].healthCheck).toBe('http://localhost:3000/api/health');
    expect(services['heidi-mobile'].healthCheck).toBe('http://localhost:3006/api/health');
    expect(services['heidi-mobile'].port).toBe(3006);
  });

  test('forge-loop has null port and healthCheck and is handled by the supervisor', () => {
    const forge = services['forge-loop'];
    expect(forge.port).toBeNull();
    expect(forge.healthCheck).toBeNull();
    expect(forge.dependencies).toContain('heidi-bridge');
  });

  test('supervisor status endpoint is documented in manifest notes', () => {
    const notes = manifest.notes.join('\n');
    expect(notes).toContain('http://localhost:9999/status');
  });
});
