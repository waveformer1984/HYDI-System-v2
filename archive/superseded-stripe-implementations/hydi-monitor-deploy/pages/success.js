import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export default function Success() {
  const router = useRouter();
  const { session_id } = router.query;
  const [token, setToken] = useState('hyd_live_........');

  useEffect(() => {
    if (session_id) {
      setToken('hyd_live_' + session_id.slice(-8).toUpperCase());
    }
  }, [session_id]);

  return (
    <main style={{ fontFamily: 'monospace', background: '#09090b', color: '#fafafa', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ textAlign: 'center', maxWidth: 500 }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✅</div>
        <h1 style={{ fontSize: '1.8rem', marginBottom: '1rem' }}>HYDI Activated</h1>
        <p style={{ color: '#71717a', marginBottom: '2rem', lineHeight: 1.6 }}>
          Your HYDI monitoring is now active. Use your API token to connect your Supabase projects:
        </p>
        
        <div style={{ 
          background: '#111113', 
          border: '1px solid #333', 
          borderRadius: 8, 
          padding: '1rem', 
          marginBottom: '2rem',
          fontFamily: 'monospace',
          fontSize: 14
        }}>
          <div style={{ color: '#71717a', fontSize: 12, marginBottom: '0.5rem' }}>YOUR API TOKEN</div>
          <div style={{ color: '#00e5a0', fontWeight: 600, wordBreak: 'break-all' }}>{token}</div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            onClick={() => window.open('https://ursula-nine.vercel.app', '_blank')}
            style={{
              padding: '0.7rem 1.5rem',
              background: '#00e5a0',
              color: '#000',
              border: 'none',
              borderRadius: 8,
              fontFamily: 'monospace',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            Open Dashboard →
          </button>
          <button
            onClick={() => window.location.href = '/'}
            style={{
              padding: '0.7rem 1.5rem',
              background: 'transparent',
              color: '#fafafa',
              border: '1px solid #444',
              borderRadius: 8,
              fontFamily: 'monospace',
              fontWeight: 600,
              cursor: 'pointer',
              fontSize: 13
            }}
          >
            ← Back
          </button>
        </div>
      </div>
    </main>
  );
}
