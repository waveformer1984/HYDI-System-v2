import Link from 'next/link';

export default function OnboardingPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">Onboarding</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">
        Stage 1 shell — full agency profile capture (services, industries, locations, sender profile)
        continues in Stage 2. Default example location: Austin, Texas.
      </p>
      <Link href="/dashboard" className="mt-6 inline-block text-accent underline">
        Go to dashboard
      </Link>
    </div>
  );
}