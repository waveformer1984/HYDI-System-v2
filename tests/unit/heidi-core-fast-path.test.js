'use strict';

/**
 * Unit tests for the deterministic fast-path in heidi-core/server.js
 * (matchFastPath / formatFastPathResult / FAST_PATH_ROUTES). Both methods
 * are pure -- they never touch `this` -- so they're tested directly off the
 * prototype without booting a real HeidiCore instance (which would pull in
 * live SQLite, Ollama, and Express setup).
 */

const HeidiCore = require('../../heidi-core/server');
const ActionExecutor = require('../../heidi-core/actions/action-executor');

// matchFastPath's run_command route cross-checks the extracted "command"
// against ActionExecutor's real approvedCommands set, so tests need a
// context with a real (or equivalently-shaped) `actions` on it -- not a
// bare {}. Using a real ActionExecutor instance rather than a hardcoded
// list here too, so this test can't quietly drift from the real allowlist.
const fakeThis = () => ({ actions: new ActionExecutor() });
const matchFastPath = (input) => HeidiCore.prototype.matchFastPath.call(fakeThis(), input);
const formatFastPathResult = (tool, result) => HeidiCore.prototype.formatFastPathResult.call({}, tool, result);

describe('matchFastPath: routing', () => {
  it('returns null for empty/falsy input', () => {
    expect(matchFastPath('')).toBeNull();
    expect(matchFastPath(null)).toBeNull();
    expect(matchFastPath(undefined)).toBeNull();
  });

  it('returns null for an open-ended question with no matching pattern', () => {
    expect(matchFastPath('why is the pipeline failing on the third stage?')).toBeNull();
  });

  describe('system_status', () => {
    it.each([
      'status',
      'system status',
      'what is your status',
      'are you ok',
      'are you running',
      'how are you',
      'health check',
    ])('matches: "%s"', (input) => {
      expect(matchFastPath(input)).toEqual({ tool: 'system_status', args: {} });
    });
  });

  describe('list_models', () => {
    it.each([
      'list models',
      'what models do you have',
      'which models are installed',
      'show models',
    ])('matches: "%s"', (input) => {
      expect(matchFastPath(input)).toEqual({ tool: 'list_models', args: {} });
    });
  });

  describe('list_agents', () => {
    it.each([
      'list agents',
      'what agents are registered',
      'show agents',
    ])('matches: "%s"', (input) => {
      expect(matchFastPath(input)).toEqual({ tool: 'list_agents', args: {} });
    });
  });

  describe('list_missions', () => {
    it.each([
      'list missions',
      "what's the mission queue look like",
      'show missions',
    ])('matches: "%s"', (input) => {
      expect(matchFastPath(input)).toEqual({ tool: 'list_missions', args: {} });
    });
  });

  describe('run_command', () => {
    it('fast-paths "run git diff" with command and args', () => {
      expect(matchFastPath('run git diff')).toEqual({ tool: 'run_command', args: { command: 'git', args: ['diff'] } });
    });

    it('fast-paths "execute npm version" with command and args', () => {
      expect(matchFastPath('execute npm version')).toEqual({ tool: 'run_command', args: { command: 'npm', args: ['version'] } });
    });

    // Regression coverage: the run_command regex is just "run/execute <word>
    // ...", which also matches ordinary English. Without cross-checking the
    // extracted "command" against ActionExecutor's real allowlist, every one
    // of these previously fast-pathed into a confusing "Command 'the' is not
    // in approved list" error instead of a normal conversational answer.
    it.each([
      'run this by the team first',
      'run the tests',
      'run for president',
      'execute the plan',
      'run away',
    ])('does NOT fast-path ordinary English that happens to start with run/execute: "%s"', (input) => {
      expect(matchFastPath(input)).toBeNull();
    });

    it('falls back to not-a-match when no actions/approvedCommands context is available (fail closed)', () => {
      expect(HeidiCore.prototype.matchFastPath.call({}, 'run git diff')).toBeNull();
    });
  });

  it('does not fast-path a request that needs argument extraction (create_mission-shaped)', () => {
    expect(matchFastPath('create a mission to restart the mobile chat service')).toBeNull();
  });

  it('does not fast-path a run_command-shaped request', () => {
    expect(matchFastPath('restart the mobile chat service for me')).toBeNull();
  });

  it('run requests are routed to the run_command fast path, not system_status', () => {
    expect(matchFastPath('run git status for me')).toEqual({
      tool: 'run_command',
      args: { command: 'git', args: ['status', 'for', 'me'] }
    });
  });
});

describe('formatFastPathResult', () => {
  it('surfaces a tool error directly without touching the result shape', () => {
    const text = formatFastPathResult('system_status', { error: 'ollama unreachable' });
    expect(text).toMatch(/ollama unreachable/);
  });

  it('formats system_status with service states and installed models', () => {
    const text = formatFastPathResult('system_status', {
      hydi_services: { 'heidi-core': 'UP', 'dashboard': 'DOWN' },
      ollama_models_installed: ['llama3.2:3b', 'nomic-embed-text'],
    });
    expect(text).toMatch(/heidi-core: UP/);
    expect(text).toMatch(/dashboard: DOWN/);
    expect(text).toMatch(/llama3\.2:3b, nomic-embed-text/);
  });

  it('formats list_models with sizes and the currently-loaded set', () => {
    const text = formatFastPathResult('list_models', {
      installed: [{ name: 'llama3.2:3b', size_gb: 2.2 }, { name: 'tinyllama', size_gb: null }],
      loaded: ['llama3.2:3b'],
    });
    expect(text).toMatch(/llama3\.2:3b \(2\.2GB\)/);
    expect(text).toMatch(/tinyllama/);
    expect(text).not.toMatch(/tinyllama \(/); // no size suffix when size_gb is null
    expect(text).toMatch(/Currently loaded: llama3\.2:3b/);
  });

  it('formats list_agents as one line per agent with level and enabled state', () => {
    const text = formatFastPathResult('list_agents', [
      { name: 'Heidi', role: 'orchestrator', permission_level: 4, enabled: 1 },
      { name: 'Kilo', role: 'hypothesis', permission_level: 3, enabled: 0 },
    ]);
    expect(text).toMatch(/Heidi — orchestrator \(level 4, enabled\)/);
    expect(text).toMatch(/Kilo — hypothesis \(level 3, disabled\)/);
  });

  it('formats an empty agent list without crashing', () => {
    expect(formatFastPathResult('list_agents', [])).toMatch(/No registered agents/);
  });

  it('formats list_missions with id, status, priority, and goal', () => {
    const text = formatFastPathResult('list_missions', [
      { id: 1, status: 'pending', priority: 2, goal: 'restart the mobile chat' },
    ]);
    expect(text).toMatch(/#1 \[pending\] \(pri 2\) restart the mobile chat/);
  });

  it('formats an empty mission queue without crashing', () => {
    expect(formatFastPathResult('list_missions', [])).toMatch(/No missions in the queue/);
  });
});
