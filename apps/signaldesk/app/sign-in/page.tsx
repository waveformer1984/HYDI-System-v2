import { Suspense } from 'react';
import { SignInForm } from './sign-in-form';

export default function SignInPage() {
  return (
    <Suspense fallback={<p className="p-8 text-center text-sm">Loading…</p>}>
      <SignInForm />
    </Suspense>
  );
}