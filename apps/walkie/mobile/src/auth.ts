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

export async function getAccessToken(): Promise<string | null> {
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
  if (config.authMode === 'dev') {
    await secureStorage.removeItem(DEV_TOKEN_KEY);
    return;
  }
  await sb().auth.signOut();
}
