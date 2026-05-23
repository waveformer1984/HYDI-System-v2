/**
 * pages/rezonate/marketplace.tsx
 *
 * Rezonate Marketplace — coming soon placeholder.
 *
 * Static page with no API calls and no AudioEngineProvider. Shows a 2×2 grid
 * of feature preview cards (Sample Library, Project Templates, Plugin Store,
 * Tutorial Content), each with an inline SVG icon, title, short description,
 * and a "Notify Me" button that shows a transient toast on click.
 */

import React, { useState, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastState {
  message: string;
}

// ── Feature card data ─────────────────────────────────────────────────────────

interface FeatureItem {
  id: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

function SampleLibraryIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-8 h-8 text-violet-400"
      aria-hidden="true"
    >
      {/* Stacked discs / library symbol */}
      <path d="M12 3C7.03 3 3 5.24 3 8s4.03 5 9 5 9-2.24 9-5-4.03-5-9-5zm0 2c3.87 0 7 1.57 7 3s-3.13 3-7 3-7-1.57-7-3 3.13-3 7-3zm-9 7v2c0 2.76 4.03 5 9 5s9-2.24 9-5v-2c0 2.76-4.03 5-9 5s-9-2.24-9-5zm0 4v2c0 2.76 4.03 5 9 5s9-2.24 9-5v-2c0 2.76-4.03 5-9 5s-9-2.24-9-5z" />
    </svg>
  );
}

function TemplatesIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-8 h-8 text-emerald-400"
      aria-hidden="true"
    >
      {/* Document with lines (template) */}
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zM6 4h7l5 5v11H6V4zm2 8h8v2H8v-2zm0 4h5v2H8v-2z" />
    </svg>
  );
}

function PluginStoreIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-8 h-8 text-sky-400"
      aria-hidden="true"
    >
      {/* Plug / connector symbol */}
      <path d="M16 7V3h-2v4H10V3H8v4a4 4 0 0 0 3 3.87V13a5 5 0 0 1-5 5v2h12v-2a5 5 0 0 1-5-5v-2.13A4 4 0 0 0 16 7z" />
    </svg>
  );
}

function TutorialIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="w-8 h-8 text-amber-400"
      aria-hidden="true"
    >
      {/* Play circle — tutorial / video */}
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-5.5l6-4-6-4v8z" />
    </svg>
  );
}

const FEATURES: FeatureItem[] = [
  {
    id: 'sample-library',
    title: 'Sample Library',
    description:
      'Browse thousands of royalty-free drum loops, one-shots, and melodic phrases curated for beat makers.',
    icon: <SampleLibraryIcon />,
  },
  {
    id: 'project-templates',
    title: 'Project Templates',
    description:
      'Start fast with genre-specific project templates pre-loaded with BPM, key, and pad assignments.',
    icon: <TemplatesIcon />,
  },
  {
    id: 'plugin-store',
    title: 'Plugin Store',
    description:
      'Extend Rezonate with community-built effects, synths, and MIDI utilities — one-click install.',
    icon: <PluginStoreIcon />,
  },
  {
    id: 'tutorial-content',
    title: 'Tutorial Content',
    description:
      'Step-by-step video lessons from producers covering beat construction, mixing, and collaboration.',
    icon: <TutorialIcon />,
  },
];

// ── Feature card ──────────────────────────────────────────────────────────────

interface FeatureCardProps {
  item: FeatureItem;
  onNotify: (id: string) => void;
}

function FeatureCard({ item, onNotify }: FeatureCardProps) {
  return (
    <div className="flex flex-col gap-4 p-6 rounded-2xl bg-gray-800 border border-gray-700 hover:border-gray-600 transition-colors">
      {/* Icon */}
      <div className="w-14 h-14 rounded-xl bg-gray-900 flex items-center justify-center">
        {item.icon}
      </div>

      {/* Title + description */}
      <div className="flex flex-col gap-1.5">
        <h3 className="text-base font-semibold text-white">{item.title}</h3>
        <p className="text-sm text-gray-400 leading-relaxed">{item.description}</p>
      </div>

      {/* Notify Me button */}
      <div className="mt-auto pt-2">
        <button
          onClick={() => onNotify(item.id)}
          className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-violet-700 text-xs font-medium text-gray-300 hover:text-white transition-colors"
        >
          Notify Me
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MarketplacePage() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const handleNotify = useCallback((_id: string) => {
    setToast({ message: "You're on the list" });
    setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <>
      <Head>
        <title>Marketplace — Rezonate</title>
      </Head>

      <div className="min-h-screen bg-gray-900 text-white">
        {/* ── Top bar ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <Link
            href="/rezonate"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← Rezonate
          </Link>
          {/* Spacer */}
          <div className="w-20" />
        </div>

        {/* ── Hero section ── */}
        <div className="px-6 pt-12 pb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
            Rezonate Marketplace
          </h1>
          <p className="text-sm font-semibold text-violet-400 uppercase tracking-widest">
            Coming in Phase 3
          </p>
          <p className="mt-4 text-gray-400 text-base max-w-md mx-auto leading-relaxed">
            A curated hub for sounds, templates, plugins, and learning — built for
            creators on the Rezonate platform.
          </p>
        </div>

        {/* ── Feature preview grid — 2 col on desktop, 1 col on mobile ── */}
        <main className="px-6 pb-16">
          <div className="max-w-3xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-5">
            {FEATURES.map((item) => (
              <FeatureCard key={item.id} item={item} onNotify={handleNotify} />
            ))}
          </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div
          role="alert"
          className={[
            'fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg z-50',
            'bg-green-700 text-green-100 text-sm font-medium shadow-lg',
            'pointer-events-none',
          ].join(' ')}
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
