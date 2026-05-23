'use client';
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { getUser, signOut, onAuthStateChange } from '../../lib/rezonate/RezonateAuth';
import type { User } from '@supabase/supabase-js';

export function UserMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getUser().then(setUser);
    const { data: { subscription } } = onAuthStateChange((u) => setUser(u));
    return () => subscription.unsubscribe();
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!user) {
    return (
      <Link href="/rezonate/auth"
        className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm text-white font-medium transition-colors">
        Sign In
      </Link>
    );
  }

  const initial = (user.email ?? 'U')[0].toUpperCase();
  const username = user.user_metadata?.username as string | undefined;

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-full bg-violet-600 text-white text-sm font-bold flex items-center justify-center hover:bg-violet-500 transition-colors">
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-48 bg-gray-900 border border-gray-700 rounded-xl shadow-xl py-1 z-50">
          <div className="px-3 py-2 border-b border-gray-700">
            <p className="text-white text-xs font-medium truncate">{user.email}</p>
            {username && <p className="text-gray-400 text-xs">@{username}</p>}
          </div>
          {username && (
            <Link href={`/rezonate/producer/${username}`}
              onClick={() => setOpen(false)}
              className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-gray-800 text-sm transition-colors">
              My Profile
            </Link>
          )}
          <Link href="/rezonate/dashboard"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-gray-800 text-sm transition-colors">
            My Dashboard
          </Link>
          <button onClick={async () => { await signOut(); setOpen(false); window.location.reload(); }}
            className="w-full text-left px-3 py-2 text-red-400 hover:text-red-300 hover:bg-gray-800 text-sm transition-colors">
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
}
