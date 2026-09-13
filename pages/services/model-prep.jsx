// HEIDI Customer Job Intake Page
// Minimal functional UI for submitting a 3D model preparation request.
// "Functional ugly" is preferable to "beautiful unfinished."

import { useState } from 'react';

export default function JobIntakePage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [request, setRequest] = useState('');
  const [objectType, setObjectType] = useState('');
  const [width, setWidth] = useState(50);
  const [height, setHeight] = useState(50);
  const [depth, setDepth] = useState(10);
  const [thickness, setThickness] = useState(3);
  const [material, setMaterial] = useState('PLA');
  const [rushOrder, setRushOrder] = useState(false);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/revenue/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerEmail: email,
          customerName: name,
          product: 'protoforge_model_prep',
          requestText: request,
          requirements: {
            objectType,
            width: Number(width),
            height: Number(height),
            depth: Number(depth),
            thickness: Number(thickness),
            material,
            rushOrder,
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
      <h1 style={{ fontSize: '24px', marginBottom: '8px' }}>3D-Printable Model Preparation</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        $29.00 — Send us a description, get a print-ready STL + OpenSCAD source + documentation.
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

        <label style={labelStyle}>Describe what you want *</label>
        <textarea style={{ ...inputStyle, minHeight: '80px' }} value={request} onChange={e => setRequest(e.target.value)} required placeholder="e.g., 'A simple L-shaped bracket for mounting a shelf'" />

        <label style={labelStyle}>Object type (optional)</label>
        <select style={inputStyle} value={objectType} onChange={e => setObjectType(e.target.value)}>
          <option value="">Auto-detect</option>
          <option value="box">Box / Container</option>
          <option value="bracket">Bracket</option>
          <option value="cylinder">Cylinder / Ring</option>
          <option value="phone_stand">Phone Stand</option>
          <option value="key_holder">Key Holder / Keychain</option>
          <option value="stand">Stand / Holder</option>
        </select>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={labelStyle}>Width (mm)</label>
            <input type="number" style={inputStyle} value={width} onChange={e => setWidth(e.target.value)} min="1" max="200" />
          </div>
          <div>
            <label style={labelStyle}>Height (mm)</label>
            <input type="number" style={inputStyle} value={height} onChange={e => setHeight(e.target.value)} min="1" max="200" />
          </div>
          <div>
            <label style={labelStyle}>Depth (mm)</label>
            <input type="number" style={inputStyle} value={depth} onChange={e => setDepth(e.target.value)} min="1" max="200" />
          </div>
          <div>
            <label style={labelStyle}>Wall thickness (mm)</label>
            <input type="number" style={inputStyle} value={thickness} onChange={e => setThickness(e.target.value)} min="1" max="20" />
          </div>
        </div>

        <label style={labelStyle}>Material</label>
        <select style={inputStyle} value={material} onChange={e => setMaterial(e.target.value)}>
          <option value="PLA">PLA (recommended)</option>
          <option value="ABS">ABS</option>
          <option value="PETG">PETG</option>
          <option value="TPU">TPU (flexible)</option>
        </select>

        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input type="checkbox" checked={rushOrder} onChange={e => setRushOrder(e.target.checked)} />
          Rush order (+$10)
        </label>

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
          {loading ? 'Creating job...' : 'Submit & Pay $29.00'}
        </button>
      </form>

      <p style={{ fontSize: '12px', color: '#999', marginTop: '16px' }}>
        Powered by HEIDI + ProtoForge. Payment via Stripe. Artifacts reviewed by human before delivery.
      </p>
    </div>
  );
}
