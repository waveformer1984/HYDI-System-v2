import { MarketingShell } from '@/components/marketing-shell';

export default function FeaturesPage() {
  return (
    <MarketingShell>
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-3xl font-semibold">Features</h1>
        <ul className="mt-8 list-disc space-y-3 pl-5 text-slate-700 dark:text-slate-300">
          <li>Workspace-scoped lead pipeline with evidence-backed opportunity briefs (Stages 4–5).</li>
          <li>Licensed provider adapters plus unmistakable fictional demo data — never blended.</li>
          <li>Secure website observation with SSRF controls and honest limitation wording.</li>
          <li>Stripe test-mode subscriptions with server-enforced research credits (Stage 3).</li>
          <li>Local Ollama for drafts; cloud models behind an adapter, off by default.</li>
          <li>Outreach review queue — no autonomous bulk sending in the MVP.</li>
        </ul>
      </div>
    </MarketingShell>
  );
}