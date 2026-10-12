import * as SecureStore from 'expo-secure-store';

// SecureStore values should stay under ~2 KB; Supabase sessions can exceed
// that, so values are split across numbered keys.
const CHUNK = 1800;

export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    const n = await SecureStore.getItemAsync(`${key}.n`);
    if (!n) return null;
    let out = '';
    for (let i = 0; i < Number(n); i++) {
      const part = await SecureStore.getItemAsync(`${key}.${i}`);
      if (part === null) return null;
      out += part;
    }
    return out;
  },
  async setItem(key: string, value: string): Promise<void> {
    await this.removeItem(key);
    const parts = Math.ceil(value.length / CHUNK) || 1;
    for (let i = 0; i < parts; i++) await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${key}.n`, String(parts));
  },
  async removeItem(key: string): Promise<void> {
    const n = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? 0);
    for (let i = 0; i < n; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
    await SecureStore.deleteItemAsync(`${key}.n`);
  },
};
