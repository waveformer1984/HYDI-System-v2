import Link from 'next/link';
import { MarketingShell } from '@/components/marketing-shell';

export default function LandingPage() {
  return (
    <MarketingShell>
      <section className="mx-auto max-w-6xl px-4 py-16 md:py-24">
        <p className="text-sm font-medium text-accent">For web-design & marketing agencies</p>
        <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
          Find the right businesses. Show the evidence. Win the next conversation.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
          SignalDesk helps your team discover relevant US prospects, verify website opportunities with
          cited observations, and prepare human-reviewed outreach — without promising guaranteed meetings
          or buying intent.
        </p>
        <div className="mt-8 flex flex-wrap gap-4">
          <Link
            href="/sign-up"
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-accent-foreground hover:bg-blue-700"
          >
            Create workspace
          </Link>
          <Link
            href="/features"
            className="rounded-md border border-slate-300 px-5 py-2.5 text-sm font-medium dark:border-slate-600"
          >
            See how it works
          </Link>
        </div>
        <p className="mt-8 text-sm text-slate-500">
          Example market: Austin, Texas (editable in onboarding). Provider integrations and live research
          ship in later stages — demo data is clearly labeled.
        </p>
      </section>
    </MarketingShell>
  );
}