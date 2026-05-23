/**
 * pages/rezonate/index.tsx
 *
 * Rezonate dashboard — project library and quick-action hub.
 *
 * Fetches projects client-side from POST /api/rezonate/route.js with
 * { action: 'list_projects' }. Renders a grid of ProjectCard components,
 * each linking to /rezonate/studio/[id]. Wraps the entire page in
 * AudioEngineProvider so sub-components have access to the shared audio engine.
 */

import React, { useEffect, useState, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { AudioEngineProvider } from '../../providers/rezonate/AudioEngineProvider';
import ProjectCard, { ProjectCardProps } from '../../components/rezonate/shared/ProjectCard';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Project extends ProjectCardProps {
  id: string;
}

type LoadState = 'idle' | 'loading' | 'success' | 'error';

// ── Skeleton card — shown while projects load ─────────────────────────────────

function SkeletonCard() {
  return (
    <div className="rounded-xl bg-gray-800 border border-gray-700 p-4 flex flex-col gap-3 animate-pulse">
      <div className="flex items-start justify-between gap-2">
        <div className="h-4 w-2/3 rounded bg-gray-700" />
        <div className="h-4 w-14 rounded-full bg-gray-700" />
      </div>
      <div className="flex items-center justify-between">
        <div className="h-3 w-20 rounded bg-gray-700" />
        <div className="h-3 w-16 rounded bg-gray-700" />
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

function RezonateDashboard() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  // ── Fetch project list ──────────────────────────────────────────────────────

  const fetchProjects = useCallback(async () => {
    setLoadState('loading');
    setErrorMsg('');
    try {
      const res = await fetch('/api/rezonate/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list_projects' }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      // API is expected to return { projects: Project[] } or an array directly.
      const list: Project[] = Array.isArray(data)
        ? data
        : Array.isArray(data.projects)
        ? data.projects
        : [];
      setProjects(list);
      setLoadState('success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load projects';
      setErrorMsg(msg);
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  // ── Create a new project ────────────────────────────────────────────────────

  const handleNewProject = useCallback(async () => {
    if (isCreating) return;
    setIsCreating(true);
    try {
      const res = await fetch('/api/rezonate/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_project' }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      const newId: string = data.id ?? data.project?.id;
      if (newId) {
        await router.push(`/rezonate/studio/${newId}`);
      } else {
        // Refresh the list if the ID is not returned (edge case)
        await fetchProjects();
      }
    } catch {
      // Silent failure — user can retry via the button
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, router, fetchProjects]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const isLoading = loadState === 'loading' || loadState === 'idle';

  return (
    <>
      <Head>
        <title>Rezonate</title>
      </Head>

      <div className="min-h-screen bg-gray-900 text-white">
        {/* ── Top bar ── */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-gray-800">
          <h1 className="text-xl font-bold tracking-tight text-white">Rezonate</h1>

          <div className="flex items-center gap-2">
            {/* Sample Library */}
            <Link
              href="/rezonate/library"
              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors"
            >
              Library
            </Link>

            {/* Beat Box quick link */}
            <Link
              href="/rezonate/beatbox"
              className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors"
            >
              Beat Box
            </Link>

            {/* New Project */}
            <button
              onClick={handleNewProject}
              disabled={isCreating}
              className="px-4 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isCreating && (
                <svg
                  className="animate-spin w-3.5 h-3.5"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
                  />
                </svg>
              )}
              New Project
            </button>
          </div>
        </div>

        {/* ── Main content ── */}
        <main className="px-6 py-8">
          {/* Error banner */}
          {loadState === 'error' && (
            <div className="mb-6 px-4 py-3 rounded-lg bg-red-900 border border-red-700 text-red-200 text-sm flex items-center justify-between">
              <span>{errorMsg}</span>
              <button
                onClick={fetchProjects}
                className="ml-4 underline text-red-300 hover:text-white text-xs"
              >
                Retry
              </button>
            </div>
          )}

          {/* Loading skeleton grid */}
          {isLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && loadState === 'success' && projects.length === 0 && (
            <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
              <p className="text-gray-400 text-base">No projects yet. Start with Beat Box.</p>
              <Link
                href="/rezonate/beatbox"
                className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-sm font-medium text-white transition-colors"
              >
                Open Beat Box
              </Link>
            </div>
          )}

          {/* Project grid */}
          {!isLoading && projects.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.map((project) => (
                <Link key={project.id} href={`/rezonate/studio/${project.id}`} passHref legacyBehavior>
                  {/* Wrapping Link as anchor so ProjectCard onClick is additive */}
                  <a className="block outline-none focus-visible:ring-2 focus-visible:ring-violet-400 rounded-xl">
                    <ProjectCard
                      id={project.id}
                      name={project.name}
                      status={project.status}
                      trackCount={project.trackCount}
                      updatedAt={project.updatedAt}
                    />
                  </a>
                </Link>
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

// ── Page export — wrapped in AudioEngineProvider ──────────────────────────────

export default function RezonatePage() {
  return (
    <AudioEngineProvider>
      <RezonateDashboard />
    </AudioEngineProvider>
  );
}
