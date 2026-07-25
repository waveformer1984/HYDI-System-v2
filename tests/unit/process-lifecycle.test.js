const fs = require('fs');
const os = require('os');
const path = require('path');
const { bus, reset, getListenerCount } = require('../../lib/realtime/eventBus');
const { HealthMonitor } = require('../../lib/health-monitor');
const {
  setupGlobalErrorHandlers,
  uninstallGlobalErrorHandlers,
} = require('../../lib/error-recovery');
const HeidiActionLayer = require('../../src/actions/HeidiActionLayer');

describe('Process lifecycle cleanup', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('eventBus', () => {
    beforeEach(() => {
      reset();
    });

    test('getListenerCount tracks subscribers', () => {
      expect(getListenerCount()).toBe(0);
      bus.on('event', () => {});
      expect(getListenerCount()).toBe(1);
      bus.once('event', () => {});
      expect(getListenerCount()).toBe(2);
    });

    test('reset removes all listeners', () => {
      bus.on('event', () => {});
      bus.on('event', () => {});
      reset();
      expect(getListenerCount()).toBe(0);
    });
  });

  describe('HealthMonitor', () => {
    test('destroy clears all health check intervals', () => {
      jest.useFakeTimers({ legacyFakeTimers: true });
      const monitor = new HealthMonitor();
      monitor.registerComponent('db', async () => true, 1000);
      expect(jest.getTimerCount()).toBe(1);
      monitor.destroy();
      expect(jest.getTimerCount()).toBe(0);
    });

    test('stop clears a single component interval', () => {
      jest.useFakeTimers({ legacyFakeTimers: true });
      const monitor = new HealthMonitor();
      monitor.registerComponent('db', async () => true, 1000);
      monitor.registerComponent('cache', async () => true, 1000);
      expect(jest.getTimerCount()).toBe(2);
      monitor.stop('db');
      expect(jest.getTimerCount()).toBe(1);
      monitor.destroy();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('error-recovery', () => {
    test('setupGlobalErrorHandlers is idempotent and removable', () => {
      const before = {
        unhandledRejection: process.listenerCount('unhandledRejection'),
        uncaughtException: process.listenerCount('uncaughtException'),
        SIGTERM: process.listenerCount('SIGTERM'),
        SIGINT: process.listenerCount('SIGINT'),
      };

      setupGlobalErrorHandlers();
      const after1 = {
        unhandledRejection: process.listenerCount('unhandledRejection'),
        uncaughtException: process.listenerCount('uncaughtException'),
        SIGTERM: process.listenerCount('SIGTERM'),
        SIGINT: process.listenerCount('SIGINT'),
      };

      setupGlobalErrorHandlers(); // second call should be a no-op
      const after2 = {
        unhandledRejection: process.listenerCount('unhandledRejection'),
        uncaughtException: process.listenerCount('uncaughtException'),
        SIGTERM: process.listenerCount('SIGTERM'),
        SIGINT: process.listenerCount('SIGINT'),
      };

      expect(after2).toEqual(after1);

      uninstallGlobalErrorHandlers();

      expect(process.listenerCount('unhandledRejection')).toBe(before.unhandledRejection);
      expect(process.listenerCount('uncaughtException')).toBe(before.uncaughtException);
      expect(process.listenerCount('SIGTERM')).toBe(before.SIGTERM);
      expect(process.listenerCount('SIGINT')).toBe(before.SIGINT);
    });
  });

  describe('HeidiActionLayer child processes', () => {
    let layer;
    let scriptPath;

    beforeAll(() => {
      scriptPath = path.join(os.tmpdir(), 'heidi-test-script.js');
      fs.writeFileSync(
        scriptPath,
        `setTimeout(() => { console.log('done'); process.exit(0); }, 100);\n`
      );
    });

    afterAll(() => {
      try {
        fs.unlinkSync(scriptPath);
      } catch (e) {
        // ignore
      }
    });

    beforeEach(() => {
      layer = new HeidiActionLayer({ enableRevenueActions: false, enableScriptExecution: true });
    });

    afterEach(() => {
      layer.destroy();
    });

    test('executeScript runs a script and cleans up tracking', async () => {
      const result = await layer.executeScript(scriptPath, [], {}, { timeout: 2000 });
      expect(result.success).toBe(true);
      expect(layer._childProcesses.size).toBe(0);
    });

    test('executeScript times out and kills long-running scripts', async () => {
      const slowScript = path.join(os.tmpdir(), 'heidi-slow-script.js');
      fs.writeFileSync(slowScript, `setTimeout(() => {}, 60000);\n`);
      try {
        await expect(layer.executeScript(slowScript, [], {}, { timeout: 100 })).rejects.toThrow(
          /timed out/
        );
      } finally {
        try {
          fs.unlinkSync(slowScript);
        } catch (e) {
          // ignore
        }
      }
      expect(layer._childProcesses.size).toBe(0);
    });

    test('destroy kills a running child and clears process set', async () => {
      const slowScript = path.join(os.tmpdir(), 'heidi-slow-destroy.js');
      fs.writeFileSync(slowScript, `setTimeout(() => {}, 60000);\n`);
      const promise = layer.executeScript(slowScript, [], {}, { timeout: 60000 });
      // give spawn a tick to register
      await new Promise((resolve) => setTimeout(resolve, 50));
      layer.destroy();
      const result = await promise;
      expect(result.success).toBe(false);
      expect(layer._childProcesses.size).toBe(0);
      try {
        fs.unlinkSync(slowScript);
      } catch (e) {
        // ignore
      }
    });
  });
});
