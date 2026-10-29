// Loaded via require() through the launcher fixture. The dynamic import()
// below goes through Node's ESM loader, which `require('tsx/cjs')` does
// NOT hook — only `node --import tsx` covers it.
(async () => {
  try {
    const m = await import('./target');
    process.stdout.write(`IMPORT_OK:${(m as { VALUE: string }).VALUE}`);
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : String(error);
    process.stdout.write(`IMPORT_FAIL:${code}`);
  }
})();
