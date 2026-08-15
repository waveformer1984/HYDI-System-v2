/** @type {import('next').NextConfig} */
const path = require('path')

const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname),
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'local-anon-key',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'local-anon-key',
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'local-anon-key',
    ENABLE_LOCAL_MODEL: process.env.ENABLE_LOCAL_MODEL || 'true',
    LOCAL_MODEL_URL: process.env.LOCAL_MODEL_URL || 'http://localhost:11434',
    LOCAL_MODEL_NAME: process.env.LOCAL_MODEL_NAME || 'llama3.2:3b',
    EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER || 'ollama',
    OLLAMA_EMBEDDING_MODEL: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
    STRIPE_MODE: process.env.STRIPE_MODE || 'mock',
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
}

module.exports = nextConfig
