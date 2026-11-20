import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-slate-200 dark:border-slate-700 bg-surface">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            SignalDesk
          </Link>
          <nav className="hidden items-center gap-6 text-sm md:flex" aria-label="Primary">
            <Link href="/features" className="hover:text-accent">
              Features
            </Link>
            <Link href="/pricing" className="hover:text-accent">
              Pricing
            </Link>
            <Link href="/sign-in" className="hover:text-accent">
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="rounded-md bg-accent px-3 py-1.5 text-accent-foreground hover:bg-blue-700"
            >
              Start free trial
            </Link>
          </nav>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-slate-200 dark:border-slate-700 py-8 text-center text-sm text-slate-600 dark:text-slate-400">
        <p>SignalDesk — Find the right businesses. Show the evidence. Win the next conversation.</p>
        <p className="mt-2">
          <Link href="/privacy" className="underline">
            Privacy
          </Link>
          {' · '}
          <Link href="/terms" className="underline">
            Terms
          </Link>
        </p>
      </footer>
    </div>
  );
}