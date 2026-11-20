'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { MarketingShell } from '@/components/marketing-shell';
import { Button } from '@/components/ui/button';

export default function SignUpPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    agencyName: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? 'Registration failed');
      setLoading(false);
      return;
    }
    const signInResult = await signIn('credentials', {
      email: form.email,
      password: form.password,
      redirect: false,
    });
    setLoading(false);
    if (signInResult?.error) {
      setError('Account created but sign-in failed — try signing in.');
      return;
    }
    router.push('/onboarding');
  }

  return (
    <MarketingShell>
      <div className="mx-auto max-w-md px-4 py-16">
        <h1 className="text-2xl font-semibold">Create your workspace</h1>
        <form onSubmit={onSubmit} className="mt-8 space-y-4" aria-label="Sign up">
          {(['name', 'agencyName', 'email'] as const).map((field) => (
            <label key={field} className="block text-sm">
              <span className="font-medium capitalize">{field === 'agencyName' ? 'Agency name' : field}</span>
              <input
                required
                type={field === 'email' ? 'email' : 'text'}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
                value={form[field]}
                onChange={(e) => setForm((f) => ({ ...f, [field]: e.target.value }))}
              />
            </label>
          ))}
          <label className="block text-sm">
            <span className="font-medium">Password</span>
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-600 dark:bg-slate-900"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </label>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Creating…' : 'Create workspace'}
          </Button>
        </form>
        <p className="mt-4 text-sm">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-accent underline">
            Sign in
          </Link>
        </p>
      </div>
    </MarketingShell>
  );
}