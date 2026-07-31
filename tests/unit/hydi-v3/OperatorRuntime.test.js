'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const { PassThrough } = require('stream');
const OperatorSession = require('../../../src/hydi-v3/OperatorSession');
const OperatorCLI = require('../../../src/hydi-v3/OperatorCLI');
const OperatorRuntime = require('../../../src/hydi-v3/OperatorRuntime');

const silent = { log: () => {}, error: () => {}, warn: () => {} };

function harness(session, options = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();

  const lines = [];
  const exits = [];

  const runtime = new OperatorRuntime({
    session,
    cli: options.cli || new OperatorCLI(session, { colour: false }),
    input,
    output,
    installSignalHandlers: false,
    write: (line) => lines.push(line),
    onExit: (code) => exits.push(code),
    ...options,
  });

  return { runtime, input, output, lines, exits };
}

/** Feed lines and wait for the serialised queue to settle. */
async function feed(h, ...commands) {
  for (const command of commands) {
    h.input.write(`${command}\n`);
    await h.runtime.queue;
  }
  await h.runtime.queue;
}

describe('OperatorRuntime', () => {
  let session;
  let dataPath;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
    await session.start();
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    session = null;
  });

  test('requires a session and a cli', () => {
    expect(() => new OperatorRuntime({})).toThrow('requires a session');
    expect(() => new OperatorRuntime({ session })).toThrow('requires a cli');
  });

  test('processes commands in order under piped input', async () => {
    const h = harness(session);
    h.runtime.start();
    await feed(h, 'help', 'status', 'nonsense here');

    const transcript = h.lines.join('\n');
    const helpAt = transcript.indexOf('Available commands');
    const statusAt = transcript.indexOf('ProtoForge status');
    expect(helpAt).toBeGreaterThan(-1);
    expect(statusAt).toBeGreaterThan(helpAt);
  });

  test('exit closes the loop and shuts down cleanly with code 0', async () => {
    const h = harness(session);
    h.runtime.start();
    await feed(h, 'exit');
    await h.runtime._shutdownComplete;

    expect(h.lines.join('\n')).toContain('Shutting down cockpit.');
    expect(h.exits).toEqual([0]);
    expect(session._destroyed).toBe(true);
  });

  test('shutdown flushes every store before destroying', async () => {
    const order = [];
    const originalFlush = session.sessionMemory.flush.bind(session.sessionMemory);
    const originalDestroy = session.sessionMemory.destroy.bind(session.sessionMemory);
    session.sessionMemory.flush = async () => { order.push('flush'); return originalFlush(); };
    session.sessionMemory.destroy = async () => { order.push('destroy'); return originalDestroy(); };

    const h = harness(session);
    await h.runtime.shutdown(0);

    expect(order.indexOf('flush')).toBeGreaterThan(-1);
    expect(order.indexOf('flush')).toBeLessThan(order.indexOf('destroy'));
  });

  test('a slow in-flight command is bounded by the shutdown timeout', async () => {
    const stalled = new Promise(() => {});
    const h = harness(session, {
      shutdownTimeoutMs: 30,
      cli: { handle: () => stalled },
    });
    h.runtime.start();
    h.input.write('slow command\n');
    // Let readline emit the line so the command is actually in flight.
    await new Promise((resolve) => setImmediate(resolve));

    const code = await h.runtime.shutdown(0);
    expect(code).toBe(1);
    expect(h.lines.join('\n')).toContain('did not finish within 30ms');
  });

  test('the shutdown timeout fires even with nothing else holding the event loop', async () => {
    // Regression: the timeout timer must not be unref'd. If it is, Node exits
    // silently with status 0 the moment a stalled command is the last thing
    // keeping the loop alive — exactly the case the timeout exists to report.
    // No readline interface is started here, so there are no other handles.
    const h = harness(session, {
      shutdownTimeoutMs: 20,
      cli: { handle: () => new Promise(() => {}) },
    });
    h.runtime.queue = new Promise(() => {});

    const code = await h.runtime.shutdown(0);
    expect(code).toBe(1);
    expect(h.lines.join('\n')).toContain('did not finish within 20ms');
  });

  test('shutdown reports a failing flush without throwing', async () => {
    session.sessionMemory.flush = async () => { throw new Error('disk full'); };
    const h = harness(session);
    const code = await h.runtime.shutdown(0);
    expect(code).toBe(0);
    // flushAll swallows per-component errors and reports them in the result.
    const result = await session.flushAll();
    expect(result.ok).toBe(false);
  });

  test('shutdown is safe to call twice', async () => {
    const h = harness(session);
    await h.runtime.shutdown(0);
    await expect(h.runtime.shutdown(0)).resolves.toBe(0);
  });

  describe('command history', () => {
    test('typed commands are persisted and reloaded across sessions', async () => {
      const h = harness(session);
      h.runtime.start();
      await feed(h, 'help', 'status');
      await h.runtime.shutdown(0);

      const restored = new OperatorSession({ dataPath, logger: silent, taskIntervalMs: 10 });
      await restored.start();
      try {
        const h2 = harness(restored);
        const history = h2.runtime.loadHistory();
        // Newest first, as readline expects.
        expect(history).toContain('help');
        expect(history).toContain('status');
        expect(history.indexOf('status')).toBeLessThan(history.indexOf('help'));
      } finally {
        await restored.destroy();
      }
    });

    test('CLI-local intents the conversation engine never saw are still recorded', async () => {
      const h = harness(session);
      h.runtime.start();
      await feed(h, 'exit');
      await h.runtime._shutdownComplete;

      const commands = session.sessionMemory.getRecentCommands().map((c) => c.text);
      expect(commands).toContain('exit');
    });

    test('blank lines are not recorded', async () => {
      const h = harness(session);
      h.runtime.start();
      await feed(h, '   ', 'help');
      h.runtime.saveHistory();

      const commands = session.sessionMemory.getRecentCommands().map((c) => c.text);
      expect(commands.some((c) => c.trim() === '')).toBe(false);
    });

    test('history is not duplicated when the engine already recorded a command', async () => {
      const h = harness(session);
      h.runtime.start();
      await feed(h, 'help');
      h.runtime.saveHistory();
      h.runtime.saveHistory();

      const commands = session.sessionMemory.getRecentCommands().map((c) => c.text);
      expect(commands.filter((c) => c === 'help')).toHaveLength(1);
    });

    test('history can be disabled', async () => {
      const h = harness(session, { history: false });
      h.runtime.start();
      await feed(h, 'help');

      expect(h.runtime.loadHistory()).toEqual([]);
      expect(h.runtime.saveHistory()).toBe(0);
    });

    test('history is capped', () => {
      const h = harness(session, { maxHistory: 3 });
      for (let i = 0; i < 10; i++) session.sessionMemory.recordCommand(`cmd ${i}`);
      expect(h.runtime.loadHistory()).toHaveLength(3);
    });

    test('loadHistory tolerates a session with no SessionMemory', () => {
      const h = harness({ sessionMemory: null, shutdown: async () => ({ ok: true }) }, {
        cli: { handle: async () => ({ output: '', done: false }) },
      });
      expect(h.runtime.loadHistory()).toEqual([]);
      expect(h.runtime.saveHistory()).toBe(0);
    });
  });

  test('dry-run summary is printed at shutdown', async () => {
    const mode = {
      dryRun: true,
      summary: () => 'Dry run summary — 1 intercepted action(s):\n  - approve exec_1 (simulated)',
    };
    const h = harness(session, { mode });
    await h.runtime.shutdown(0);
    expect(h.lines.join('\n')).toContain('1 intercepted action(s)');
  });

  test('no dry-run summary is printed in live mode', async () => {
    const h = harness(session, { mode: { dryRun: false, summary: () => 'should not appear' } });
    await h.runtime.shutdown(0);
    expect(h.lines.join('\n')).not.toContain('should not appear');
  });
});
