/** @type {import('next').NextConfig} */
const path = require('path')

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
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
  webpack: (config, { isServer }) => {
    // Allow require() of .ts files from .js files in the pages/ directory.
    // next dev resolves .ts extensions automatically, but next build's
    // webpack production config doesn't include .ts in resolve.extensions
    // for .js files. This ensures consistent module resolution across
    // both dev and production builds.
    if (!config.resolve.extensions.includes('.ts')) {
      config.resolve.extensions.push('.ts');
    }
    return config;
  },
}

module.exports = nextConfig
