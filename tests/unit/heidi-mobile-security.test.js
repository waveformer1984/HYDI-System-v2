'use strict';

/**
 * Static guarantees for the Heidi Mobile client bundle:
 *   - nothing reachable from pages/heidi.tsx can touch a server secret, a
 *     signing helper, or a HYDI credential header;
 *   - the PWA manifest and service worker are valid and the worker never
 *     caches API responses.
 * Walks the real import graph from the page entry point rather than
 * trusting a hand-maintained file list.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const ENTRY = path.join(ROOT, 'pages', 'heidi.tsx');

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null; // package import (react, next/head)
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`unresolved import ${spec} from ${fromFile}`);
}

function clientGraph() {
  const seen = new Set();
  const packages = new Set();
  const stack = [ENTRY];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|js)$/.test(file)) continue;
    const src = fs.readFileSync(file, 'utf8');
    const specs = [...src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/g)]
      .map((m) => m[1] || m[2] || m[3]);
    for (const spec of specs) {
      const resolved = resolveImport(file, spec);
      if (resolved) stack.push(resolved);
      else packages.add(spec);
    }
  }
  return { files: [...seen], packages: [...packages] };
}

describe('Heidi Mobile client bundle', () => {
  const { files, packages } = clientGraph();
  const rel = files.map((f) => path.relative(ROOT, f).split(path.sep).join('/'));

  it('only reaches client-safe modules from the page entry point', () => {
    for (const f of rel) {
      expect(f).toMatch(/^(pages\/heidi\.tsx|components\/heidi-mobile\/|lib\/heidi-mobile\/client\/|lib\/heidi-mobile\/sseParser\.ts|styles\/heidi-mobile\.module\.css)/);
    }
    expect(rel).not.toEqual(expect.arrayContaining([expect.stringMatching(/session\.js|hydiClient|guard\.js|lib\/auth\//)]));
    expect(packages.sort()).toEqual(['next/head', 'react']);
  });

  it('contains no secret names, credential headers, signing helpers or env reads', () => {
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const where = path.relative(ROOT, file);
      expect({ where, hit: /HYDI_SERVICE_SECRET|SUPABASE_SERVICE_ROLE_KEY|x-hydi-(device|service)-token|signDeviceToken|deriveSigningKey|createHmac/.test(src) }).toEqual({ where, hit: false });
      const envReads = [...src.matchAll(/process\.env\.([A-Z_]+)/g)].map((m) => m[1]);
      expect({ where, envReads: envReads.filter((n) => n !== 'NODE_ENV') }).toEqual({ where, envReads: [] });
      expect({ where, publicSecret: /NEXT_PUBLIC_[A-Z_]*(SECRET|KEY|TOKEN)/.test(src) }).toEqual({ where, publicSecret: false });
    }
  });

  it('never puts credentials in URLs or browser storage', () => {
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      expect(/[?&](token|device_token|secret)=/.test(src)).toBe(false);
      expect(/localStorage\.setItem\([^)]*(secret|token|key)/i.test(src)).toBe(false);
    }
  });
});

describe('Heidi Mobile PWA', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'heidi.webmanifest'), 'utf8'));

  function pngSize(p) {
    const buf = fs.readFileSync(p);
    expect(buf.subarray(1, 4).toString('latin1')).toBe('PNG');
    return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  }

  it('is installable: standalone, scoped to /heidi, opening into Heidi', () => {
    expect(manifest).toMatchObject({ start_url: '/heidi', scope: '/heidi', display: 'standalone', short_name: 'Heidi' });
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('references icons that exist at their declared sizes (192 and 512 required by Android)', () => {
    const sizes = manifest.icons.map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) {
      const [w, h] = pngSize(path.join(ROOT, 'public', icon.src));
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
  });

  it('the page links the manifest and sets a mobile viewport', () => {
    const page = fs.readFileSync(ENTRY, 'utf8');
    expect(page).toContain('href="/heidi.webmanifest"');
    expect(page).toMatch(/viewport-fit=cover/);
    expect(page).toMatch(/interactive-widget=resizes-content/);
  });

  it('the service worker never intercepts API calls', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'public', 'heidi-sw.js'), 'utf8');
    expect(sw).toMatch(/url\.pathname\.startsWith\('\/api\/'\)\) return;/);
    expect(sw).not.toMatch(/caches?\.(put|add)[^;]*\/api\//);
  });
});
