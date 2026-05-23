import React, { useState, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { signIn, signUp } from '../../lib/rezonate/RezonateAuth';

type Mode = 'signin' | 'signup';

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'signup') {
        if (!username.trim() || !displayName.trim()) throw new Error('Username and display name required');
        if (!/^[a-z0-9_]{3,20}$/.test(username)) throw new Error('Username: 3-20 chars, lowercase letters, numbers, underscores only');
        await signUp(email, password, username.trim(), displayName.trim());
      } else {
        await signIn(email, password);
      }
      const redirect = (router.query.redirect as string) ?? '/rezonate';
      router.push(redirect);
    } catch (err) {
      setError((err as Error).message);
    }
    setLoading(false);
  }, [mode, email, password, username, displayName, router]);

  return (
    <>
      <Head><title>{mode === 'signin' ? 'Sign In' : 'Create Account'} — Rezonate</title></Head>
      <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center space-y-1">
            <Link href="/rezonate" className="text-violet-400 text-sm hover:text-violet-300">← Rezonate</Link>
            <h1 className="text-2xl font-bold">{mode === 'signin' ? 'Sign in' : 'Create account'}</h1>
          </div>

          {/* Mode toggle */}
          <div className="flex bg-gray-900 border border-gray-700 rounded-xl p-1">
            {(['signin', 'signup'] as Mode[]).map(m => (
              <button key={m} onClick={() => { setMode(m); setError(''); }}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition-colors
                  ${mode === m ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                {m === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Username</label>
                  <input value={username} onChange={e => setUsername(e.target.value.toLowerCase())}
                    placeholder="your_handle" required
                    className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
                </div>
                <div>
                  <label className="block text-gray-400 text-xs mb-1">Display Name</label>
                  <input value={displayName} onChange={e => setDisplayName(e.target.value)}
                    placeholder="Your Name" required
                    className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
                </div>
              </>
            )}
            <div>
              <label className="block text-gray-400 text-xs mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com" required
                className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
            </div>
            <div>
              <label className="block text-gray-400 text-xs mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••••" required minLength={6}
                className="w-full bg-gray-900 border border-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500" />
            </div>

            {error && <p className="text-red-400 text-xs">{error}</p>}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white rounded-lg font-semibold transition-colors">
              {loading ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
