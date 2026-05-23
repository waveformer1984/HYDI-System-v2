import React from 'react';
import Head from 'next/head';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { AudioEngineProvider } from '../../providers/rezonate/AudioEngineProvider';

const SampleLibrary = dynamic(
  () => import('../../components/rezonate/studio/SampleLibrary').then(m => m.SampleLibrary),
  { ssr: false }
);

export default function LibraryPage() {
  return (
    <>
      <Head><title>Sample Library — Rezonate</title></Head>
      <div className="min-h-screen bg-gray-950 text-white">
        <header className="border-b border-gray-800 px-6 py-4 flex items-center gap-4">
          <Link href="/rezonate" className="text-gray-400 hover:text-white text-sm">← Rezonate</Link>
          <h1 className="text-lg font-bold">Sample Library</h1>
        </header>
        <AudioEngineProvider>
          <main className="max-w-3xl mx-auto p-6">
            <SampleLibrary />
            <p className="mt-6 text-gray-500 text-sm text-center">
              Upload your own samples via the studio pad recorder — they appear here automatically.
            </p>
          </main>
        </AudioEngineProvider>
      </div>
    </>
  );
}
