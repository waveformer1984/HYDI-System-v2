import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function Success() {
  const router = useRouter();
  const [sessionData, setSessionData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { session_id } = router.query;
    
    if (session_id) {
      // In a real implementation, you'd fetch session details from Stripe
      // For now, we'll show a success message
      setSessionData({ session_id });
      setLoading(false);
    }
  }, [router.query]);

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%)',
      color: '#e0e0e0',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }}>
      <Head>
        <title>HYDI Subscription Successful | ProtoForge</title>
      </Head>

      <div style={{ 
        maxWidth: '600px', 
        textAlign: 'center', 
        padding: '2rem',
        background: 'rgba(26, 26, 62, 0.95)',
        border: '1px solid rgba(100, 255, 218, 0.3)',
        borderRadius: '12px'
      }}>
        {loading ? (
          <div>
            <div style={{ 
              width: '40px', 
              height: '40px', 
              border: '3px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '50%',
              borderTopColor: '#64ffda',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 2rem'
            }}></div>
            <h2 style={{ color: '#64ffda', marginBottom: '1rem' }}>Processing Your Subscription...</h2>
            <p style={{ color: '#8892b0' }}>Please wait while we set up your HYDI monitoring.</p>
          </div>
        ) : (
          <div>
            <div style={{ 
              fontSize: '4rem', 
              color: '#4caf50', 
              marginBottom: '1rem' 
            }}>
              ✅
            </div>
            
            <h1 style={{ 
              color: '#64ffda', 
              marginBottom: '1rem',
              fontSize: '2rem'
            }}>
              Welcome to HYDI!
            </h1>
            
            <p style={{ 
              color: '#8892b0', 
              marginBottom: '2rem',
              lineHeight: 1.6
            }}>
              Your subscription has been successfully activated. You'll receive an email shortly 
              with your HYDI API token and setup instructions.
            </p>

            <div style={{ 
              background: 'rgba(15, 15, 35, 0.8)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              padding: '1.5rem',
              marginBottom: '2rem',
              textAlign: 'left'
            }}>
              <h3 style={{ color: '#64ffda', marginBottom: '1rem' }}>Next Steps:</h3>
              <ol style={{ color: '#e0e0e0', paddingLeft: '1.5rem' }}>
                <li style={{ marginBottom: '0.5rem' }}>Check your email for your HYDI API token</li>
                <li style={{ marginBottom: '0.5rem' }}>Install the HYDI CLI: <code style={{ background: 'rgba(100, 255, 218, 0.1)', padding: '2px 6px', borderRadius: '3px' }}>npm install -g hydi-health-check</code></li>
                <li style={{ marginBottom: '0.5rem' }}>Initialize monitoring: <code style={{ background: 'rgba(100, 255, 218, 0.1)', padding: '2px 6px', borderRadius: '3px' }}>hydi init --token YOUR_TOKEN</code></li>
                <li>Configure your Supabase project URL and start monitoring</li>
              </ol>
            </div>

            <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
              <button
                onClick={() => window.open('https://hydi.protoforgeindustries.com', '_blank')}
                style={{
                  padding: '1rem 2rem',
                  background: 'rgba(100, 255, 218, 0.2)',
                  border: '1px solid rgba(100, 255, 218, 0.3)',
                  color: '#64ffda',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: 'bold',
                  transition: 'all 0.3s ease'
                }}
              >
                View Dashboard
              </button>
              
              <button
                onClick={() => window.location.href = '/'}
                style={{
                  padding: '1rem 2rem',
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.2)',
                  color: '#e0e0e0',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  transition: 'all 0.3s ease'
                }}
              >
                Back to Home
              </button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
