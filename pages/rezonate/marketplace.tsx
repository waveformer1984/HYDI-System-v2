/**
 * pages/rezonate/marketplace.tsx
 * Browse and purchase published beats from all Rezonate producers.
 */
import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';

interface Beat {
  id: string;
  name: string;
  description: string | null;
  bpm: number | null;
  price_cents: number;
  license_type: string;
  public_slug: string;
  created_at: string;
}

const LICENSE_LABELS: Record<string, string> = {
  exclusive: 'Exclusive',
  non_exclusive: 'Non-Exclusive',
  free: 'Free',
};

function BeatCard({ beat }: { beat: Beat }) {
  const isFree = beat.price_cents === 0 || beat.license_type === 'free';
  return (
    <Link href={`/rezonate/beat/${beat.public_slug}`}
      className="group bg-gray-900 border border-gray-700 hover:border-violet-500 rounded-xl p-5 space-y-4 transition-colors cursor-pointer block">

      {/* Waveform preview (static decorative) */}
      <div className="w-full h-14 flex items-end gap-px">
        {Array.from({ length: 40 }, (_, i) => {
          // Deterministic heights seeded from beat name chars
          const seed = beat.name.charCodeAt(i % beat.name.length) + i;
          const h = 15 + ((seed * 37) % 70);
          return (
            <div key={i} className="flex-1 bg-violet-700 group-hover:bg-violet-500 rounded-sm transition-colors"
              style={{ height: `${h}%`, opacity: 0.6 + (i % 3) * 0.15 }} />
          );
        })}
      </div>

      <div>
        <h3 className="text-white font-semibold truncate">{beat.name}</h3>
        {beat.description && <p className="text-gray-400 text-xs mt-0.5 line-clamp-2">{beat.description}</p>}
      </div>

      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-3 text-gray-400 text-xs">
          {beat.bpm && <span>{beat.bpm} BPM</span>}
          <span>{LICENSE_LABELS[beat.license_type] ?? beat.license_type}</span>
        </div>
        <span className={`font-bold ${isFree ? 'text-emerald-400' : 'text-white'}`}>
          {isFree ? 'Free' : `$${(beat.price_cents / 100).toFixed(2)}`}
        </span>
      </div>
    </Link>
  );
}

export default function MarketplacePage() {
  const router = useRouter();
  const [beats, setBeats] = useState<Beat[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'free' | 'paid'>('all');

  useEffect(() => {
    fetch('/api/rezonate/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'list_projects' }),
    })
      .then(r => r.json())
      .then(j => {
        const published = (j.data ?? []).filter((p: Beat & { is_published?: boolean }) => p.is_published && p.public_slug);
        setBeats(published);
      })
      .catch(() => setBeats([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = beats.filter(b => {
    if (filter === 'free') return b.price_cents === 0 || b.license_type === 'free';
    if (filter === 'paid') return b.price_cents > 0 && b.license_type !== 'free';
    return true;
  });

  return (
    <>
      <Head><title>Marketplace — Rezonate</title></Head>
      <div className="min-h-screen bg-gray-950 text-white">
        <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/rezonate" className="text-gray-400 hover:text-white text-sm">← Rezonate</Link>
            <h1 className="text-lg font-bold">Marketplace</h1>
          </div>
          <Link href="/rezonate/beatbox"
            className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded-lg transition-colors">
            + Create Beat
          </Link>
        </header>

        <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
          {/* Filter tabs */}
          <div className="flex gap-2">
            {(['all', 'free', 'paid'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors capitalize
                  ${filter === f ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
                {f}
              </button>
            ))}
            <span className="ml-auto text-gray-500 text-sm self-center">{filtered.length} beat{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {loading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="bg-gray-900 border border-gray-800 rounded-xl p-5 animate-pulse space-y-3">
                  <div className="h-14 bg-gray-800 rounded" />
                  <div className="h-4 bg-gray-800 rounded w-2/3" />
                  <div className="h-3 bg-gray-800 rounded w-1/2" />
                </div>
              ))}
            </div>
          )}

          {!loading && filtered.length === 0 && (
            <div className="text-center py-20 space-y-4">
              <p className="text-gray-400">No beats here yet.</p>
              <Link href="/rezonate/beatbox"
                className="inline-block px-6 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm transition-colors">
                Be the first — create a beat
              </Link>
            </div>
          )}

          {!loading && filtered.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map(beat => <BeatCard key={beat.id} beat={beat} />)}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
