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
});
