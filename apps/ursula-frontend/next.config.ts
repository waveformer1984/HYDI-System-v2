import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // reactCompiler: true,

  // Required by OpenNext (build:cf) — emits .next/standalone + manifests the
  // adapter bundles into the Cloudflare worker. Vercel ignores this setting.
  output: "standalone",

  // turbopack.root: the app's tsconfig maps `@repo/*` to the repository root
  // (`../../*`); without this, Turbopack's filesystem sandbox is the app dir
  // and those imports fail to resolve. Side effect: .next/standalone is
  // emitted nested under standalone/apps/ursula-frontend/ — the build:cf
  // script flattens it back before OpenNext bundles (see
  // scripts/flatten-standalone.mjs).
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
};

export default nextConfig;
