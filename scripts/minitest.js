#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */
/**
 * Minimal Jest-compatible runner for environments where the full Jest crawler
 * is unavailable (e.g. running the suite over a slow network mount).
 *
 * Supports the subset of the Jest API used by tests/unit/hydi-v3: describe,
 * test, beforeEach, afterEach, and the matchers those specs rely on. It is a
 * verification convenience only — `npm test` (real Jest) remains authoritative.
 *
 * Usage: node scripts/minitest.js <testFile> [...testFile]
 */

const path = require('path');

const state = { suites: [], stack: [], failures: [], passed: 0, skipped: 0 };

function currentSuite() {
  return state.stack[state.stack.length - 1];
}

function makeSuite(name, parent) {
  return { name, parent, tests: [], suites: [], before: [], after: [] };
}

const root = makeSuite('', null);
state.stack.push(root);

function describe(name, fn) {
  const suite = makeSuite(name, currentSuite());
  currentSuite().suites.push(suite);
  state.stack.push(suite);
  fn();
  state.stack.pop();
}

function test(name, fn) {
  currentSuite().tests.push({ name, fn });
}
test.skip = (name) => { currentSuite().tests.push({ name, skip: true }); };
describe.skip = () => {};

function beforeEach(fn) { currentSuite().before.push(fn); }
function afterEach(fn) { currentSuite().after.push(fn); }

function stringify(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Error) return value.message;
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual(a[k], b[k]));
}

function fail(message) {
  throw new Error(message);
}

function captureThrow(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return null;
}

function matchesExpected(error, expected) {
  if (expected === undefined) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (expected instanceof RegExp) return expected.test(message);
  return message.includes(String(expected));
}

function buildMatchers(actual, negated) {
  const check = (pass, message) => {
    if (negated ? pass : !pass) fail(negated ? `NOT ${message}` : message);
  };

  const matchers = {
    toBe(expected) {
      check(Object.is(actual, expected), `expected ${stringify(actual)} to be ${stringify(expected)}`);
    },
    toEqual(expected) {
      check(deepEqual(actual, expected), `expected ${stringify(actual)} to equal ${stringify(expected)}`);
    },
    toContain(expected) {
      const pass = typeof actual === 'string'
        ? actual.includes(expected)
        : Array.isArray(actual) && actual.some((item) => deepEqual(item, expected));
      check(pass, `expected value to contain ${stringify(expected)}`);
    },
    toMatch(expected) {
      const pattern = expected instanceof RegExp ? expected : new RegExp(expected);
      check(pattern.test(String(actual)), `expected ${stringify(actual)} to match ${pattern}`);
    },
    toBeTruthy() { check(!!actual, `expected ${stringify(actual)} to be truthy`); },
    toBeFalsy() { check(!actual, `expected ${stringify(actual)} to be falsy`); },
    toBeNull() { check(actual === null, `expected ${stringify(actual)} to be null`); },
    toBeUndefined() { check(actual === undefined, `expected ${stringify(actual)} to be undefined`); },
    toBeDefined() { check(actual !== undefined, `expected ${stringify(actual)} to be defined`); },
    toBeGreaterThan(n) { check(actual > n, `expected ${stringify(actual)} > ${n}`); },
    toBeGreaterThanOrEqual(n) { check(actual >= n, `expected ${stringify(actual)} >= ${n}`); },
    toBeLessThan(n) { check(actual < n, `expected ${stringify(actual)} < ${n}`); },
    toBeLessThanOrEqual(n) { check(actual <= n, `expected ${stringify(actual)} <= ${n}`); },
    toBeCloseTo(n, digits = 2) {
      check(Math.abs(actual - n) < 10 ** -digits / 2, `expected ${stringify(actual)} close to ${n}`);
    },
    toBeInstanceOf(ctor) { check(actual instanceof ctor, `expected value to be instance of ${ctor.name}`); },
    toHaveProperty(key) {
      check(actual != null && Object.prototype.hasOwnProperty.call(actual, key), `expected object to have property ${key}`);
    },
    toHaveLength(n) { check(actual && actual.length === n, `expected length ${n}, got ${actual && actual.length}`); },
    toThrow(expected) {
      if (typeof actual !== 'function') fail('toThrow requires a function');
      const error = captureThrow(actual);
      check(!!error && matchesExpected(error, expected), `expected function to throw ${stringify(expected)}`);
    },
  };

  return matchers;
}

/** Minimal `jest` global so specs using jest.fn()/spyOn can still be executed. */
const jestShim = {
  fn(impl) {
    const mock = { calls: [], results: [] };
    const wrapper = (...args) => {
      mock.calls.push(args);
      const value = impl ? impl(...args) : undefined;
      mock.results.push({ type: 'return', value });
      return value;
    };
    wrapper.mock = mock;
    wrapper.mockClear = () => { mock.calls.length = 0; mock.results.length = 0; return wrapper; };
    wrapper.mockReturnValue = (value) => jestShim.fn(() => value);
    wrapper.mockResolvedValue = (value) => jestShim.fn(() => Promise.resolve(value));
    wrapper.mockImplementation = (fn) => jestShim.fn(fn);
    return wrapper;
  },
  spyOn(object, key) {
    const original = object[key];
    const spy = jestShim.fn((...args) => original.apply(object, args));
    spy.mockRestore = () => { object[key] = original; };
    object[key] = spy;
    return spy;
  },
  clearAllMocks() {},
  resetAllMocks() {},
  restoreAllMocks() {},
  setTimeout() {},
};

function expect(actual) {
  const api = buildMatchers(actual, false);
  api.not = buildMatchers(actual, true);

  const settle = async (negatedRejects) => {
    try {
      const value = await actual;
      return { rejected: false, value };
    } catch (error) {
      if (!negatedRejects) return { rejected: true, error };
      throw error;
    }
  };

  api.resolves = {
    async toBeUndefined() {
      const outcome = await settle(false);
      if (outcome.rejected) fail(`expected promise to resolve, it rejected with ${stringify(outcome.error)}`);
      if (outcome.value !== undefined) fail(`expected resolved value undefined, got ${stringify(outcome.value)}`);
    },
    async toBe(expected) {
      const outcome = await settle(false);
      if (outcome.rejected) fail(`expected promise to resolve, it rejected with ${stringify(outcome.error)}`);
      if (!Object.is(outcome.value, expected)) fail(`expected ${stringify(outcome.value)} to be ${stringify(expected)}`);
    },
  };

  api.rejects = {
    async toThrow(expected) {
      const outcome = await settle(false);
      if (!outcome.rejected) fail('expected promise to reject, it resolved');
      if (!matchesExpected(outcome.error, expected)) {
        fail(`expected rejection matching ${stringify(expected)}, got ${stringify(outcome.error)}`);
      }
    },
  };

  return api;
}

async function runSuite(suite, trail) {
  const label = suite.name ? [...trail, suite.name] : trail;

  for (const t of suite.tests) {
    const title = [...label, t.name].join(' › ');
    if (t.skip) {
      state.skipped++;
      console.log(`  - ${title} (skipped)`);
      continue;
    }

    const hooks = [];
    for (let node = suite; node; node = node.parent) hooks.unshift(node);

    try {
      for (const node of hooks) {
        for (const hook of node.before) await hook();
      }
      await t.fn();
      state.passed++;
      console.log(`  ✓ ${title}`);
    } catch (error) {
      state.failures.push({ title, error });
      console.log(`  ✗ ${title}`);
      console.log(`      ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      for (const node of [...hooks].reverse()) {
        for (const hook of node.after) {
          try {
            await hook();
          } catch (e) { /* ignore teardown noise */ }
        }
      }
    }
  }

  for (const child of suite.suites) await runSuite(child, label);
}

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error('Usage: node scripts/minitest.js <testFile> [...]');
    process.exit(1);
  }

  Object.assign(global, {
    describe, test, it: test, expect, beforeEach, afterEach, beforeAll: beforeEach, afterAll: afterEach, jest: jestShim,
  });

  for (const file of files) {
    const resolved = path.resolve(process.cwd(), file);
    console.log(`\n${file}`);
    state.stack = [root];
    require(resolved);
  }

  await runSuite(root, []);

  console.log('');
  console.log(`passed ${state.passed}, failed ${state.failures.length}, skipped ${state.skipped}`);
  process.exit(state.failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
