/**
 * Ownership reconciliation tests.
 *
 * Proven live 2026-09-27: heidi-web-standalone (PM2) owns port 3000;
 * boot.config's heidi-web entry was unspawneable and, before the PM2
 * name map, recovery fell through to a port-kill that taskkilled PM2's
 * child -- the restart churn. The reconciled model:
 *
 *   serviceId:    heidi-web        (canonical, watchdog/recovery target)
 *   runtimeOwner: heidi-web-standalone  (PM2 app)
 *   supervisor:   pm2
 *   port:         3000
 */
const fs = require('fs');
const path = require('path');
const {
  moduleSupervisor,
  isExternallySupervised,
  supervisedAs,
} = require('../../scripts/module-ownership');
const { pm2NameFor } = require('../../lib/operational/DependencyAwareRestartExecutor');

const bootConfig = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../../boot.config.json'), 'utf8')
);
const heidiWeb = bootConfig.modules.find((m) => m.id === 'heidi-web');

describe('boot.config ownership declaration', () => {
  test('heidi-web is declared supervisor:pm2 with the real PM2 app name', () => {
    expect(heidiWeb).toBeDefined();
    expect(heidiWeb.supervisor).toBe('pm2');
    expect(heidiWeb.supervisedAs).toBe('heidi-web-standalone');
  });

  test('the declared supervisor resolves to the same name recovery uses', () => {
    expect(supervisedAs(heidiWeb)).toBe(pm2NameFor('heidi-web'));
  });

  test('the declared module is externally supervised — boot-agent cannot spawn it', () => {
    expect(isExternallySupervised(heidiWeb)).toBe(true);
    expect(moduleSupervisor(heidiWeb)).toBe('pm2');
  });

  test('other modules remain boot-agent supervised (default)', () => {
    const core = bootConfig.modules.find((m) => m.id === 'protoforge-core');
    expect(isExternallySupervised(core)).toBe(false);
    expect(moduleSupervisor(core)).toBe('boot-agent');
    expect(supervisedAs(core)).toBeNull();
  });
});

describe('supervision boundary semantics', () => {
  test('supervisedAs returns null for non-pm2 modules', () => {
    expect(supervisedAs({ id: 'x' })).toBeNull();
    expect(supervisedAs({ id: 'x', supervisor: 'boot-agent' })).toBeNull();
  });

  test('supervisedAs falls back to module id when no alias given', () => {
    expect(supervisedAs({ id: 'svc', supervisor: 'pm2' })).toBe('svc');
  });

  test('pm2NameFor only remaps declared PM2 owners', () => {
    expect(pm2NameFor('heidi-web')).toBe('heidi-web-standalone');
    // heidi-mobile-chat is boot-managed -- no remap, no port-kill ambiguity
    expect(pm2NameFor('heidi-mobile-chat')).toBe('heidi-mobile-chat');
  });
});
