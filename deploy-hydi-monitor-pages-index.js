import { useState } from 'react';
import Head from 'next/head';

export default function Home() {
  const [selectedTier, setSelectedTier] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    company: ''
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const tiers = {
    starter: {
      name: 'Starter',
      price: '$99',
      description: 'Basic Supabase health monitoring — dashboard + email alerts on CRITICAL',
      features: ['Health check monitoring', 'Dashboard access', 'Email alerts on CRITICAL issues', '15-minute check intervals']
    },
    pro: {
      name: 'Pro',
      price: '$199',
      description: 'Full HYDI — trends, auto-heal, escalation, Ursula agent, Slack alerts',
      features: ['Everything in Starter', 'Health trend analysis', 'Auto-heal capabilities', 'Escalation management', 'Ursula agent integration', 'Slack alerts', '5-minute check intervals'],
      featured: true
    },
    enterprise: {
      name: 'Enterprise',
      price: '$299',
      description: 'White-label, API access, unlimited projects — resell HYDI to your clients',
      features: ['Everything in Pro', 'White-label options', 'Full API access', 'Unlimited projects', 'Priority support', 'Custom integrations', 'Reseller rights']
    }
  };

  const openSignup = (tier) => {
    setSelectedTier(tier);
    setShowModal(true);
    setMessage('');
  };

  const closeModal = () => {
    setShowModal(false);
    setFormData({ email: '', company: '' });
    setMessage('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tier: selectedTier,
          email: formData.email,
          company: formData.company
        })
      });

      const data = await response.json();

      if (response.ok) {
        setMessage('Redirecting to Stripe checkout...');
        window.location.href = data.url;
      } else {
        setMessage(data.error || 'Failed to create checkout session');
      }
    } catch (error) {
      setMessage('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #0f0f23 0%, #1a1a3e 100%)',
      color: '#e0e0e0',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }}>
      <Head>
        <title>HYDI - Supabase Health Monitoring | ProtoForge</title>
        <meta name="description" content="Supabase health monitoring with auto-healing — trend analysis, escalation, and dashboard" />
      </Head>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
        <header style={{ textAlign: 'center', marginBottom: '4rem' }}>
          <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#64ffda', marginBottom: '1rem' }}>HYDI</div>
          <div style={{ fontSize: '1.2rem', color: '#8892b0', marginBottom: '2rem' }}>
            Supabase Health Monitoring & Auto-Healing
          </div>
        </header>

        <main>
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', 
            gap: '2rem', 
            marginBottom: '3rem' 
          }}>
            {Object.entries(tiers).map(([tierKey, tier]) => (
              <div
                key={tierKey}
                style={{
                  background: 'rgba(26, 26, 62, 0.95)',
                  border: tier.featured ? '1px solid #64ffda' : '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '12px',
                  padding: '2rem',
                  position: 'relative',
                  transition: 'transform 0.3s ease, box-shadow 0.3s ease',
                  boxShadow: tier.featured ? '0 0 20px rgba(100, 255, 218, 0.3)' : 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-5px)';
                  e.currentTarget.style.boxShadow = tier.featured 
                    ? '0 10px 30px rgba(100, 255, 218, 0.3)' 
                    : '0 10px 30px rgba(100, 255, 218, 0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = tier.featured 
                    ? '0 0 20px rgba(100, 255, 218, 0.3)' 
                    : 'none';
                }}
              >
                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#64ffda', marginBottom: '0.5rem' }}>
                  {tier.name}
                </div>
                <div style={{ fontSize: '3rem', fontWeight: 'bold', color: '#fff', marginBottom: '0.5rem' }}>
                  {tier.price}<span style={{ fontSize: '1.5rem', color: '#8892b0' }}>/month</span>
                </div>
                <div style={{ color: '#8892b0', marginBottom: '2rem' }}>{tier.description}</div>
                
                <ul style={{ listStyle: 'none', marginBottom: '2rem', padding: 0 }}>
                  {tier.features.map((feature, index) => (
                    <li key={index} style={{ 
                      padding: '0.5rem 0', 
                      color: '#e0e0e0', 
                      position: 'relative', 
                      paddingLeft: '1.5rem' 
                    }}>
                      <span style={{ position: 'absolute', left: 0, color: '#64ffda' }}>✓</span>
                      {feature}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() => openSignup(tierKey)}
                  style={{
                    width: '100%',
                    padding: '1rem',
                    background: 'rgba(100, 255, 218, 0.2)',
                    border: '1px solid rgba(100, 255, 218, 0.3)',
                    color: '#64ffda',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    transition: 'all 0.3s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'rgba(100, 255, 218, 0.3)';
                    e.currentTarget.style.transform = 'translateY(-2px)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'rgba(100, 255, 218, 0.2)';
                    e.currentTarget.style.transform = 'translateY(0)';
                  }}
                >
                  Get Started
                </button>
              </div>
            ))}
          </div>
        </main>

        {/* Signup Modal */}
        {showModal && (
          <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(0, 0, 0, 0.8)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <div style={{
              background: 'rgba(26, 26, 62, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '12px',
              padding: '2rem',
              maxWidth: '500px',
              width: '90%',
              position: 'relative'
            }}>
              <span
                onClick={closeModal}
                style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  fontSize: '2rem',
                  cursor: 'pointer',
                  color: '#8892b0'
                }}
              >
                &times;
              </span>
              
              <h2 style={{ marginBottom: '1rem' }}>Start Your HYDI Subscription</h2>
              <p style={{ marginBottom: '2rem', color: '#8892b0' }}>
                {tiers[selectedTier]?.name} - {tiers[selectedTier]?.price}/month
              </p>
              
              {message && (
                <div style={{
                  background: message.includes('Failed') || message.includes('error') 
                    ? 'rgba(244, 67, 54, 0.2)' 
                    : 'rgba(76, 175, 80, 0.2)',
                  border: message.includes('Failed') || message.includes('error')
                    ? '1px solid rgba(244, 67, 54, 0.3)'
                    : '1px solid rgba(76, 175, 80, 0.3)',
                  borderRadius: '6px',
                  padding: '1rem',
                  marginBottom: '1rem',
                  color: message.includes('Failed') || message.includes('error') ? '#f44336' : '#4caf50'
                }}>
                  {message}
                </div>
              )}
              
              <form onSubmit={handleSubmit}>
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: '#64ffda' }}>
                    Email
                  </label>
                  <input
                    type="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: 'rgba(15, 15, 35, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '6px',
                      color: '#e0e0e0',
                      fontSize: '1rem'
                    }}
                  />
                </div>
                
                <div style={{ marginBottom: '1.5rem' }}>
                  <label style={{ display: 'block', marginBottom: '0.5rem', color: '#64ffda' }}>
                    Company
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.company}
                    onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      background: 'rgba(15, 15, 35, 0.8)',
                      border: '1px solid rgba(255, 255, 255, 0.2)',
                      borderRadius: '6px',
                      color: '#e0e0e0',
                      fontSize: '1rem'
                    }}
                  />
                </div>
                
                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%',
                    padding: '1rem',
                    background: 'rgba(100, 255, 218, 0.2)',
                    border: '1px solid rgba(100, 255, 218, 0.3)',
                    color: '#64ffda',
                    borderRadius: '6px',
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontSize: '1rem',
                    fontWeight: 'bold',
                    opacity: loading ? 0.5 : 1
                  }}
                >
                  {loading ? 'Processing...' : 'Start Subscription'}
                </button>
              </form>
            </div>
          </div>
        )}

        <footer style={{ 
          textAlign: 'center', 
          padding: '2rem', 
          borderTop: '1px solid rgba(255, 255, 255, 0.1)', 
          color: '#8892b0' 
        }}>
          <p>&copy; 2026 ProtoForge Industries. Powered by Supabase & Stripe.</p>
        </footer>
      </div>
    </div>
  );
}
