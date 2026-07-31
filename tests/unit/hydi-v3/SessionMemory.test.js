'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;
const SessionMemory = require('../../../src/hydi-v3/SessionMemory');

const SILENT = { log: () => {}, error: () => {} };

describe('SessionMemory', () => {
  let dataPath;
  let session;

  beforeEach(async () => {
    dataPath = path.join(os.tmpdir(), `heidi-sessionmemory-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dataPath, { recursive: true });
    session = new SessionMemory({ dataPath, logger: SILENT });
    await session.start();
  });

  afterEach(async () => {
    if (session) await session.destroy().catch(() => {});
    try { await fs.rm(dataPath, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  });

  test('lifecycle methods work', async () => {
    expect(session.healthCheck().ok).toBe(true);
    await session.flush();
    session.stop();
    await session.destroy();
    expect(session._destroyed).toBe(true);
  });

  test('defaults to an empty context', () => {
    const ctx = session.getContext();
    expect(ctx.focus).toBeNull();
    expect(ctx.activeProject).toBeNull();
    expect(ctx.ownerPriority).toBe('default');
    expect(ctx.recentCommands).toEqual([]);
    expect(ctx.conversationHistory).toEqual([]);
  });

  test('setters update context fields', () => {
    session.setFocus('resonate');
    session.setActiveProject('resonate-release');
    session.setActiveObjective('resonate');
    session.setOwnerPriority('resonate');
    session.setWindowLayout({ timelineCollapsed: true });
    const ctx = session.getContext();
    expect(ctx.focus).toBe('resonate');
    expect(ctx.activeProject).toBe('resonate-release');
    expect(ctx.activeObjective).toBe('resonate');
    expect(ctx.ownerPriority).toBe('resonate');
    expect(ctx.windowLayout.timelineCollapsed).toBe(true);
  });

  test('recordCommand and recordConversationTurn accumulate and cap history', () => {
    for (let i = 0; i < 60; i++) session.recordCommand(`cmd ${i}`);
    expect(session.getContext().recentCommands.length).toBe(50);
    expect(session.getContext().recentCommands[49].text).toBe('cmd 59');

    session.recordConversationTurn('good morning', { text: 'Good morning.', intent: 'good-morning' });
    const history = session.getContext().conversationHistory;
    expect(history.length).toBe(1);
    expect(history[0].response).toBe('Good morning.');
  });

  test('update() merges only known fields', () => {
    session.update({ focus: 'manufacturing', unknownField: 'ignored' });
    const ctx = session.getContext();
    expect(ctx.focus).toBe('manufacturing');
    expect(ctx.unknownField).toBeUndefined();
  });

  test('reset() clears context back to defaults', () => {
    session.setFocus('resonate');
    session.reset();
    expect(session.getContext().focus).toBeNull();
  });

  test('persists and restores context across restarts', async () => {
    session.setFocus('revenue');
    session.setOwnerPriority('revenue');
    session.recordCommand('focus revenue');
    await session.destroy();

    const restored = new SessionMemory({ dataPath, logger: SILENT });
    await restored.start();
    const ctx = restored.getContext();
    expect(ctx.focus).toBe('revenue');
    expect(ctx.ownerPriority).toBe('revenue');
    expect(ctx.recentCommands.length).toBe(1);
    await restored.destroy();
    session = null;
  });

  test('recovers from corrupted persistence', async () => {
    await session.destroy();
    await fs.writeFile(path.join(dataPath, 'session-memory.json'), 'not-json {');
    const restored = new SessionMemory({ dataPath, logger: SILENT });
    await expect(restored.start()).resolves.toBeUndefined();
    expect(restored.healthCheck().ok).toBe(true);
    expect(restored.getContext().focus).toBeNull();
    await restored.destroy();
    session = null;
  });
});
