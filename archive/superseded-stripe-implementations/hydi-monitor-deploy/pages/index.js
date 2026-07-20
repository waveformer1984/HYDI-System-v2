import { useState } from 'react';

const TIERS = [
  {
    id: 'starter', name: 'Observer', price: '$29',
    desc: 'Solo devs and side projects.',
    features: ['1 Supabase project','Health dashboard','Email alerts on CRITICAL'],
  },
  {
    id: 'pro', name: 'Operator', price: '$99',
    desc: 'Full HYDI stack with auto-heal and Ursula.',
    features: ['3 projects','Trend analysis','Auto-heal','Escalation','Ursula AI','Slack alerts'],
    featured: true,
  },
  {
    id: 'enterprise', name: 'Command', price: '$299',
    desc: 'White-label HYDI for your clients.',
    features: ['Unlimited projects','White-label','Multi-tenant','API access','Priority support'],
  },
];

export default function Home() {
  const [loading, setLoading] = useState(null);
  const [email, setEmail]     = useState('');
  const [company, setCompany] = useState('');
  const [error, setError]     = useState('');

  async function handleCheckout(tierId) {
    setError('');
    if (!email) { setError('Enter your email first.'); return; }
    setLoading(tierId);
    try {
      const res  = await fetch('/api/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ tier: tierId, email, company }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else { setError(data.error || 'Checkout failed'); setLoading(null); }
    } catch (e) {
      setError(e.message);
      setLoading(null);
    }
  }

  return (
    <main style={{ fontFamily: 'monospace', background: '#09090b', color: '#fafafa', minHeight: '100vh', padding: '4rem 2rem' }}>
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '2.5rem', margin: 0 }}>
          HYDI<span style={{ color: '#00e5a0' }}>/</span>monitor
        </h1>
        <p style={{ color: '#71717a', marginTop: '0.5rem' }}>
          Production health monitoring for Supabase — by ProtoForge Industries
        </p>
      </div>

      <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginBottom: '2rem', flexWrap: 'wrap' }}>
        <input
          type="email" placeholder="your@email.com" value={email}
          onChange={e => setEmail(e.target.value)}
          style={{ padding: '0.65rem 1rem', background: '#18181b', border: '1px solid #333', borderRadius: 8, color: '#fff', fontFamily: 'monospace', minWidth: 240, fontSize: 13 }}
        />
        <input
          type="text" placeholder="Company (optional)" value={company}
          onChange={e => setCompany(e.target.value)}
          style={{ padding: '0.65rem 1rem', background: '#18181b', border: '1px solid #333', borderRadius: 8, color: '#fff', fontFamily: 'monospace', minWidth: 200, fontSize: 13 }}
        />
      </div>

      {error && <p style={{ textAlign: 'center', color: '#ef4444', fontSize: 13, marginBottom: '1rem' }}>{error}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem', maxWidth: 900, margin: '0 auto' }}>
        {TIERS.map(t => (
          <div key={t.id} style={{
            background: t.featured ? 'rgba(0,229,160,0.05)' : '#111113',
            border: `1px solid ${t.featured ? 'rgba(0,229,160,0.3)' : '#222'}`,
            borderRadius: 12, padding: '1.75rem',
          }}>
            {t.featured && <div style={{ fontSize: 10, color: '#00e5a0', marginBottom: 8, letterSpacing: '0.12em' }}>MOST POPULAR</div>}
            <div style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 4 }}>{t.name}</div>
            <div style={{ fontSize: '2rem', fontWeight: 500, color: '#00e5a0', marginBottom: 4 }}>
              {t.price}<span style={{ fontSize: '1rem', color: '#71717a' }}>/mo</span>
            </div>
            <div style={{ fontSize: 13, color: '#71717a', marginBottom: '1.25rem' }}>{t.desc}</div>
            <ul style={{ listStyle: 'none', padding: 0, marginBottom: '1.5rem' }}>
              {t.features.map(f => (
                <li key={f} style={{ fontSize: 13, color: '#a1a1aa', padding: '3px 0' }}>→ {f}</li>
              ))}
            </ul>
            <button
              onClick={() => handleCheckout(t.id)}
              disabled={!!loading}
              style={{
                width: '100%', padding: '0.7rem',
                background: t.featured ? '#00e5a0' : 'transparent',
                color: t.featured ? '#000' : '#fafafa',
                border: `1px solid ${t.featured ? '#00e5a0' : '#444'}`,
                borderRadius: 8, fontFamily: 'monospace', fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer', fontSize: 13,
                opacity: loading && loading !== t.id ? 0.5 : 1,
              }}
            >
              {loading === t.id ? 'Redirecting...' : 'Get started →'}
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
