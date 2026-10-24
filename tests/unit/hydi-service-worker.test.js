'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const vm = require('vm');

function pythonBin() {
  return process.env.HYDI_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

const hasPython = spawnSync(pythonBin(), ['--version'], { encoding: 'utf8' }).status === 0;

function loadServiceWorker() {
  const root = path.resolve(__dirname, '..', '..');
  const res = spawnSync(pythonBin(), ['-c', 'import hydi,sys; sys.stdout.write(hydi.SW_JS)'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GROQ_API_KEY: '', OLLAMA_URL: 'http://127.0.0.1:9' },
  });
  if (res.status !== 0) throw new Error(res.stderr || 'could not read SW_JS');
  return res.stdout;
}

function runWorker(source, { network }) {
  const listeners = {};
  const store = new Map([['https://phone/', 'STALE PAGE']]);
  const cache = {
    put: async (req, res) => { store.set(req.url || req, res.body); },
    addAll: async () => {},
  };
  const sandbox = {
    self: { addEventListener: (name, fn) => { listeners[name] = fn; }, skipWaiting: () => {}, clients: { claim: () => {} } },
    caches: {
      open: async () => cache,
      keys: async () => [],
      delete: async () => true,
      match: async (req) => {
        const key = typeof req === 'string' ? `https://phone${req}` : req.url;
        return store.has(key) ? { body: store.get(key), ok: true } : undefined;
      },
    },
    fetch: async () => {
      if (!network) throw new Error('offline');
      return { ok: true, body: 'FRESH PAGE', clone() { return { body: 'FRESH PAGE' }; } };
    },
  };
  vm.runInNewContext(source, sandbox);
  return async (url) => {
    let responded;
    listeners.fetch({ request: { url, method: 'GET' }, respondWith: (p) => { responded = p; } });
    return responded ? (await responded).body : 'PASSTHROUGH';
  };
}

(hasPython ? describe : describe.skip)('hydi.py service worker', () => {
  it('serves the live page when the network works, even with a stale cached copy', async () => {
    const fetchVia = runWorker(loadServiceWorker(), { network: true });
    expect(await fetchVia('https://phone/')).toBe('FRESH PAGE');
  });

  it('falls back to the cached page only when offline', async () => {
    const fetchVia = runWorker(loadServiceWorker(), { network: false });
    expect(await fetchVia('https://phone/')).toBe('STALE PAGE');
  });

  it('never intercepts API calls and uses a new cache name', async () => {
    const source = loadServiceWorker();
    const fetchVia = runWorker(source, { network: true });
    expect(await fetchVia('https://phone/api/chat')).toBe('PASSTHROUGH');
    expect(source).not.toMatch(/const C='hydi-v2'/);
  });
});
