const fs = require('fs');
const os = require('os');
const path = require('path');
const SecurityAuditor = require('../../../src/hydi-v3/SecurityAuditor');

describe('SecurityAuditor', () => {
  let auditor;

  beforeEach(() => {
    auditor = new SecurityAuditor({
      scanPaths: [require('path').join(__dirname, '../../../src/hydi-v3')],
    });
  });

  test('audits new modules and passes', async () => {
    const report = await auditor.runAudit();
    expect(report.passed).toBe(true);
    expect(report.findings).toEqual([]);
  });

  test('validates safe input', () => {
    const result = auditor.validateInput('hello world');
    expect(result.valid).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  test('detects XSS input', () => {
    const result = auditor.validateInput('<script>alert(1)</script>');
    expect(result.valid).toBe(false);
    expect(result.issues).toContain('xss');
  });

  test('encrypts and decrypts data', () => {
    const key = 'super-secret-key-32bytes-long!!';
    const encrypted = auditor.encrypt('sensitive data', key);
    expect(encrypted.iv).toBeTruthy();
    expect(encrypted.authTag).toBeTruthy();
    const decrypted = auditor.decrypt(encrypted, key);
    expect(decrypted).toBe('sensitive data');
  });

  test('validates eval and Function usage', () => {
    const evalResult = auditor.validateInput("eval(userInput)");
    expect(evalResult.issues).toContain('eval_function');

    const newFnResult = auditor.validateInput("new Function(userInput)");
    expect(newFnResult.issues).toContain('eval_function');
  });

  test('validates unsafe filesystem access and command execution', () => {
    const fsResult = auditor.validateInput("fs.readFileSync(userPath)");
    expect(fsResult.issues).toContain('unsafe_fs');

    const execResult = auditor.validateInput("child_process.exec('rm ' + userInput)");
    expect(execResult.issues).toContain('command_injection');
    expect(execResult.issues).toContain('unsafe_fs');

    const spawnResult = auditor.validateInput("spawn('sh', args, { shell: true })");
    expect(spawnResult.issues).toContain('command_injection');
  });

  test('validates SQL injection, path traversal, and CSRF inputs', () => {
    const sqlResult = auditor.validateInput("db.query(`SELECT * FROM t WHERE id = ${userId}`)");
    expect(sqlResult.issues).toContain('sql_injection');

    const pathResult = auditor.validateInput("../../../etc/passwd");
    expect(pathResult.issues).toContain('path_traversal');

    const csrfResult = auditor.validateInput('<form action="/login"><input name="user"></form>');
    expect(csrfResult.issues).toContain('csrf');
  });

  test('auditCodeSecurity detects unsafe runtime patterns', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-audit-'));
    const code = `
      eval(userInput);
      const fs = require('fs');
      fs.readFileSync(userPath);
      child_process.exec('rm ' + userInput);
      db.query(\`SELECT * FROM t WHERE id = \${userId}\`);
      spawn('sh', args, { shell: true });
      const risky = '../../../etc/passwd';
    `;
    const filePath = path.join(tmpDir, 'bad.js');
    fs.writeFileSync(filePath, code);

    const findings = await auditor.auditCodeSecurity([tmpDir]);
    const names = findings.map((f) => f.pattern);
    expect(names).toContain('eval_usage');
    expect(names).toContain('unsafe_fs_read');
    expect(names).toContain('child_process_exec');
    expect(names).toContain('sql_injection');
    expect(names).toContain('command_injection_spawn');
    expect(names).toContain('path_traversal');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('auditRateLimit reports express-rate-limit usage', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rate-limit-'));
    const noLimitFile = path.join(tmpDir, 'server.js');
    fs.writeFileSync(noLimitFile, "const app = require('express')(); app.get('/', (req, res) => res.send('ok'));");

    const limitFile = path.join(tmpDir, 'limited.js');
    fs.writeFileSync(limitFile, "const rateLimit = require('express-rate-limit'); app.use(rateLimit());");

    const report = await auditor.auditRateLimit([tmpDir]);
    expect(report.used).toBe(true);
    expect(report.usageFiles).toContain(limitFile);
    expect(report.serverFilesWithoutRateLimit).toContain(noLimitFile);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('auditDependencies reports known vulnerable dependency versions', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({
      name: 'vulnerable-test',
      dependencies: { qs: '^5.2.1' },
    }));
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), JSON.stringify({
      lockfileVersion: 3,
      packages: {
        'node_modules/qs': { version: '5.2.1' },
        'node_modules/tar': { version: '4.4.1' },
      },
    }));

    const report = await auditor.auditDependencies(tmpDir);
    expect(report.scanned).toBe(true);
    const names = report.lockVulnerable.map((v) => v.name);
    expect(names).toContain('qs');
    expect(names).toContain('tar');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('auditDependencies handles missing lockfile gracefully', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deps-missing-'));
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'missing-lock' }));

    const report = await auditor.auditDependencies(tmpDir);
    expect(report.scanned).toBe(true);
    expect(report.advisories.some((a) => a.includes('package-lock.json'))).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
