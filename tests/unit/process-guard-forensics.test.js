/**
 * Process-guard forensic/attribution tests.
 *
 * Historical gap: protoforge-core exited code 1 during flatline windows
 * and the only record was a broken PM2 stderr pipe (ERR_STREAM_DESTROYED).
 * The guard now writes append-only JSONL forensics + a heartbeat file so
 * every exit carries a classification, and a killed process leaves a
 * stalled heartbeat as the negative evidence.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installProcessGuard, SIGNAL_EXIT_CODES } = require('../../src/process-guard');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'pf-guard-'));
}
function readLines(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(JSON.parse);
}

describe('process-guard forensics', () => {
  test('install records guard-installed with model state', () => {
    const dir = tmpDir();
    const g = installProcessGuard({
      forensicDir: dir, heartbeatMs: 0, log: () => { }, exit: () => { },
      stateProvider: () => ({ running: true, failedModels: 2 }),
    });
    const lines = readLines(g._forensicFile);
    expect(lines[0].event).toBe('guard-installed');
    expect(lines[0].modelState.failedModels).toBe(2);
    g.uninstall();
  });

  test('unhandledRejection is captured durably AND process stays alive', () => {
    const dir = tmpDir();
    const exits = [];
    const g = installProcessGuard({
      forensicDir: dir, heartbeatMs: 0, log: () => { }, exit: (c) => exits.push(c),
    });
    g._onUnhandledRejection(new Error('Ollama ECONNREFUSED'));
    expect(exits).toEqual([]);
    const lines = readLines(g._forensicFile);
    const rej = lines.find((l) => l.event === 'unhandledRejection');
    expect(rej).toBeDefined();
    expect(rej.detail).toMatch(/Ollama/);
    g.uninstall();
  });

  test('rejection storm is classified APPLICATION_EXIT', () => {
    const dir = tmpDir();
    const exits = [];
    const g = installProcessGuard({
      forensicDir: dir, heartbeatMs: 0, log: () => { }, exit: (c) => exits.push(c),
      maxRejectionsPerMinute: 2,
    });
    for (let i = 0; i < 3; i++) g._onUnhandledRejection(new Error('boom'));
    expect(exits).toEqual([1]);
    const lines = readLines(g._forensicFile);
    const storm = lines.find((l) => l.event === 'rejection-storm');
    expect(storm.classification).toBe('APPLICATION_EXIT');
    g.uninstall();
  });

  test('uncaughtException is classified APPLICATION_EXIT and fatal', () => {
    const dir = tmpDir();
    const exits = [];
    const g = installProcessGuard({
      forensicDir: dir, heartbeatMs: 0, log: () => { }, exit: (c) => exits.push(c),
    });
    g._onUncaughtException(new Error('corrupt state'));
    expect(exits).toEqual([1]);
    const lines = readLines(g._forensicFile);
    expect(lines.find((l) => l.event === 'uncaughtException').classification).toBe('APPLICATION_EXIT');
    g.uninstall();
  });

  test('SIGINT records EXTERNAL_TERMINATION with signal + model state', () => {
    const dir = tmpDir();
    const exits = [];
    const g = installProcessGuard({
      forensicDir: dir, heartbeatMs: 0, log: () => { }, exit: (c) => exits.push(c),
      stateProvider: () => ({ running: false, failedModels: 4 }),
    });
    process.emit('SIGINT');
    expect(exits).toEqual([SIGNAL_EXIT_CODES.SIGINT]); // 130
    const lines = readLines(g._forensicFile);
    const sig = lines.find((l) => l.event === 'signal-received');
    expect(sig.signal).toBe('SIGINT');
    expect(sig.classification).toBe('EXTERNAL_TERMINATION');
    expect(sig.modelState.failedModels).toBe(4);
    g.uninstall();
  });

  test('SIGTERM records EXTERNAL_TERMINATION (PM2/watchdog path distinguishable)', () => {
    const dir = tmpDir();
    const exits = [];
    const g = installProcessGuard({
      forensicDir: dir, heartbeatMs: 0, log: () => { }, exit: (c) => exits.push(c),
    });
    process.emit('SIGTERM');
    expect(exits).toEqual([SIGNAL_EXIT_CODES.SIGTERM]); // 143
    const sig = readLines(g._forensicFile).find((l) => l.event === 'signal-received');
    expect(sig.signal).toBe('SIGTERM');
    expect(sig.classification).toBe('EXTERNAL_TERMINATION');
    g.uninstall();
  });

  test('heartbeat file carries pid/uptime/rejections and no secrets', () => {
    const dir = tmpDir();
    const g = installProcessGuard({
      forensicDir: dir, heartbeatMs: 0, log: () => { }, exit: () => { },
    });
    // heartbeatMs 0 disables the timer, but the initial write still ran
    expect(fs.existsSync(g._heartbeatFile)).toBe(true);
    const hb = JSON.parse(fs.readFileSync(g._heartbeatFile, 'utf8'));
    expect(hb.pid).toBe(process.pid);
    expect(typeof hb.uptimeSec).toBe('number');
    expect(typeof hb.rssBytes).toBe('number');
    // No env/secrets leaked
    const raw = fs.readFileSync(g._heartbeatFile, 'utf8');
    expect(raw).not.toMatch(/SUPABASE|KEY|SECRET|TOKEN|PASSWORD/i);
    g.uninstall();
  });

  test('forensic records contain no secrets', () => {
    const dir = tmpDir();
    const g = installProcessGuard({
      forensicDir: dir, heartbeatMs: 0, log: () => { }, exit: () => { },
    });
    const raw = fs.readFileSync(g._forensicFile, 'utf8');
    expect(raw).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY|sk_live|sk_test/i);
    g.uninstall();
  });
});
