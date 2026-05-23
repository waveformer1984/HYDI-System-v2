import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { getUser, getSupabaseClient } from '../../lib/rezonate/RezonateAuth';

interface MyBeat {
  id: string;
  name: string;
  is_published: boolean;
  public_slug: string | null;
  price_cents: number;
  license_type: string;
  created_at: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [beats, setBeats] = useState<MyBeat[]>([]);
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    getUser().then(user => {
      if (!user) { router.push('/rezonate/auth?redirect=/rezonate/dashboard'); return; }
      setUserEmail(user.email ?? '');
      // Fetch beats owned by this producer
      getSupabaseClient()
        .from('rezonate_projects')
        .select('id, name, is_published, public_slug, price_cents, license_type, created_at')
        .eq('producer_id', user.id)
        .order('created_at', { ascending: false })
        .then(({ data }) => { setBeats(data ?? []); setLoading(false); });
    });
  }, [router]);

  return (
    <>
      <Head><title>My Dashboard — Rezonate</title></Head>
      <div className="min-h-screen bg-gray-950 text-white">
        <header className="border-b border-gray-800 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/rezonate" className="text-gray-400 hover:text-white text-sm">← Rezonate</Link>
            <h1 className="text-lg font-bold">My Dashboard</h1>
          </div>
          <span className="text-gray-400 text-sm">{userEmail}</span>
        </header>
        <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-white font-semibold">My Beats ({beats.length})</h2>
            <Link href="/rezonate/beatbox"
              className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded-lg transition-colors">
              + New Beat
            </Link>
          </div>

          {loading && <p className="text-gray-500 text-sm">Loading…</p>}
          {!loading && beats.length === 0 && (
            <div className="text-center py-16 text-gray-500">
              <p>No beats yet.</p>
              <Link href="/rezonate/beatbox" className="mt-3 inline-block text-violet-400 hover:text-violet-300 text-sm">
                Create your first beat →
              </Link>
            </div>
          )}
          {!loading && beats.length > 0 && (
            <div className="divide-y divide-gray-800">
              {beats.map(beat => (
                <div key={beat.id} className="py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-white font-medium truncate">{beat.name}</p>
                    <p className="text-gray-400 text-xs mt-0.5">
                      {new Date(beat.created_at).toLocaleDateString()} ·{' '}
                      {beat.is_published ? (
                        <span className="text-emerald-400">Published</span>
                      ) : (
                        <span className="text-gray-500">Draft</span>
                      )}
                      {beat.price_cents > 0 && ` · $${(beat.price_cents / 100).toFixed(2)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {beat.is_published && beat.public_slug && (
                      <Link href={`/rezonate/beat/${beat.public_slug}`}
                        className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded text-xs transition-colors">
                        View
                      </Link>
                    )}
                    <Link href={`/rezonate/studio/${beat.id}`}
                      className="px-2 py-1 bg-violet-800 hover:bg-violet-700 text-white rounded text-xs transition-colors">
                      Studio
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}
