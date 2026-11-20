import { MarketingShell } from '@/components/marketing-shell';

export default function TermsPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-semibold">Terms of service (draft)</h1>
        <p className="mt-4 text-amber-700 dark:text-amber-400">
          Draft for owner/legal review — not legal advice or certified compliance.
        </p>
        <p className="mt-4 text-slate-700 dark:text-slate-300">
          SignalDesk is subscription software for agencies. It does not guarantee customers, meetings, or
          revenue outcomes. Outreach features require human review; automated sending remains disabled in the
          MVP.
        </p>
      </article>
    </MarketingShell>
  );
}