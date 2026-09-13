// Stripe Checkout success page
// Customer lands here after successful payment.
// Shows job status and next steps.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

export default function JobSuccessPage() {
  const router = useRouter();
  const { session_id, jobId } = router.query;
  const [job, setJob] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!jobId) return;
    fetch(`/api/revenue/jobs/${jobId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error);
        else setJob(data.job);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [jobId]);

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '24px', color: '#16a34a' }}>Payment Received</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        Your job has been accepted and is being processed.
      </p>

      {loading && <p>Loading job status...</p>}
      {error && <div style={{ color: '#c33' }}>{error}</div>}

      {job && (
        <div style={{ background: '#f9fafb', padding: '20px', borderRadius: '8px', border: '1px solid #e5e7eb' }}>
          <p><strong>Job ID:</strong> {job.jobId}</p>
          <p><strong>Product:</strong> {job.product}</p>
          <p><strong>Price:</strong> ${(job.priceCents / 100).toFixed(2)} {job.currency.toUpperCase()}</p>
          <p><strong>Payment:</strong> {job.paymentStatus}</p>
          <p><strong>Status:</strong> {job.jobStatus}</p>
          <p><strong>Submitted:</strong> {new Date(job.createdAt).toLocaleString()}</p>
        </div>
      )}

      <div style={{ marginTop: '24px', padding: '16px', background: '#fef3c7', borderRadius: '8px', border: '1px solid #fde68a' }}>
        <p style={{ margin: 0, fontSize: '14px', color: '#92400e' }}>
          <strong>What happens next?</strong>
        </p>
        <ol style={{ margin: '8px 0 0 20px', fontSize: '14px', color: '#92400e' }}>
          <li>HEIDI generates your 3D model package</li>
          <li>A human operator reviews the artifacts</li>
          <li>You receive a delivery link to download your files</li>
          <li>Typical turnaround: under 5 minutes + review time</li>
        </ol>
      </div>

      <p style={{ marginTop: '24px', fontSize: '14px' }}>
        <a href={`/services/model-prep/status?jobId=${jobId}`} style={{ color: '#2563eb' }}>
          Check job status →
        </a>
      </p>
      <p style={{ fontSize: '12px', color: '#999' }}>
        Save your Job ID: {jobId}
      </p>
    </div>
  );
}
