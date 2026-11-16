/** @type {import('next').NextConfig} */
const path = require('path')

// Explicit build-worker cap for resource-constrained hosts. Next's default is
// logical CPUs - 1, which OOM-killed export workers on Frank (16 GB RAM,
// 2026-11-15). Only applied when HYDI_BUILD_CPUS is a positive integer;
// otherwise Next's default stands. Verified against next@16.4.1: the value
// feeds experimental.cpus -> getNumberOfWorkers in build/index.js and caps
// static-generation/page-data workers (it does not limit webpack compile
// parallelism). Scope/version dependency: revalidate on Next upgrades or
// when host RAM or the page count changes materially.
const buildCpus = Number.parseInt(process.env.HYDI_BUILD_CPUS || '', 10)

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    ...(Number.isInteger(buildCpus) && buildCpus > 0 ? { cpus: buildCpus } : {}),
  },
  // frank-auto-deploy builds into a staging directory and swaps it in only
  // once the build is complete, so a build that dies halfway never leaves
  // the live site without a working .next. Unset means the normal .next.
  distDir: process.env.HYDI_NEXT_DIST_DIR || '.next',
  outputFileTracingRoot: path.join(__dirname),
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  // Next 16's `next dev` otherwise appends its own rules block to AGENTS.md
  // on every start, leaving the curated file dirty after each run.
  agentRules: false,
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
  eslint: {
    // `next lint`'s default scope is only pages/, app/, components/, lib/,
    // src/ -- silently excluding workers/, agents/, revenue-engine/, api/,
    // and kilo/ from `npm run lint` (and therefore from CI's `unit-tests.yml`
    // lint gate) even though they're real, actively-linted-by-hand JS.
    // Found 2026-07-18 while migrating console.* -> structured logger:
    // several pre-existing no-unused-vars warnings in agents/ and workers/
    // had never surfaced because lint never actually looked at them.
    dirs: ['pages', 'components', 'lib', 'src', 'hooks', 'workers', 'agents', 'revenue-engine', 'api', 'kilo'],
  },
  // Standard health contract (Phase 2): every HTTP service answers GET
  // /health. The web app's health payload lives at /api/health; expose it
  // at the contract path too. See docs/HEALTH_CONTRACT.md.
  async rewrites() {
    return [{ source: '/health', destination: '/api/health' }]
  },
  webpack: (config, { isServer, webpack: wp }) => {
    // Allow require() of .ts files from .js files in the pages/ directory.
    // next dev resolves .ts extensions automatically, but next build's
    // webpack production config doesn't include .ts in resolve.extensions
    // for .js files. This ensures consistent module resolution across
    // both dev and production builds.
    if (!config.resolve.extensions.includes('.ts')) {
      config.resolve.extensions.push('.ts');
    }
    // instrumentation.ts is server-start only; replace with a no-op in the
    // browser graph so next dev never tries to bundle fs/child_process.
    if (!isServer) {
      const stub = path.join(__dirname, 'lib/runtime/instrumentation-stub.ts');
      config.plugins.push(
        new wp.NormalModuleReplacementPlugin(/[/\\]instrumentation\.ts$/, stub),
        new wp.IgnorePlugin({
          resourceRegExp: /[/\\]lib[/\\]runtime[/\\]provenance\.js$/,
        })
      );
    }
    return config;
  },
}

module.exports = nextConfig
