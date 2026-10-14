import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';
import { secureStorage } from './secure-storage';
import { createApi } from './api';

/**
 * Sign-in. Production uses Supabase Auth email one-time codes (the same
 * Supabase project HYDI already runs). Development builds can use the
 * backend's dev sign-in instead, which the backend refuses in production.
 */
let supabase: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!supabase) {
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { storage: secureStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
  }
  return supabase;
}

const DEV_TOKEN_KEY = 'walkie.devToken';
/** Session signed by the walkie server: a guest from an invite QR, or the owner via a login QR. */
const SERVER_SESSION_KEY = 'walkie.serverSession';

async function serverSessionToken(): Promise<string | null> {
  const raw = await secureStorage.getItem(SERVER_SESSION_KEY);
  if (!raw) return null;
  try {
    const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: number };
    return Date.now() < expiresAt - 60_000 ? token : null;
  } catch {
    return null;
  }
}

async function saveServerSession(s: { token: string; expiresAt: number }, kind: 'guest' | 'owner') {
  await secureStorage.setItem(SERVER_SESSION_KEY, JSON.stringify({ token: s.token, expiresAt: s.expiresAt, kind }));
}

/** Owner sign-in QR: swaps the one-time ticket for a server session. */
export async function signInWithTicket(ticket: string): Promise<void> {
  const r = await createApi(async () => null).exchangeTicket(ticket);
  await saveServerSession(r.session, 'owner');
}

/** Invite QR without an account: join as a guest of that channel. */
export async function joinAsGuest(code: string, displayName: string) {
  const r = await createApi(async () => null).join(code, displayName);
  if (r.session) await saveServerSession(r.session, 'guest');
  return r.channel;
}

export async function getAccessToken(): Promise<string | null> {
  const server = await serverSessionToken();
  if (server) return server;
  if (config.authMode === 'dev') {
    const raw = await secureStorage.getItem(DEV_TOKEN_KEY);
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: number };
    return Date.now() < expiresAt - 60_000 ? token : null;
  }
  const { data } = await sb().auth.getSession();
  return data.session?.access_token ?? null;
}

export async function sendEmailCode(email: string): Promise<void> {
  const { error } = await sb().auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw new Error(error.message);
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const { error } = await sb().auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw new Error(error.message);
}

export async function devSignIn(handle: string): Promise<void> {
  const api = createApi(async () => null);
  const s = await api.devSession(handle);
  await secureStorage.setItem(DEV_TOKEN_KEY, JSON.stringify({ token: s.token, expiresAt: s.expiresAt }));
}

export async function signOut(): Promise<void> {
  await secureStorage.removeItem(SERVER_SESSION_KEY);
  if (config.authMode === 'dev') {
    await secureStorage.removeItem(DEV_TOKEN_KEY);
    return;
  }
  await sb().auth.signOut();
}
