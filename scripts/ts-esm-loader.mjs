/**
 * Minimal loader hook: lets plain Node resolve a `.js` import specifier to a
 * sibling `.ts` file and transpile it on the fly (via the `typescript`
 * package already in node_modules -- no new dependency).
 *
 * Needed because this repo's source uses TS-style import specifiers
 * (`import x from '../../lib/foo.js'` where only `lib/foo.ts` exists), which
 * only bundlers (Next.js/webpack) resolve automatically. Plain Node's ESM
 * resolver does not do extension substitution, so without this hook
 * `node --import ./register.mjs script.mjs` would fail with
 * ERR_MODULE_NOT_FOUND on any such import.
 *
 * Used by scripts/verify-vercel-api.mjs via scripts/register-hook.mjs.
 */
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('.js')) {
    try {
      return await nextResolve(specifier, context);
    } catch (err) {
      if (err?.code !== 'ERR_MODULE_NOT_FOUND') throw err;
      return nextResolve(specifier.slice(0, -3) + '.ts', context);
    }
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith('.ts')) {
    const filePath = fileURLToPath(url);
    const source = readFileSync(filePath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
      fileName: filePath,
    });
    return { format: 'module', source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
