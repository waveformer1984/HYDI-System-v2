import { MarketingShell } from '@/components/marketing-shell';

export default function PrivacyPage() {
  return (
    <MarketingShell>
      <article className="mx-auto max-w-3xl px-4 py-16 prose prose-slate dark:prose-invert">
        <h1>Privacy policy (draft)</h1>
        <p className="text-amber-700 dark:text-amber-400 font-medium">
          Draft for owner/legal review — not legal advice.
        </p>
        <p>
          SignalDesk minimizes stored contact data, scopes records to workspaces, and supports export and
          deletion requests (workflows in Stage 6). Production retention periods require owner sign-off.
        </p>
      </article>
    </MarketingShell>
  );
}