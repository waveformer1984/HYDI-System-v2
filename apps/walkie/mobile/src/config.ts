import Constants from 'expo-constants';

type Extra = { apiUrl?: string; authMode?: string; supabaseUrl?: string; supabaseAnonKey?: string; iosPtt?: boolean; apnsEnvironment?: string };
const extra = (Constants.expoConfig?.extra ?? {}) as Extra;

/**
 * Build-time public configuration. Nothing secret lives here: the API URL,
 * the auth mode and the Supabase anon (publishable) key are all safe to ship.
 */
export const config = {
  apiUrl: (extra.apiUrl ?? '').replace(/\/$/, ''),
  authMode: (extra.authMode === 'dev' ? 'dev' : 'supabase') as 'dev' | 'supabase',
  supabaseUrl: extra.supabaseUrl ?? '',
  supabaseAnonKey: extra.supabaseAnonKey ?? '',
  /** Built with the PushToTalk entitlement (WALKIE_IOS_PTT=1). */
  iosPtt: extra.iosPtt === true,
  /** Which APNs environment this build's PTT tokens belong to. */
  apnsEnvironment: (extra.apnsEnvironment === 'production' ? 'production' : 'sandbox') as 'sandbox' | 'production',
};

export function configProblem(): string | null {
  if (!config.apiUrl) return 'EXPO_PUBLIC_WALKIE_API_URL was not set when this build was made.';
  if (config.authMode === 'supabase' && (!config.supabaseUrl || !config.supabaseAnonKey)) {
    return 'Supabase sign-in needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY at build time.';
  }
  return null;
}
