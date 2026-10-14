// Bundles the browser walkie (web/src) into web/dist. The push-to-talk state
// machine is shared with the app (mobile/src/ptt/machine.ts).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const dist = new URL('../web/dist/', import.meta.url);
mkdirSync(dist, { recursive: true });
await build({
  entryPoints: [new URL('../web/src/main.ts', import.meta.url).pathname],
  outfile: new URL('app.js', dist).pathname,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020', 'safari15'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
});
copyFileSync(new URL('../web/index.html', import.meta.url), new URL('index.html', dist));
console.log('[walkie] web client built into web/dist');
