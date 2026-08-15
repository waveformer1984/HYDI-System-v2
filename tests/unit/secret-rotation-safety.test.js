const { execSync } = require('child_process');
const path = require('path');

function runScript(relativePath, env = {}) {
  const cwd = path.resolve(__dirname, '..', '..');
  const command = `node ${relativePath}`;
  const mergedEnv = { ...process.env, ...env };
  return execSync(command, { cwd, env: mergedEnv, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

const TEST_BREAK_GLASS = 'TEST_SECRET_DO_NOT_USE_123456789_BREAK_GLASS';
const TEST_SERVICE_ROLE = 'TEST_SECRET_DO_NOT_USE_123456789_SERVICE_ROLE';
const TEST_TOKEN = 'TEST_SECRET_DO_NOT_USE_123456789_TOKEN';

describe('secret rotation scripts do not leak values', () => {
  test('rotate-secrets.js does not log the generated break-glass or service role values', () => {
    const output = runScript('rotate-secrets.js', {
      ROTATION_TEST_BREAK_GLASS_TOKEN: TEST_BREAK_GLASS,
      ROTATION_TEST_SERVICE_ROLE_KEY: TEST_SERVICE_ROLE,
    });

    expect(output).not.toContain(TEST_BREAK_GLASS);
    expect(output).not.toContain(TEST_SERVICE_ROLE);
    expect(output).toContain('NEW SECRETS GENERATED (values intentionally not logged)');
    expect(output).toContain('BREAK-GLASS TOKEN ID: KEEPER_BREAK_GLASS_TOKEN');
    expect(output).toContain('SERVICE ROLE ID: SUPABASE_SERVICE_ROLE_KEY');
  });

  test('generate-new-token.js does not log the generated token value', () => {
    const output = runScript('generate-new-token.js', {
      GENERATE_TOKEN_TEST_SECRET: TEST_TOKEN,
    });

    expect(output).not.toContain(TEST_TOKEN);
    expect(output).toContain('NEW SECURE TOKEN GENERATED (value intentionally not logged)');
    expect(output).toContain('TOKEN ID: KEEPER_BREAK_GLASS_TOKEN');
  });
});
