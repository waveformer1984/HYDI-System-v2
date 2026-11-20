import Link from 'next/link';
import { MarketingShell } from '@/components/marketing-shell';

const plans = [
  { name: 'Starter', price: '$49', seats: '1 seat', credits: '100 research credits / month' },
  { name: 'Studio', price: '$129', seats: '3 seats', credits: '400 research credits / month' },
  { name: 'Agency', price: '$299', seats: '10 seats', credits: '1,200 research credits / month' },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-5xl px-4 py-16">
        <h1 className="text-3xl font-semibold">Pricing</h1>
        <p className="mt-2 text-slate-600 dark:text-slate-300">
          One research credit = one completed research run per business (including refresh). Failed runs
          release reservations; retries of the same run do not double-charge.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {plans.map((p) => (
            <article key={p.name} className="rounded-lg border border-slate-200 bg-surface p-6 dark:border-slate-700">
              <h2 className="text-xl font-medium">{p.name}</h2>
              <p className="mt-2 text-3xl font-semibold">{p.price}</p>
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-400">{p.seats}</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">{p.credits}</p>
            </article>
          ))}
        </div>
        <p className="mt-8 text-sm text-slate-500">
          Checkout uses Stripe-hosted pages with server-approved price IDs — not browser-supplied prices.
        </p>
        <Link href="/sign-up" className="mt-4 inline-block text-accent underline">
          Start with a workspace
        </Link>
      </div>
    </MarketingShell>
  );
}