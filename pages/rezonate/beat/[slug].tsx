import React, { useState, useRef, useCallback } from 'react';
import { GetServerSideProps } from 'next';
import Head from 'next/head';
import Link from 'next/link';

interface BeatPageProps {
  project: {
    id: string;
    name: string;
    description: string | null;
    bpm: number | null;
    public_slug: string;
    price_cents: number;
    license_type: string;
    created_at: string;
  };
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { slug } = ctx.params as { slug: string };
  const base = process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:3000`;
  try {
    const res = await fetch(`${base}/api/rezonate/publish?slug=${encodeURIComponent(slug)}`);
    if (!res.ok) return { notFound: true };
    const { data } = await res.json();
    return { props: { project: data } };
  } catch {
    return { notFound: true };
  }
};

function formatPrice(cents: number, licenseType: string): string {
  if (cents === 0 || licenseType === 'free') return 'Free';
  return `$${(cents / 100).toFixed(2)} — ${licenseType === 'exclusive' ? 'Exclusive' : 'Non-Exclusive License'}`;
}

export default function BeatPage({ project }: BeatPageProps) {
  const [buying, setBuying] = useState(false);
  const [shareMsg, setShareMsg] = useState('');

  const handleBuy = useCallback(async () => {
    if (project.price_cents === 0 || project.license_type === 'free') return;
    setBuying(true);
    try {
      const res = await fetch('/api/rezonate/marketplace-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: project.id, license_type: project.license_type }),
      });
      const { checkout_url, error } = await res.json();
      if (checkout_url) window.location.href = checkout_url;
      else console.error('Checkout error:', error);
    } catch {}
    setBuying(false);
  }, [project]);

  const handleShare = useCallback(() => {
    navigator.clipboard?.writeText(window.location.href);
    setShareMsg('Link copied!');
    setTimeout(() => setShareMsg(''), 2000);
  }, []);

  const isFree = project.price_cents === 0 || project.license_type === 'free';

  return (
    <>
      <Head>
        <title>{project.name} — Rezonate</title>
        <meta name="description" content={project.description ?? `Beat by Rezonate producer — ${project.bpm ?? '?'} BPM`} />
        <meta property="og:title" content={project.name} />
        <meta property="og:description" content={formatPrice(project.price_cents, project.license_type)} />
      </Head>

      <div className="min-h-screen bg-gray-950 text-white flex flex-col">
        <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
          <Link href="/rezonate/marketplace" className="text-gray-400 hover:text-white text-sm">← Marketplace</Link>
        </header>

        <main className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-md space-y-8">
            {/* Beat card */}
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-8 space-y-6">
              {/* Waveform placeholder */}
              <div className="w-full h-20 bg-gray-800 rounded-xl flex items-center justify-center">
                <div className="w-full h-10 mx-4 flex items-end gap-0.5">
                  {Array.from({ length: 48 }, (_, i) => (
                    <div key={i} className="flex-1 bg-violet-600 rounded-sm opacity-70"
                      style={{ height: `${20 + Math.sin(i * 0.4) * 15 + Math.random() * 20}%` }} />
                  ))}
                </div>
              </div>

              <div>
                <h1 className="text-2xl font-bold">{project.name}</h1>
                {project.description && <p className="text-gray-400 mt-1 text-sm">{project.description}</p>}
              </div>

              <div className="flex items-center gap-4 text-sm text-gray-400">
                {project.bpm && <span>{project.bpm} BPM</span>}
                <span className="capitalize">{project.license_type.replace('_', ' ')}</span>
              </div>

              {/* Price + CTA */}
              <div className="space-y-3">
                <p className="text-xl font-semibold">
                  {isFree ? 'Free Download' : `$${(project.price_cents / 100).toFixed(2)}`}
                </p>
                {!isFree && (
                  <p className="text-gray-400 text-xs">
                    {project.license_type === 'exclusive' ? 'Full exclusive rights transferred on purchase.' : 'Non-exclusive license — producer retains rights.'}
                  </p>
                )}

                <button
                  onClick={isFree ? handleShare : handleBuy}
                  disabled={buying}
                  className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-xl font-semibold transition-colors"
                >
                  {buying ? 'Redirecting to checkout…' : isFree ? 'Share / Download' : 'Buy License'}
                </button>

                <button onClick={handleShare}
                  className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-sm transition-colors">
                  {shareMsg || 'Copy share link'}
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </>
  );
}
