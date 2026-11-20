import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;

if (!connectionString && process.env.NODE_ENV !== 'test') {
  console.warn('[signaldesk] DATABASE_URL is not set');
}

const queryClient = connectionString
  ? postgres(connectionString, { max: 10, prepare: false })
  : (null as unknown as ReturnType<typeof postgres>);

export const db = queryClient ? drizzle(queryClient, { schema }) : null;

export type Db = NonNullable<typeof db>;

export function requireDb(): Db {
  if (!db) {
    throw new Error('Database is not configured (DATABASE_URL)');
  }
  return db;
}

/** Set session variables for RLS-aware queries (defense in depth). */
export async function withWorkspaceContext<T>(
  userId: string,
  workspaceId: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!queryClient) {
    return fn();
  }
  await queryClient`SELECT set_config('app.current_user_id', ${userId}, true)`;
  await queryClient`SELECT set_config('app.current_workspace_id', ${workspaceId}, true)`;
  try {
    return await fn();
  } finally {
    await queryClient`SELECT set_config('app.current_user_id', '', true)`;
    await queryClient`SELECT set_config('app.current_workspace_id', '', true)`;
  }
}