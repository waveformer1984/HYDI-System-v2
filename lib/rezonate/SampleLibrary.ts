/**
 * SampleLibrary — client for browsing and loading samples from the
 * rezonate_sample_library table. Fetches metadata from Supabase REST,
 * downloads blobs on demand, and caches decoded AudioBuffers via SampleStore.
 */

export interface LibrarySample {
  id: string;
  name: string;
  category: 'drum' | 'melody' | 'bass' | 'vocal' | 'fx' | 'loop' | 'full_track';
  tags: string[];
  audio_url: string;
  duration_ms: number | null;
  bpm: number | null;
  key: string | null;
  is_user_sample: boolean;
  user_id: string | null;
  created_at: string;
}

export interface LibrarySearchParams {
  category?: string;
  tags?: string[];
  bpm_min?: number;
  bpm_max?: number;
  key?: string;
  is_user_sample?: boolean;
  limit?: number;
  offset?: number;
}

export class SampleLibrary {
  private readonly _supabaseUrl: string;
  private readonly _anonKey: string;
  private _cache = new Map<string, LibrarySample[]>();

  constructor(supabaseUrl: string, anonKey: string) {
    this._supabaseUrl = supabaseUrl;
    this._anonKey = anonKey;
  }

  async search(params: LibrarySearchParams = {}): Promise<LibrarySample[]> {
    const cacheKey = JSON.stringify(params);
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey)!;

    const url = new URL(`${this._supabaseUrl}/rest/v1/rezonate_sample_library`);
    url.searchParams.set('select', '*');
    url.searchParams.set('order', 'created_at.desc');
    url.searchParams.set('limit', String(params.limit ?? 50));
    url.searchParams.set('offset', String(params.offset ?? 0));

    if (params.category) url.searchParams.set('category', `eq.${params.category}`);
    if (params.is_user_sample !== undefined) url.searchParams.set('is_user_sample', `eq.${params.is_user_sample}`);
    if (params.bpm_min != null) url.searchParams.set('bpm', `gte.${params.bpm_min}`);
    if (params.bpm_max != null) url.searchParams.append('bpm', `lte.${params.bpm_max}`);

    const res = await fetch(url.toString(), {
      headers: {
        apikey: this._anonKey,
        Authorization: `Bearer ${this._anonKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) throw new Error(`SampleLibrary.search failed: ${res.status}`);
    const data: LibrarySample[] = await res.json();
    this._cache.set(cacheKey, data);
    return data;
  }

  async fetchBlob(audioUrl: string): Promise<Blob> {
    const res = await fetch(audioUrl);
    if (!res.ok) throw new Error(`SampleLibrary.fetchBlob failed: ${res.status}`);
    return res.blob();
  }

  clearCache(): void {
    this._cache.clear();
  }
}
