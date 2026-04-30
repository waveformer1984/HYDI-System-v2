import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// Track initialization state
let supabase: SupabaseClient | null = null
let pg: any = null

/**
 * Validate required environment variables
 * Fail fast - no mercy, no silent failures
 */
function validateEnvironment(): void {
  const requiredEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY']
  
  const missing = requiredEnv.filter((key) => !process.env[key])
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}\n` +
      `System cannot start without these. Check your .env file.`
    )
  }
}

/**
 * Initialize Supabase client ONCE
 * No multiple instances, no scattered createClient() calls
 */
function initializeSupabase(): SupabaseClient {
  if (supabase) {
    return supabase
  }

  validateEnvironment()

  supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!
  )

  return supabase
}

/**
 * Initialize Postgres pool ONLY if DATABASE_URL is provided
 * This is optional - prevents accidental dual-write chaos
 */
async function initializePostgres(): Promise<any> {
  if (pg) {
    return pg
  }

  if (!process.env.DATABASE_URL) {
    return null
  }

  try {
    const { Pool } = await import('pg')
    pg = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    })

    // Test connection
    const client = await pg.connect()
    await client.query('SELECT 1')
    client.release()

    return pg
  } catch (error) {
    console.error('Postgres initialization failed:', error)
    pg = null
    return null
  }
}

/**
 * Bootstrap the entire system
 * Single entry point that forces the system to agree on what exists
 */
export async function bootstrap(): Promise<{
  supabase: SupabaseClient
  pg: any
}> {
  const supabaseClient = initializeSupabase()
  const pgPool = await initializePostgres()

  return {
    supabase: supabaseClient,
    pg: pgPool,
  }
}

/**
 * Synchronous bootstrap for cases where you need immediate access
 * Use this when you can't await (e.g., module-level exports)
 */
export function bootstrapSync(): {
  supabase: SupabaseClient
  pg: null
} {
  const supabaseClient = initializeSupabase()

  return {
    supabase: supabaseClient,
    pg: null, // Postgres must be initialized async
  }
}

// Initialize immediately on module load
const { supabase: initializedSupabase } = bootstrapSync()

/**
 * Single runtime object - the source of truth
 * Everything else in the system imports from here
 * No exceptions
 */
export const runtime = {
  get supabase() {
    if (!supabase) {
      throw new Error('Bootstrap not initialized. Call bootstrap() or bootstrapSync() first.')
    }
    return supabase
  },
  get pg() {
    return pg
  },
}

// Also export the initialized client directly for convenience
export { initializedSupabase as supabase }
