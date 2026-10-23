// Post-build fixup for `output: "standalone"` in this repo layout.
//
// next.config.ts sets turbopack.root to the repository root so the app's
// `@repo/*` imports (tsconfig `../../*`) resolve. A side effect: Next nests
// the standalone bundle under `.next/standalone/apps/ursula-frontend/`.
// OpenNext for Cloudflare expects the flat layout (`.next/standalone/.next`,
// `server.js`, `package.json` at the top level), so move the nested tree up.
import fs from "node:fs";
import path from "node:path";

const appDir = path.resolve(import.meta.dirname, "..");
const standalone = path.join(appDir, ".next", "standalone");
const nested = path.join(standalone, "apps", "ursula-frontend");

if (fs.existsSync(nested)) {
  for (const entry of fs.readdirSync(nested)) {
    const from = path.join(nested, entry);
    const to = path.join(standalone, entry);
    fs.rmSync(to, { recursive: true, force: true });
    fs.renameSync(from, to);
  }
  fs.rmSync(path.join(standalone, "apps"), { recursive: true, force: true });
  console.log("[flatten-standalone] moved nested standalone bundle up to .next/standalone");
}

// Next 16 emits server/middleware.js (+ .nft.json) in the build dir but does
// not copy middleware.js into .next/standalone when the middleware manifest is
// empty. OpenNext's copyTracedFiles sees the .nft.json and then asserts the
// file exists in standalone — mirror its own instrumentation.js shim here.
const buildServer = path.join(appDir, ".next", "server");
const standaloneServer = path.join(standalone, ".next", "server");
for (const name of ["middleware.js", "middleware.js.map"]) {
  const from = path.join(buildServer, name);
  const to = path.join(standaloneServer, name);
  if (fs.existsSync(from) && !fs.existsSync(to)) {
    fs.copyFileSync(from, to);
    console.log(`[flatten-standalone] copied ${name} into standalone server dir`);
  }
}
