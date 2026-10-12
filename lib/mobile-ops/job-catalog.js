'use strict';

/**
 * Long-running mobile-ops jobs (builds, test suites). Same rules as the
 * typed action catalog: no arbitrary shell. Every job is a fixed list of
 * steps — command, argv and working directory are constants defined here.
 * The only caller input is an enum value validated against an allowlist
 * (e.g. a test-suite key), never a string that reaches argv unchecked.
 */

const path = require('path');
const { TEST_SUITES } = require('./action-catalog');

const WIN = process.platform === 'win32';
// npm/npx/gradlew are .cmd/.bat shims on Windows (the HYDI host).
const bin = (name) => (WIN ? `${name}.cmd` : name);
const gradlew = () => (WIN ? 'gradlew.bat' : './gradlew');

const MIN = 60_000;

/**
 * @typedef {{ label: string, cmd: string, args: string[], cwd: string, env?: Record<string,string> }} JobStep
 * @typedef {{ permission: string, confirmRequired: boolean, summary: string, timeoutMs: number,
 *   steps: (args: object, root: string) => JobStep[] | { error: string, allowed?: string[] },
 *   artifacts?: (root: string) => string[] }} JobDef
 */

/** @type {Record<string, JobDef>} */
const JOBS = Object.freeze({
  'tests.suite': {
    permission: 'ops:run_tests',
    confirmRequired: true,
    summary: 'Run one allowlisted HYDI Jest suite with live output.',
    timeoutMs: 10 * MIN,
    steps(args, root) {
      const suite = typeof args.suite === 'string' ? args.suite : '';
      const files = TEST_SUITES[suite];
      if (!files) return { error: 'unknown_suite', allowed: Object.keys(TEST_SUITES) };
      return [{ label: `jest ${suite}`, cmd: bin('npx'), args: ['jest', ...files, '--runInBand', '--forceExit', '--colors=false'], cwd: root }];
    },
  },
  'walkie.tests': {
    permission: 'ops:run_tests',
    confirmRequired: true,
    summary: 'Walkie server + mobile unit tests (memory store; no services needed).',
    timeoutMs: 10 * MIN,
    steps(_args, root) {
      return [
        { label: 'walkie server tests', cmd: bin('npm'), args: ['test'], cwd: path.join(root, 'apps/walkie/server') },
        { label: 'walkie mobile tests', cmd: bin('npm'), args: ['test'], cwd: path.join(root, 'apps/walkie/mobile') },
      ];
    },
  },
  'walkie.android.check': {
    permission: 'ops:run_tests',
    confirmRequired: false,
    summary: 'Compile-check the Walkie Android background service (no SDK needed).',
    timeoutMs: 10 * MIN,
    steps(_args, root) {
      return [
        {
          label: 'gradle compileKotlin',
          cmd: WIN ? 'gradle.bat' : 'gradle',
          args: ['-p', 'native-checks/android-service', 'compileKotlin', '--console=plain'],
          cwd: path.join(root, 'apps/walkie/mobile'),
        },
      ];
    },
  },
  'walkie.android.build': {
    permission: 'ops:build',
    confirmRequired: true,
    summary: 'Build the Walkie Android development APK on the HYDI host (needs Android SDK + JDK there).',
    timeoutMs: 45 * MIN,
    steps(_args, root) {
      const mobile = path.join(root, 'apps/walkie/mobile');
      const env = { APP_VARIANT: 'development', CI: '1' };
      return [
        { label: 'expo prebuild (android)', cmd: bin('npx'), args: ['expo', 'prebuild', '--platform', 'android', '--no-install'], cwd: mobile, env },
        { label: 'gradle assembleDebug', cmd: gradlew(), args: ['assembleDebug', '--console=plain'], cwd: path.join(mobile, 'android'), env },
      ];
    },
    artifacts: (root) => [path.join(root, 'apps/walkie/mobile/android/app/build/outputs/apk/debug/app-debug.apk')],
  },
});

function isKnownJob(kind) {
  return typeof kind === 'string' && Object.prototype.hasOwnProperty.call(JOBS, kind);
}

module.exports = { JOBS, isKnownJob };
