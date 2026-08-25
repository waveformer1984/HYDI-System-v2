// Customer-safe job status page
// Shows job progress without exposing internal details.
// Customer accesses via jobId (from the success page or saved link).

import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

// Map internal job status to customer-safe display
function getCustomerStatus(job) {
  if (!job) return null;

  const statusMap = {
    created: { label: 'Awaiting Payment', color: '#f59e0b', description: 'Complete your payment to start processing.' },
    queued: { label: 'Job Accepted', color: '#3b82f6', description: 'Payment received. Your job is in the queue.' },
    executing: { label: 'HEIDI Processing', color: '#3b82f6', description: 'HEIDI is generating your 3D model package.' },
    awaiting_review: { label: 'Human Review Required', color: '#f59e0b', description: 'Artifacts generated. A human operator is reviewing them.' },
    delivered: { label: 'Ready for Download', color: '#16a34a', description: 'Your files are ready! Click the delivery link below.' },
    failed: { label: 'Processing Failed', color: '#dc2626', description: 'Something went wrong. You will receive a refund if applicable.' },
    cancelled: { label: 'Cancelled', color: '#6b7280', description: 'This job was cancelled.' },
    refunded: { label: 'Refunded', color: '#6b7280', description: 'Payment has been refunded.' },
  };

  return statusMap[job.jobStatus] || { label: job.jobStatus, color: '#6b7280', description: '' };
}

export default function JobStatusPage() {
  const router = useRouter();
  const { jobId } = router.query;
  const [job, setJob] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deliveryInfo, setDeliveryInfo] = useState(null);

  const fetchJob = () => {
    if (!jobId) return;
    fetch(`/api/revenue/jobs/${jobId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) setError(data.error);
        else {
          setJob(data.job);
          setEvents(data.events || []);
          // If delivered, fetch delivery info
          if (data.job?.deliveryStatus === 'delivered' && data.job?.deliveryToken) {
            fetch(`/api/revenue/jobs/${jobId}/delivery?token=${data.job.deliveryToken}`)
              .then(r => r.json())
              .then(d => setDeliveryInfo(d))
              .catch(() => {});
          }
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchJob();
    // Poll every 10 seconds while job is in progress
    const interval = setInterval(() => {
      if (job && (job.jobStatus === 'queued' || job.jobStatus === 'executing' || job.jobStatus === 'awaiting_review')) {
        fetchJob();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [jobId]);

  const customerStatus = getCustomerStatus(job);

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>Job Status</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        Track your 3D model preparation job.
      </p>

      {loading && <p>Loading...</p>}
      {error && <div style={{ color: '#c33', padding: '12px', background: '#fee', borderRadius: '4px' }}>{error}</div>}

      {job && customerStatus && (
        <>
          {/* Status banner */}
          <div style={{
            padding: '20px',
            borderRadius: '8px',
            background: customerStatus.color + '15',
            border: `2px solid ${customerStatus.color}`,
            marginBottom: '24px',
          }}>
            <h2 style={{ margin: '0 0 8px 0', color: customerStatus.color, fontSize: '20px' }}>
              {customerStatus.label}
            </h2>
            <p style={{ margin: 0, color: '#666', fontSize: '14px' }}>
              {customerStatus.description}
            </p>
          </div>

          {/* Job details (safe to show) */}
          <div style={{ background: '#f9fafb', padding: '16px', borderRadius: '8px', marginBottom: '24px' }}>
            <p><strong>Job ID:</strong> {job.jobId}</p>
            <p><strong>Product:</strong> 3D-Printable Model Preparation</p>
            <p><strong>Price:</strong> ${(job.priceCents / 100).toFixed(2)} {job.currency.toUpperCase()}</p>
            <p><strong>Payment:</strong> {job.paymentStatus === 'paid' ? 'Paid' : job.paymentStatus}</p>
            <p><strong>Submitted:</strong> {new Date(job.createdAt).toLocaleString()}</p>
          </div>

          {/* Progress timeline (customer-safe) */}
          <div style={{ marginBottom: '24px' }}>
            <h3 style={{ fontSize: '16px', marginBottom: '12px' }}>Progress</h3>
            {events
              .filter(e => !e.event_type.includes('intervention') && !e.actor?.includes('internal'))
              .map((e, i) => {
                const labelMap = {
                  job_created: 'Job submitted',
                  checkout_session_created: 'Checkout started',
                  payment_confirmed: 'Payment confirmed',
                  execution_started: 'HEIDI started processing',
                  execution_completed: 'Artifacts generated',
                  delivery_approved: 'Approved for delivery',
                  execution_failed: 'Processing failed',
                  job_cancelled: 'Job cancelled',
                  job_refunded: 'Refund processed',
                };
                const label = labelMap[e.event_type] || e.event_type;
                return (
                  <div key={i} style={{ display: 'flex', gap: '12px', marginBottom: '8px', fontSize: '14px' }}>
                    <span style={{ color: '#16a34a' }}>✓</span>
                    <span>{label}</span>
                    <span style={{ color: '#999', marginLeft: 'auto' }}>
                      {new Date(e.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                );
              })}
          </div>

          {/* Delivery section */}
          {deliveryInfo && deliveryInfo.artifacts && (
            <div style={{ padding: '20px', background: '#dcfce7', borderRadius: '8px', marginBottom: '24px' }}>
              <h3 style={{ margin: '0 0 12px 0', color: '#16a34a' }}>Your Files Are Ready</h3>
              {deliveryInfo.artifacts.map((a, i) => (
                <div key={i} style={{ marginBottom: '8px' }}>
                  <a
                    href={a.downloadUrl}
                    style={{ color: '#2563eb', textDecoration: 'underline', fontSize: '14px' }}
                  >
                    Download {a.filename}
                  </a>
                  <span style={{ color: '#999', fontSize: '12px', marginLeft: '8px' }}>
                    ({(a.sizeBytes / 1024).toFixed(1)} KB)
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <p style={{ fontSize: '14px' }}>
        <a href="/services/model-prep" style={{ color: '#2563eb' }}>← Submit another job</a>
      </p>
    </div>
  );
}
