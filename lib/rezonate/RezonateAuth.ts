import { createClient, SupabaseClient, User, Session } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return _client;
}

export interface ProducerProfile {
  id: string;
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  created_at: string;
}

export async function signUp(email: string, password: string, username: string, displayName: string) {
  const sb = getSupabaseClient();
  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { username, display_name: displayName } },
  });
  if (error) throw error;
  // Create producer profile row
  if (data.user) {
    await sb.from('rezonate_producers').upsert({
      id: data.user.id,
      username,
      display_name: displayName,
    });
  }
  return data;
}

export async function signIn(email: string, password: string) {
  const sb = getSupabaseClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  return getSupabaseClient().auth.signOut();
}

export async function getUser(): Promise<User | null> {
  const { data } = await getSupabaseClient().auth.getUser();
  return data.user ?? null;
}

export async function getProducerByUsername(username: string): Promise<ProducerProfile | null> {
  const { data } = await getSupabaseClient()
    .from('rezonate_producers')
    .select('*')
    .eq('username', username)
    .single();
  return data ?? null;
}

export async function getProducerById(id: string): Promise<ProducerProfile | null> {
  const { data } = await getSupabaseClient()
    .from('rezonate_producers')
    .select('*')
    .eq('id', id)
    .single();
  return data ?? null;
}

export function onAuthStateChange(callback: (user: User | null, session: Session | null) => void) {
  return getSupabaseClient().auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null, session);
  });
}
