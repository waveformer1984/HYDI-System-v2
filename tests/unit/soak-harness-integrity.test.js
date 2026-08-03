/**
 * Soak Harness Modernization Integrity
 * =====================================
 *
 * Regression protection for the modernized soak harness: durable evidence,
 * configurable durations, and report generation.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');

const {
  SoakTest,
  SoakArtifactSet,
  parseArgs,
  parseDuration,
  DEFAULT_DURATION_MS,
} = require('../../scripts/soak-test');

const PACKAGE_JSON_PATH = path.join(__dirname, '..', '..', 'package.json');
const rawPackageJson = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
const pkg = JSON.parse(rawPackageJson);

function rawScriptKeys() {
  const start = rawPackageJson.indexOf('"scripts"');
  const braceStart = rawPackageJson.indexOf('{', start);

  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < rawPackageJson.length; i += 1) {
    if (rawPackageJson[i] === '{') depth += 1;
    if (rawPackageJson[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const block = rawPackageJson.slice(braceStart, end);
  const keys = [];
  const re = /"([^"\\]+)"\s*:/g;
  let match;
  while ((match = re.exec(block)) !== null) keys.push(match[1]);
  return keys;
}

describe('duration parsing', () => {
  test('default is 24 hours', () => {
    expect(parseDuration(undefined)).toBe(DEFAULT_DURATION_MS);
    expect(parseDuration('')).toBe(DEFAULT_DURATION_MS);
  });

  test.each([
    ['5m', 5 * 60 * 1000],
    ['15m', 15 * 60 * 1000],
    ['30m', 30 * 60 * 1000],
    ['1h', 60 * 60 * 1000],
    ['6h', 6 * 60 * 60 * 1000],
    ['12h', 12 * 60 * 60 * 1000],
    ['24h', 24 * 60 * 60 * 1000],
    ['3600000', 3600000],
    ['2h30m', 2.5 * 60 * 60 * 1000],
  ])('parseDuration(%s) === %i', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  test('unrecognised values fall back to 24h', () => {
    expect(parseDuration('banana')).toBe(DEFAULT_DURATION_MS);
    expect(parseDuration('-1h')).toBe(DEFAULT_DURATION_MS);
  });

  test('parseArgs supports --duration=1h syntax', () => {
    const parsed = parseArgs(['node', 'soak-test.js', '--duration=1h']);
    expect(parsed.durationMs).toBe(3600000);
    expect(parsed.durationText).toBe('1.00h');
  });

  test('parseArgs supports --duration 1h syntax', () => {
    const parsed = parseArgs(['node', 'soak-test.js', '--duration', '30m']);
    expect(parsed.durationMs).toBe(30 * 60 * 1000);
  });

  test('parseArgs defaults to 24h when no duration supplied', () => {
    const parsed = parseArgs(['node', 'soak-test.js']);
    expect(parsed.durationMs).toBe(DEFAULT_DURATION_MS);
  });
});

describe('durable artifact set', () => {
  const tmpBase = path.join(os.tmpdir(), `hydi-soak-artifacts-${Date.now()}`);

  test('creates all six required artifacts', () => {
    const set = new SoakArtifactSet(tmpBase);
    expect(fs.existsSync(set.runDir)).toBe(true);
    expect(fs.existsSync(set.paths.log)).toBe(true);
    expect(fs.existsSync(set.paths.metrics)).toBe(true);
    expect(fs.existsSync(set.paths.metricsJsonl)).toBe(true);
  });

  test('logs are appended and the file grows', () => {
    const set = new SoakArtifactSet(path.join(tmpBase, 'log-test'));
    const before = fs.statSync(set.paths.log).size;
    set.appendLog('INFO', 'first');
    set.appendLog('INFO', 'second');
    const after = fs.statSync(set.paths.log).size;
    expect(after).toBeGreaterThan(before);

    const lines = fs.readFileSync(set.paths.log, 'utf8').trim().split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(2);
    const first = JSON.parse(lines[0]);
    expect(first).toHaveProperty('timestamp');
    expect(first).toHaveProperty('level', 'INFO');
    expect(first).toHaveProperty('message', 'first');
  });

  test('metrics sample is persisted to metrics.json and metrics.jsonl', () => {
    const set = new SoakArtifactSet(path.join(tmpBase, 'metrics-test'));
    const sample = { timestamp: new Date().toISOString(), epochMs: Date.now(), value: 42 };
    set.appendMetricsSample(sample);

    const jsonl = fs.readFileSync(set.paths.metricsJsonl, 'utf8').trim().split('\n');
    expect(JSON.parse(jsonl[0])).toEqual(sample);

    const arr = JSON.parse(fs.readFileSync(set.paths.metrics, 'utf8'));
    expect(arr).toEqual([sample]);
  });

  test('fails immediately if the artifact directory cannot be created', () => {
    const blocking = path.join(tmpBase, 'blocking');
    fs.writeFileSync(blocking, 'not a directory');
    expect(() => new SoakArtifactSet(blocking)).toThrow();
  });
});

describe('soak test run produces the required evidence', () => {
  let server;
  let serverUrl;
  let runDir;

  beforeAll((done) => {
    process.env.PGHOST = '127.0.0.1';
    process.env.PGPORT = '1';
    process.env.REDIS_HOST = '127.0.0.1';
    process.env.REDIS_PORT = '1';

    server = http.createServer((req, res) => {
      if (req.url === '/api/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      serverUrl = `http://127.0.0.1:${port}/api/health`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  test('a short run writes all six artifacts and passes', async () => {
    runDir = path.join(os.tmpdir(), `hydi-soak-run-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const options = parseArgs([
      'node', 'soak-test.js',
      '--duration', '10000',
      '--interval', '100',
      '--metrics-interval', '10000000',
      '--target', serverUrl,
      '--report', runDir,
    ]);

    const test = new SoakTest(options);
    const report = await test.run();

    const a = test.artifacts;
    expect(fs.existsSync(a.paths.log)).toBe(true);
    expect(fs.existsSync(a.paths.metrics)).toBe(true);
    expect(fs.existsSync(a.paths.metricsJsonl)).toBe(true);
    expect(fs.existsSync(a.paths.summary)).toBe(true);
    expect(fs.existsSync(a.paths.report)).toBe(true);
    expect(fs.existsSync(a.paths.systemInfo)).toBe(true);
    expect(fs.existsSync(a.paths.configuration)).toBe(true);

    const summary = JSON.parse(fs.readFileSync(a.paths.summary, 'utf8'));
    expect(summary).toHaveProperty('result.passed');
    expect(summary).toHaveProperty('endurance.requests');
    expect(summary).toHaveProperty('endurance.successRatePercent');
    expect(summary).toHaveProperty('operational.uptimeSeconds');
    expect(summary).toHaveProperty('operational.restartCount');
    expect(summary).toHaveProperty('operational.exceptionCount');
    expect(summary).toHaveProperty('operational.unhandledRejectionCount');

    const metrics = JSON.parse(fs.readFileSync(a.paths.metrics, 'utf8'));
    expect(Array.isArray(metrics)).toBe(true);
    expect(metrics.length).toBeGreaterThan(0);

    const markdown = fs.readFileSync(a.paths.report, 'utf8');
    expect(markdown).toContain('# HYDI Soak Qualification Report');
    expect(markdown).toContain('## Endurance');
    expect(markdown).toContain('## Operational Metrics');

    expect(report.result.passed).toBe(true);
  }, 30000);
});

describe('package.json soak scripts', () => {
  test('has no duplicate script names', () => {
    const keys = rawScriptKeys();
    const seen = new Set();
    const dupes = [];
    for (const k of keys) {
      if (seen.has(k)) dupes.push(k);
      seen.add(k);
    }
    expect(dupes).toEqual([]);
  });

  test('soak-test-1h invokes the harness with a human duration', () => {
    expect(pkg.scripts['soak-test-1h']).toContain('scripts/soak-test.js');
    expect(pkg.scripts['soak-test-1h']).toContain('--duration 1h');
  });

  test('soak-test-24h invokes the harness and uses the 24h default', () => {
    expect(pkg.scripts['soak-test-24h']).toContain('scripts/soak-test.js');
    expect(pkg.scripts['soak-test-24h']).not.toContain('--duration');
  });
});
