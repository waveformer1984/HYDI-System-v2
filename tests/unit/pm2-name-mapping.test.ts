/**
 * PM2 name resolution for recovery targets.
 *
 * Observed 2026-09-27: `pm2 restart heidi-web` fails -- PM2 supervises the
 * process as `heidi-web-standalone` (the real owner of port 3000). The
 * RecoveryEngine then fell through to killProcessOnPort(3000) which
 * taskkilled PM2's child; PM2 autorestarted it, and the kill+resurrect
 * pair was the "SIGINT churn" on heidi-web-standalone (50 restarts).
 */
import {
  pm2NameFor,
  PM2_NAME_MAP,
  DependencyAwareRestartExecutor,
} from '../../lib/operational/DependencyAwareRestartExecutor';

describe('pm2NameFor', () => {
  test('heidi-web resolves to the real PM2 app name', () => {
    expect(pm2NameFor('heidi-web')).toBe('heidi-web-standalone');
  });

  test('boot-owned modules resolve to themselves (no remap)', () => {
    expect(pm2NameFor('protoforge-core')).toBe('protoforge-core');
    expect(pm2NameFor('heidi-mobile-chat')).toBe('heidi-mobile-chat');
    expect(pm2NameFor('ollama')).toBe('ollama');
  });

  test('unmapped/unknown targets resolve to themselves', () => {
    expect(pm2NameFor('not-a-service')).toBe('not-a-service');
  });
});

describe('restartability contract unchanged', () => {
  const executor = new DependencyAwareRestartExecutor(process.cwd());

  test('PM2-supervised heidi-web is still restartable', () => {
    expect(executor.isRestartable('heidi-web')).toBe(true);
  });

  test('unknown module is not restartable', () => {
    expect(executor.isRestartable('nonsense')).toBe(false);
  });
});
