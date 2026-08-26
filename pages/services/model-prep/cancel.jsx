// Stripe Checkout cancel page
// Customer lands here if they cancel the checkout.

import Link from 'next/link';
import { useRouter } from 'next/router';

export default function JobCancelPage() {
  const router = useRouter();
  const { jobId } = router.query;

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '24px', color: '#dc2626' }}>Payment Cancelled</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        Your payment was cancelled. No charge was made.
      </p>

      {jobId && (
        <div style={{ background: '#f9fafb', padding: '16px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <p><strong>Job ID:</strong> {jobId}</p>
          <p style={{ fontSize: '14px', color: '#666' }}>
            Your job record still exists but will not be processed until payment is completed.
          </p>
        </div>
      )}

      <p style={{ marginTop: '24px' }}>
        <Link href="/services/model-prep" style={{ color: '#2563eb' }}>← Try again</Link>
      </p>
    </div>
  );
}
