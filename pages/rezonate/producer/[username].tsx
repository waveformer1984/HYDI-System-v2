import React from 'react';
import { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';

interface Beat {
  id: string;
  name: string;
  public_slug: string;
  price_cents: number;
  bpm: number | null;
}

interface ProducerPageProps {
  producer: { id: string; username: string; display_name: string; bio: string | null; created_at: string };
  beats: Beat[];
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { username } = ctx.params as { username: string };
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: producer } = await sb.from('rezonate_producers').select('*').eq('username', username).single();
    if (!producer) return { notFound: true };
    const { data: beats } = await sb
      .from('rezonate_projects')
      .select('id, name, public_slug, price_cents, bpm')
      .eq('producer_id', producer.id)
      .eq('is_published', true)
      .order('created_at', { ascending: false });
    return { props: { producer, beats: beats ?? [] } };
  } catch {
    return { notFound: true };
  }
};

export default function ProducerPage({ producer, beats }: ProducerPageProps) {
  return (
    <>
      <Head>
        <title>{producer.display_name} (@{producer.username}) — Rezonate</title>
        <meta name="description" content={producer.bio ?? `${producer.display_name}'s beats on Rezonate`} />
      </Head>
      <div className="min-h-screen bg-gray-950 text-white">
        <header className="border-b border-gray-800 px-6 py-4">
          <Link href="/rezonate/marketplace" className="text-gray-400 hover:text-white text-sm">← Marketplace</Link>
        </header>
        <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
          {/* Profile header */}
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-full bg-violet-700 flex items-center justify-center text-2xl font-bold flex-shrink-0">
              {producer.display_name[0].toUpperCase()}
            </div>
            <div>
              <h1 className="text-2xl font-bold">{producer.display_name}</h1>
              <p className="text-gray-400 text-sm">@{producer.username}</p>
              {producer.bio && <p className="text-gray-300 text-sm mt-1">{producer.bio}</p>}
            </div>
          </div>

          {/* Beats */}
          <div>
            <h2 className="text-white font-semibold mb-4">Beats ({beats.length})</h2>
            {beats.length === 0 && <p className="text-gray-500 text-sm">No published beats yet.</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {beats.map(beat => (
                <Link key={beat.id} href={`/rezonate/beat/${beat.public_slug}`}
                  className="bg-gray-900 border border-gray-700 hover:border-violet-500 rounded-xl p-4 transition-colors block space-y-2">
                  <p className="text-white font-medium truncate">{beat.name}</p>
                  <div className="flex items-center justify-between text-sm">
                    {beat.bpm && <span className="text-gray-400 text-xs">{beat.bpm} BPM</span>}
                    <span className="font-semibold">
                      {beat.price_cents === 0 ? <span className="text-emerald-400">Free</span> : `$${(beat.price_cents / 100).toFixed(2)}`}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
