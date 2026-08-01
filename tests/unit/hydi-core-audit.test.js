const fs = require('fs');
const path = require('path');

const hydiCorePath = path.join(__dirname, '..', '..', 'hydi-core.js');

function loadHydiCore() {
  const content = fs.readFileSync(hydiCorePath, 'utf8');
  return content;
}

describe('hydi-core.js configuration audit', () => {
  const content = loadHydiCore();

  test('hydi-core checks supervisor on /status endpoint, not /health', () => {
    // supervisor.js /health returns 503 if any supervised service is down,
    // which is the wrong semantic for "is the supervisor process itself alive."
    // /status is the correct endpoint for supervisor liveness.
    expect(content).toContain('http://localhost:9999/status');
    expect(content).not.toMatch(/http:\/\/localhost:9999\/health(?!\w)/);
  });

  test('hydi-core checks memory-engine on /health endpoint', () => {
    expect(content).toContain('http://localhost:9998/health');
  });

  test('hydi-core has both /health and /status endpoints', () => {
    // hydi-core exposes both endpoints for different consumers
    expect(content).toContain('/health');
    expect(content).toContain('/status');
  });
});
