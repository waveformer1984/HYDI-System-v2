// HEIDI Customer Job Intake Page — Checkpoint Workflow Audit
// Minimal functional UI for submitting a workflow audit request.
// "Functional ugly" is preferable to "beautiful unfinished."

import { useState } from 'react';

export default function CheckpointAuditIntakePage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [workflowName, setWorkflowName] = useState('');
  const [steps, setSteps] = useState('');
  const [context, setContext] = useState('');

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    const stepList = steps
      .split('\n')
      .map((s) => s.replace(/^\s*[-*\d.]+\s*/, '').trim())
      .filter(Boolean);

    if (stepList.length < 2) {
      setLoading(false);
      setError('Please list at least 2 workflow steps — the audit needs a real process to analyze.');
      return;
    }

    try {
      const res = await fetch('/api/revenue/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerEmail: email,
          customerName: name,
          product: 'checkpoint_audit',
          requestText: `Workflow: ${workflowName || 'Customer workflow'}\n\n${steps}${context ? `\n\nContext: ${context}` : ''}`,
          requirements: {
            workflowName: workflowName || undefined,
            steps: stepList,
          },
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Failed to create job');
      } else {
        setResult(data);
        if (data.checkoutUrl) {
          // Redirect to Stripe Checkout
          window.location.href = data.checkoutUrl;
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    width: '100%',
    padding: '8px',
    margin: '4px 0 12px',
    border: '1px solid #ccc',
    borderRadius: '4px',
    fontSize: '14px',
    boxSizing: 'border-box',
  };

  const labelStyle = {
    fontSize: '14px',
    fontWeight: 'bold',
    display: 'block',
  };

  return (
    <div style={{ maxWidth: '600px', margin: '40px auto', padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>Checkpoint Workflow Audit</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        $49.00 — Describe your workflow, get a risk audit: per-step risk scores, detected failure points, checkpoint recommendations, and a prioritized summary.
      </p>

      {error && (
        <div style={{ background: '#fee', color: '#c33', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>
          {error}
        </div>
      )}

      {result && !result.checkoutUrl && (
        <div style={{ background: '#efe', color: '#363', padding: '12px', borderRadius: '4px', marginBottom: '16px' }}>
          Job created: {result.jobId} — {result.message || 'Awaiting payment'}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <label style={labelStyle}>Email *</label>
        <input type="email" style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@example.com" />

        <label style={labelStyle}>Name</label>
        <input type="text" style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />

        <label style={labelStyle}>Workflow name *</label>
        <input type="text" style={inputStyle} value={workflowName} onChange={e => setWorkflowName(e.target.value)} required placeholder="e.g., 'Solar panel installation'" />

        <label style={labelStyle}>Workflow steps * — one step per line</label>
        <textarea
          style={{ ...inputStyle, minHeight: '140px' }}
          value={steps}
          onChange={e => setSteps(e.target.value)}
          required
          placeholder={'Site survey and measurements\nElectrical panel inspection\nMount racking hardware\nWire panels to inverter\nInspection and sign-off\nSystem activation'}
        />

        <label style={labelStyle}>Anything else we should know? (optional)</label>
        <textarea style={{ ...inputStyle, minHeight: '60px' }} value={context} onChange={e => setContext(e.target.value)} placeholder="Team size, how often this runs, past failures, regulatory requirements..." />

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '12px',
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            fontSize: '16px',
            fontWeight: 'bold',
            cursor: loading ? 'not-allowed' : 'pointer',
            marginTop: '16px',
          }}
        >
          {loading ? 'Creating job...' : 'Submit & Pay $49.00'}
        </button>
      </form>

      <div style={{ marginTop: '32px', borderTop: '1px solid #ddd', paddingTop: '16px', fontSize: '13px', color: '#555' }}>
        <h2 style={{ fontSize: '15px', marginBottom: '8px' }}>Common questions</h2>
        <p><strong>What do I get?</strong> A workflow audit report: per-step risk scores, detected failure points with severity and mitigation, checkpoint recommendations, and a prioritized risk summary — delivered as a readable report plus machine-readable data.</p>
        <p><strong>What kinds of workflows?</strong> Operational processes you can describe step-by-step — installations, approvals, handoffs, inspections, fulfillment. The analysis is strongest on concrete, sequential processes.</p>
        <p><strong>How fast?</strong> The audit is generated automatically and typically completes within minutes of payment. A human reviews the report before delivery.</p>
        <p><strong>What if the audit fails?</strong> You&apos;re refunded. A failed audit is never charged through silently.</p>
        <p><strong>Where is my order?</strong> You&apos;ll get a status link after checkout — it shows live progress from payment through delivery.</p>
      </div>

      <p style={{ fontSize: '12px', color: '#999', marginTop: '16px' }}>
        Powered by HEIDI + ProtoForge. Payment via Stripe. Findings are produced by a deterministic workflow engine, reviewed by a human before delivery.
      </p>
    </div>
  );
}
