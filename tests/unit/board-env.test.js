'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadBoardEnv } = require('../../lib/runtime/board-env');

function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'board-env-'));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, name), text);
  return root;
}

describe('loadBoardEnv', () => {
  it('loads only HYDI_BOARD_* keys from .env.local, so --update-env never carries PORT or NODE_ENV', () => {
    const root = repo({
      '.env.local': [
        'HYDI_BOARD_URL=http://127.0.0.1:3000',
        'HYDI_BOARD_TOKEN_HYDI_DAEMON=daemon-token',
        'PORT=9999',
        'NODE_ENV=production',
        'STRIPE_SECRET_KEY=sk_test_x',
      ].join('\n'),
    });
    const env = {};
    const set = loadBoardEnv(root, { env });
    expect(env).toEqual({ HYDI_BOARD_URL: 'http://127.0.0.1:3000', HYDI_BOARD_TOKEN_HYDI_DAEMON: 'daemon-token' });
    expect(set.sort()).toEqual(['HYDI_BOARD_TOKEN_HYDI_DAEMON', 'HYDI_BOARD_URL']);
  });

  it('never overrides a value PM2 already set, and .env.local wins over .env', () => {
    const root = repo({
      '.env.local': 'HYDI_BOARD_URL=http://local\nHYDI_BOARD_TOKEN=local-token\n',
      '.env': 'HYDI_BOARD_TOKEN=env-token\nHYDI_BOARD_TOKEN_HEIDI=heidi-token\n',
    });
    const env = { HYDI_BOARD_URL: 'http://from-pm2' };
    loadBoardEnv(root, { env });
    expect(env).toEqual({ HYDI_BOARD_URL: 'http://from-pm2', HYDI_BOARD_TOKEN: 'local-token', HYDI_BOARD_TOKEN_HEIDI: 'heidi-token' });
  });

  it('is a no-op when the files are missing', () => {
    const env = {};
    expect(loadBoardEnv(repo({}), { env })).toEqual([]);
    expect(env).toEqual({});
  });

  it('makes the board SDK find the hydi-daemon token the frank loops post with', () => {
    const root = repo({ '.env.local': 'HYDI_BOARD_TOKEN_HYDI_DAEMON=daemon-token\n' });
    const saved = { ...process.env };
    try {
      for (const k of Object.keys(process.env)) if (k.startsWith('HYDI_BOARD_')) delete process.env[k];
      const sdk = require('../../lib/forge-board/sdk');
      expect(sdk.tokenFor('hydi-daemon')).toBeFalsy();
      loadBoardEnv(root);
      expect(sdk.tokenFor('hydi-daemon')).toBe('daemon-token');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  it('every frank-* loop loads it at startup, before anything posts', () => {
    for (const script of ['frank-auto-deploy.js', 'frank-observer.js', 'frank-storage-guard.js']) {
      const src = fs.readFileSync(path.join(__dirname, '../../scripts', script), 'utf8');
      const main = src.slice(src.indexOf('if (require.main === module)'));
      expect(main.split('\n')[1]).toContain("require('../lib/runtime/board-env').loadBoardEnv(");
    }
  });
});
