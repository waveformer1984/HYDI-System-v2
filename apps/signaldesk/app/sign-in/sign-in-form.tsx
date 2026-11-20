'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { MarketingShell } from '@/components/marketing-shell';
import { Button } from '@/components/ui/button';

export function SignInForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('callbackUrl') ?? '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const result = await signIn('credentials', {
      email,
      password,
      redirect: false,
    });
    setLoading(false);
    if (result?.error) {
      setError('Invalid email or password');
      return;
    }
    router.push(callbackUrl);
  }

  return (
    <MarketingShell>
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <form onSubmit={onSubmit} className="mt-8 space-y-4" aria-label="Sign in">
          <label className="block text-sm">
            <span className="font-medium">Email</span>
            <input
              type="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="font-medium">Password</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-sm">
          No account?{' '}
          <Link href="/sign-up" className="text-accent underline">
            Create a workspace
          </Link>
        </p>
      </div>
    </MarketingShell>
  );
}