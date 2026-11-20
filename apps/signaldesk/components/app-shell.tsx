import Link from 'next/link';
import type { ReactNode } from 'react';
import { ThemeToggle } from '@/components/theme-toggle';

const nav = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/discover', label: 'Discover' },
  { href: '/research', label: 'Research jobs' },
  { href: '/leads', label: 'Leads' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/outreach', label: 'Outreach drafts' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/settings', label: 'Settings' },
  { href: '/billing', label: 'Billing' },
];

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside
        className="hidden w-56 shrink-0 border-r border-slate-200 bg-surface p-4 dark:border-slate-700 md:block"
        aria-label="App navigation"
      >
        <Link href="/dashboard" className="mb-6 block text-lg font-semibold">
          SignalDesk
        </Link>
        <ul className="space-y-1 text-sm">
          {nav.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block rounded-md px-2 py-1.5 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-slate-800"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700 md:hidden">
          <Link href="/dashboard" className="font-semibold">
            SignalDesk
          </Link>
          <ThemeToggle />
        </header>
        <div className="hidden justify-end border-b border-slate-200 px-6 py-2 dark:border-slate-700 md:flex">
          <ThemeToggle />
        </div>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}