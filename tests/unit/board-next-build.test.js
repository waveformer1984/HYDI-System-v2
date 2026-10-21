'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const hasPython = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' }).status === 0;

describe('board route under next build', () => {
  const routeSrc = fs.readFileSync(path.join(__dirname, '../../pages/api/board.js'), 'utf8');

  it('does not use import.meta, which next build leaves undefined', () => {
    expect(routeSrc).not.toMatch(/import\.meta/);
    expect(routeSrc).not.toMatch(/from\s+['"]module['"]/);
    expect(routeSrc).toMatch(/getBuiltinModule\(['"]module['"]\)/);
    expect(routeSrc).toMatch(/process\.cwd\(\)/);
    expect(routeSrc).toMatch(/forge-board/);
    expect(routeSrc).toMatch(/http\.js/);
  });

  it('finds cli.py from the repo root when the bundled __dirname does not', () => {
    const { resolveCli } = require('../../lib/forge-board/http');
    const real = path.join(process.cwd(), 'lib', 'forge-board', 'cli.py');
    expect(resolveCli(['/tmp/does-not-exist/cli.py', real])).toBe(real);
    expect(fs.existsSync(resolveCli())).toBe(true);
  });

  (hasPython ? it : it.skip)('stays callable after the same webpack that rewrites createRequire', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'board-wp-'));
    const db = path.join(os.tmpdir(), `board-wp-${process.pid}-${Date.now()}.sqlite`);
    const script = `
      const fs = require('fs');
      const path = require('path');
      const { webpack } = require('next/dist/compiled/webpack/webpack.js');
      const outDir = process.env.BOARD_WEBPACK_OUT;
      webpack({
        mode: 'none',
        target: 'node',
        context: process.cwd(),
        entry: path.join(process.cwd(), 'pages/api/board.js'),
        output: { path: outDir, filename: 'board.js', library: { type: 'commonjs2' } },
        optimization: { minimize: false },
        externals: [({ request }, cb) => {
          if (request === 'path' || request === 'module' || (request && request.startsWith('node:'))) {
            cb(null, 'commonjs ' + request);
            return;
          }
          cb();
        }],
      }, (err, stats) => {
        if (err || stats.hasErrors()) {
          console.error(err || stats.toJson().errors.map((e) => e.message).join('\\n'));
          process.exit(1);
        }
        const bundled = fs.readFileSync(path.join(outDir, 'board.js'), 'utf8');
        if (bundled.includes('/* createRequire() */ undefined')) process.exit(2);
        if (!bundled.includes('getBuiltinModule')) process.exit(3);
        const handler = require(path.join(outDir, 'board.js')).default;
        const res = { statusCode: 0, setHeader() {}, end(body) { this.body = body; } };
        handler({
          method: 'GET',
          query: { channel: 'general' },
          headers: { host: '127.0.0.1:3000' },
          socket: { remoteAddress: '127.0.0.1' },
        }, res);
        if (res.statusCode !== 200) {
          console.error(res.statusCode, res.body);
          process.exit(4);
        }
        const body = JSON.parse(res.body);
        if (!body.ok || !Array.isArray(body.messages)) process.exit(5);
        process.exit(0);
      });
    `;
    const result = spawnSync(process.execPath, ['-e', script], {
      encoding: 'utf8',
      cwd: path.join(__dirname, '../..'),
      env: {
        ...process.env,
        BOARD_WEBPACK_OUT: outDir,
        HYDI_BOARD_DB: db,
        HYDI_BOARD_HUMAN_TOKEN: 'human-test-token',
        HYDI_BOARD_HUMAN_NAME: 'Jordan',
        HYDI_BOARD_UPSTREAM: '',
        SUPABASE_URL: '',
        SUPABASE_SERVICE_ROLE_KEY: '',
      },
    });
    try {
      if (result.status !== 0) {
        throw new Error(result.stderr || result.stdout || `webpack check exited ${result.status}`);
      }
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true });
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(db + suffix); } catch { /* already gone */ }
      }
    }
  });

  (hasPython ? it : it.skip)('serves GET /api/board through the pages route', () => {
    const db = path.join(os.tmpdir(), `board-next-${process.pid}-${Date.now()}.sqlite`);
    const previous = {
      HYDI_BOARD_DB: process.env.HYDI_BOARD_DB,
      HYDI_BOARD_HUMAN_TOKEN: process.env.HYDI_BOARD_HUMAN_TOKEN,
      HYDI_BOARD_HUMAN_NAME: process.env.HYDI_BOARD_HUMAN_NAME,
      HYDI_BOARD_UPSTREAM: process.env.HYDI_BOARD_UPSTREAM,
      SUPABASE_URL: process.env.SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    };
    process.env.HYDI_BOARD_DB = db;
    process.env.HYDI_BOARD_HUMAN_TOKEN = 'human-test-token';
    process.env.HYDI_BOARD_HUMAN_NAME = 'Jordan';
    process.env.HYDI_BOARD_UPSTREAM = '';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    jest.resetModules();
    const handler = require('../../pages/api/board.js').default;
    const req = {
      method: 'GET',
      query: { channel: 'general' },
      headers: { host: '127.0.0.1:3000' },
      socket: { remoteAddress: '127.0.0.1' },
    };
    const res = {
      statusCode: 0,
      setHeader() {},
      end(body) { this.body = body; },
    };
    try {
      handler(req, res);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).ok).toBe(true);
      expect(JSON.parse(res.body).messages).toEqual([]);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      for (const suffix of ['', '-wal', '-shm']) {
        try { fs.unlinkSync(db + suffix); } catch { /* already gone */ }
      }
    }
  });
});
