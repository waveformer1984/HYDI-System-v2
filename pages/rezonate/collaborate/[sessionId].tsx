/**
 * pages/rezonate/collaborate/[sessionId].tsx
 *
 * Real-time collaboration page for a Rezonate session.
 *
 * URL param: sessionId from router.query.sessionId
 *
 * Flow:
 *   1. Fetch session data from GET /api/rezonate/collaborate?session_id=[id]
 *   2. If not joined, show a "Join Session" form (display name + nanoid user_id)
 *   3. After joining via POST /api/rezonate/collaborate, show the full session UI:
 *      - SessionPresence top bar
 *      - BeatBoxCapture (dynamic, ssr: false) as the main pad surface
 *      - ContributionTimeline as a right sidebar (desktop) / bottom panel (mobile)
 *   4. "Leave" button calls leave_session and redirects to /rezonate
 *
 * Wrapped in AudioEngineProvider.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { AudioEngineProvider } from '../../../providers/rezonate/AudioEngineProvider';
import SessionPresence, { Peer } from '../../../components/rezonate/collaboration/SessionPresence';
import ContributionTimeline, {
  Contribution,
  SplitConfig,
} from '../../../components/rezonate/collaboration/ContributionTimeline';

// ── Dynamic import — BeatBoxCapture uses Web Audio API (browser only) ─────────

const BeatBoxCapture = dynamic(
  () => import('../../../components/rezonate/BeatBoxCapture'),
  { ssr: false }
);

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionData {
  sessionId: string;
  sessionName?: string;
  peers: Peer[];
  contributions: Contribution[];
  splitConfig?: SplitConfig[];
  totalRevenue?: number;
}

type PageState = 'loading' | 'join' | 'session' | 'error';

// ── nanoid-lite — generates a URL-safe random ID without a package import ─────

function nanoid(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const arr = typeof crypto !== 'undefined' && crypto.getRandomValues
    ? crypto.getRandomValues(new Uint8Array(21))
    : Array.from({ length: 21 }, () => Math.floor(Math.random() * 62));
  return Array.from(arr).map((n) => chars[n % chars.length]).join('');
}

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastState {
  message: string;
  type: 'success' | 'error';
}

// ── Main component ────────────────────────────────────────────────────────────

function CollaborateSession() {
  const router = useRouter();
  const { sessionId } = router.query;
  const sid = typeof sessionId === 'string' ? sessionId : '';

  const [pageState, setPageState] = useState<PageState>('loading');
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Join form state
  const [displayName, setDisplayName] = useState('');
  const [isJoining, setIsJoining] = useState(false);
  const userIdRef = useRef<string>(nanoid());

  // My identity after joining
  const [myUserId, setMyUserId] = useState('');

  const [toast, setToast] = useState<ToastState | null>(null);

  // ── Toast helper ──────────────────────────────────────────────────────────

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Fetch session data ────────────────────────────────────────────────────

  const fetchSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/rezonate/collaborate?session_id=${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data: SessionData = await res.json();
      setSessionData(data);
      return data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load session';
      setErrorMsg(msg);
      setPageState('error');
      return null;
    }
  }, []);

  useEffect(() => {
    if (!sid) return;
    fetchSession(sid).then((data) => {
      if (data) {
        // Not yet joined — show join form
        setPageState('join');
      }
    });
  }, [sid, fetchSession]);

  // ── Join session ──────────────────────────────────────────────────────────

  const handleJoin = useCallback(async () => {
    if (!displayName.trim() || !sid || isJoining) return;
    setIsJoining(true);
    const userId = userIdRef.current;
    try {
      const res = await fetch('/api/rezonate/collaborate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'join_session',
          session_id: sid,
          user_id: userId,
          display_name: displayName.trim(),
        }),
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      // Re-fetch session to get the updated peer list
      const updated = await fetchSession(sid);
      if (updated) {
        setMyUserId(userId);
        setPageState('session');
        showToast('Joined session!', 'success');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to join session';
      showToast(msg, 'error');
    } finally {
      setIsJoining(false);
    }
  }, [displayName, sid, isJoining, fetchSession, showToast]);

  // ── Leave session ─────────────────────────────────────────────────────────

  const handleLeave = useCallback(async () => {
    if (!sid || !myUserId) {
      await router.push('/rezonate');
      return;
    }
    try {
      await fetch('/api/rezonate/collaborate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'leave_session',
          session_id: sid,
          user_id: myUserId,
        }),
      });
    } catch {
      // Non-fatal — navigate away regardless
    }
    await router.push('/rezonate');
  }, [sid, myUserId, router]);

  // ── Render: loading ───────────────────────────────────────────────────────

  if (pageState === 'loading') {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-gray-400">
          <svg
            className="animate-spin w-8 h-8 text-violet-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
          </svg>
          <p className="text-sm">Loading session…</p>
        </div>
      </div>
    );
  }

  // ── Render: error ─────────────────────────────────────────────────────────

  if (pageState === 'error') {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center gap-6 text-center px-6">
        <p className="text-red-400 text-base">{errorMsg || 'Session not found.'}</p>
        <Link
          href="/rezonate"
          className="px-5 py-2.5 rounded-xl bg-gray-700 hover:bg-gray-600 text-sm text-white transition-colors"
        >
          ← Back to Rezonate
        </Link>
      </div>
    );
  }

  // ── Render: join form ─────────────────────────────────────────────────────

  if (pageState === 'join') {
    return (
      <div className="min-h-screen bg-gray-900 flex flex-col items-center justify-center px-6 gap-8">
        <div className="w-full max-w-sm flex flex-col gap-6">
          {/* Session name */}
          <div className="text-center">
            <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">Join session</p>
            <h1 className="text-xl font-bold text-white">
              {sessionData?.sessionName ?? sid}
            </h1>
          </div>

          {/* Display name input */}
          <div className="flex flex-col gap-2">
            <label htmlFor="display-name" className="text-sm text-gray-300 font-medium">
              Your display name
            </label>
            <input
              id="display-name"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
              placeholder="e.g. DJ Nova"
              maxLength={50}
              className={[
                'w-full px-4 py-3 rounded-xl bg-gray-800 border border-gray-700',
                'text-white placeholder-gray-500 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent',
                'transition-colors',
              ].join(' ')}
            />
          </div>

          {/* Join button */}
          <button
            onClick={handleJoin}
            disabled={!displayName.trim() || isJoining}
            className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isJoining && (
              <svg
                className="animate-spin w-4 h-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z" />
              </svg>
            )}
            {isJoining ? 'Joining…' : 'Join Session'}
          </button>

          <Link
            href="/rezonate"
            className="text-center text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            ← Back to Rezonate
          </Link>
        </div>

        {/* Toast */}
        {toast && (
          <div
            role="alert"
            className={[
              'fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg',
              'text-sm font-medium shadow-lg',
              toast.type === 'success' ? 'bg-green-700 text-green-100' : 'bg-red-800 text-red-100',
            ].join(' ')}
          >
            {toast.message}
          </div>
        )}
      </div>
    );
  }

  // ── Render: full session UI ───────────────────────────────────────────────

  const peers: Peer[] = (sessionData?.peers ?? []).map((p) => ({
    ...p,
    isMe: p.userId === myUserId,
  }));

  return (
    <div className="min-h-screen bg-gray-900 flex flex-col">
      {/* Presence top bar */}
      <SessionPresence
        peers={peers}
        sessionName={sessionData?.sessionName}
        isConnected={true}
      />

      {/* Leave button row */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
        <Link
          href="/rezonate"
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
        >
          ← Rezonate
        </Link>
        <button
          onClick={handleLeave}
          className="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-red-700 text-xs text-gray-300 hover:text-white transition-colors"
        >
          Leave
        </button>
      </div>

      {/* ── Desktop: side-by-side layout; mobile: stacked ── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Beat pads — main area */}
        <main className="flex-1 overflow-y-auto">
          <BeatBoxCapture projectId={sid} />
        </main>

        {/* Contribution timeline — right sidebar on desktop, bottom panel on mobile */}
        <aside className="lg:w-80 lg:border-l lg:border-gray-800 border-t border-gray-800 lg:border-t-0 overflow-y-auto bg-gray-900 p-4">
          <ContributionTimeline
            contributions={sessionData?.contributions ?? []}
            splitConfig={sessionData?.splitConfig}
            totalRevenue={sessionData?.totalRevenue}
          />
        </aside>
      </div>

      {/* Toast */}
      {toast && (
        <div
          role="alert"
          className={[
            'fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 rounded-lg z-50',
            'text-sm font-medium shadow-lg',
            toast.type === 'success' ? 'bg-green-700 text-green-100' : 'bg-red-800 text-red-100',
          ].join(' ')}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ── Page export — wrapped in AudioEngineProvider ──────────────────────────────

export default function CollaboratePage() {
  return (
    <>
      <Head>
        <title>Collaborate — Rezonate</title>
      </Head>
      <AudioEngineProvider>
        <CollaborateSession />
      </AudioEngineProvider>
    </>
  );
}
