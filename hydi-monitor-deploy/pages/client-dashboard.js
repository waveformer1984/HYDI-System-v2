import { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function ClientDashboard() {
  const [client, setClient] = useState(null);
  const [clientId, setClientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Dashboard data
  const [totalEarnings, setTotalEarnings] = useState(0);
  const [currentMonthEarnings, setCurrentMonthEarnings] = useState(0);
  const [lastPayout, setLastPayout] = useState(null);
  const [upcomingPayout, setUpcomingPayout] = useState(null);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [payoutHistory, setPayoutHistory] = useState([]);

  async function loadDashboard(clientId) {
    setLoading(true);
    setError('');
    
    try {
      // Get client info
      const { data: clientData, error: clientError } = await supabase
        .from('clients')
        .select('*')
        .eq('client_id', clientId)
        .single();
      
      if (clientError) throw new Error('Client not found');
      setClient(clientData);

      // Get current month dates
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();

      // Get total earnings (all time)
      const { data: allEarnings } = await supabase
        .from('ledger')
        .select('amount_gross')
        .eq('source_account', clientData.project_name)
        .eq('status', 'completed');
      
      const total = allEarnings?.reduce((sum, entry) => sum + parseFloat(entry.amount_gross), 0) || 0;
      setTotalEarnings(total);

      // Get current month earnings
      const { data: monthEarnings } = await supabase
        .from('ledger')
        .select('amount_gross')
        .eq('source_account', clientData.project_name)
        .eq('status', 'completed')
        .gte('timestamp', currentMonthStart)
        .lte('timestamp', currentMonthEnd);
      
      const monthTotal = monthEarnings?.reduce((sum, entry) => sum + parseFloat(entry.amount_gross), 0) || 0;
      setCurrentMonthEarnings(monthTotal);

      // Get last payout
      const { data: lastPayoutData } = await supabase
        .from('payouts')
        .select('*')
        .eq('client_id', clientId)
        .eq('status', 'completed')
        .order('payout_date', { ascending: false })
        .limit(1)
        .single();
      setLastPayout(lastPayoutData);

      // Get upcoming payout (pending or scheduled)
      const { data: upcomingPayoutData } = await supabase
        .from('payouts')
        .select('*')
        .eq('client_id', clientId)
        .in('status', ['pending', 'scheduled'])
        .order('payout_date', { ascending: true })
        .limit(1)
        .single();
      setUpcomingPayout(upcomingPayoutData);

      // Get ledger entries (filtered by project)
      const { data: ledgerData } = await supabase
        .from('ledger')
        .select('*')
        .eq('source_account', clientData.project_name)
        .order('timestamp', { ascending: false })
        .limit(50);
      setLedgerEntries(ledgerData || []);

      // Get payout history
      const { data: historyData } = await supabase
        .from('payouts')
        .select('*')
        .eq('client_id', clientId)
        .order('payout_date', { ascending: false })
        .limit(12);
      setPayoutHistory(historyData || []);

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <main style={{ fontFamily: 'monospace', background: '#09090b', color: '#fafafa', minHeight: '100vh', padding: '2rem' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '2rem', margin: 0 }}>
            <span style={{ color: '#00e5a0' }}>Proto</span>Forge
          </h1>
          <p style={{ color: '#71717a', marginTop: '0.5rem' }}>Client Earnings Dashboard</p>
        </div>

        {/* Client Selector */}
        <div style={{ 
          background: '#18181b', 
          border: '1px solid #333', 
          borderRadius: 12, 
          padding: '1.5rem',
          marginBottom: '2rem'
        }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, color: '#a1a1aa', marginBottom: 8 }}>
                Client ID
              </label>
              <input
                type="text"
                placeholder="Enter client ID (e.g., galactic-bytes)"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  background: '#27272a',
                  border: '1px solid #333',
                  borderRadius: 8,
                  color: '#fff',
                  fontFamily: 'monospace',
                  fontSize: 14
                }}
              />
            </div>
            <button
              onClick={() => loadDashboard(clientId)}
              disabled={loading || !clientId}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#00e5a0',
                color: '#000',
                border: 'none',
                borderRadius: 8,
                fontFamily: 'monospace',
                fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer',
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? 'Loading...' : 'Load Dashboard'}
            </button>
          </div>
          {error && (
            <p style={{ color: '#ef4444', fontSize: 13, marginTop: '1rem' }}>{error}</p>
          )}
        </div>

        {client && (
          <>
            {/* Client Info */}
            <div style={{ 
              background: '#18181b', 
              border: '1px solid #333', 
              borderRadius: 12, 
              padding: '1.5rem',
              marginBottom: '2rem'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h2 style={{ margin: 0, fontSize: '1.5rem' }}>{client.client_name}</h2>
                  <p style={{ color: '#71717a', margin: '0.5rem 0 0 0' }}>{client.project_name}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ 
                    display: 'inline-block',
                    padding: '0.35rem 0.75rem',
                    background: client.status === 'active' ? 'rgba(0,229,160,0.1)' : 'rgba(239,68,68,0.1)',
                    color: client.status === 'active' ? '#00e5a0' : '#ef4444',
                    borderRadius: 20,
                    fontSize: 12,
                    textTransform: 'uppercase'
                  }}>
                    {client.status}
                  </span>
                  <p style={{ color: '#71717a', fontSize: 12, margin: '0.5rem 0 0 0' }}>
                    {client.payout_schedule} payouts
                  </p>
                </div>
              </div>
            </div>

            {/* Earnings Summary Cards */}
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
              gap: '1rem',
              marginBottom: '2rem'
            }}>
              {/* Total Earnings */}
              <div style={{ 
                background: '#18181b', 
                border: '1px solid #333', 
                borderRadius: 12, 
                padding: '1.5rem'
              }}>
                <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 8 }}>Total Earnings (All Time)</div>
                <div style={{ fontSize: '2rem', color: '#00e5a0', fontWeight: 600 }}>
                  {formatCurrency(totalEarnings)}
                </div>
              </div>

              {/* Current Month */}
              <div style={{ 
                background: '#18181b', 
                border: '1px solid #333', 
                borderRadius: 12, 
                padding: '1.5rem'
              }}>
                <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 8 }}>Current Month Earnings</div>
                <div style={{ fontSize: '2rem', color: '#00e5a0', fontWeight: 600 }}>
                  {formatCurrency(currentMonthEarnings)}
                </div>
              </div>

              {/* Last Payout */}
              <div style={{ 
                background: '#18181b', 
                border: '1px solid #333', 
                borderRadius: 12, 
                padding: '1.5rem'
              }}>
                <div style={{ fontSize: 12, color: '#a1a1aa', marginBottom: 8 }}>Last Payout</div>
                <div style={{ fontSize: '1.5rem', color: '#fafafa', fontWeight: 600 }}>
                  {lastPayout ? formatCurrency(lastPayout.net_payout_amount) : '$0.00'}
                </div>
                <div style={{ fontSize: 12, color: '#71717a', marginTop: 4 }}>
                  {lastPayout ? formatDate(lastPayout.payout_date) : 'No payouts yet'}
                </div>
              </div>

              {/* Upcoming Payout */}
              <div style={{ 
                background: 'rgba(0,229,160,0.05)', 
                border: '1px solid rgba(0,229,160,0.3)', 
                borderRadius: 12, 
                padding: '1.5rem'
              }}>
                <div style={{ fontSize: 12, color: '#00e5a0', marginBottom: 8 }}>Upcoming Payout</div>
                <div style={{ fontSize: '1.5rem', color: '#00e5a0', fontWeight: 600 }}>
                  {upcomingPayout ? formatCurrency(upcomingPayout.net_payout_amount) : '$0.00'}
                </div>
                <div style={{ fontSize: 12, color: '#71717a', marginTop: 4 }}>
                  {upcomingPayout ? `Scheduled: ${formatDate(upcomingPayout.payout_date)}` : 'No upcoming payouts'}
                </div>
                {upcomingPayout && (
                  <div style={{ fontSize: 11, color: '#a1a1aa', marginTop: 8 }}>
                    Status: {upcomingPayout.status}
                  </div>
                )}
              </div>
            </div>

            {/* Detailed Breakdown */}
            {upcomingPayout && (
              <div style={{ 
                background: '#18181b', 
                border: '1px solid #333', 
                borderRadius: 12, 
                padding: '1.5rem',
                marginBottom: '2rem'
              }}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>Upcoming Payout Breakdown</h3>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', 
                  gap: '1rem'
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#a1a1aa' }}>Gross Earnings</div>
                    <div style={{ fontSize: '1.25rem', color: '#fafafa' }}>
                      {formatCurrency(upcomingPayout.gross_earnings)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#a1a1aa' }}>Platform Fee</div>
                    <div style={{ fontSize: '1.25rem', color: '#ef4444' }}>
                      -{formatCurrency(upcomingPayout.platform_fee_amount)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#a1a1aa' }}>Agent Fee</div>
                    <div style={{ fontSize: '1.25rem', color: '#ef4444' }}>
                      -{formatCurrency(upcomingPayout.agent_fee_amount)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: '#a1a1aa' }}>Net Payout</div>
                    <div style={{ fontSize: '1.25rem', color: '#00e5a0' }}>
                      {formatCurrency(upcomingPayout.net_payout_amount)}
                    </div>
                  </div>
                </div>
                <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid #333' }}>
                  <div style={{ fontSize: 12, color: '#71717a' }}>
                    Period: {formatDate(upcomingPayout.period_start)} - {formatDate(upcomingPayout.period_end)}
                  </div>
                </div>
              </div>
            )}

            {/* Ledger View */}
            <div style={{ 
              background: '#18181b', 
              border: '1px solid #333', 
              borderRadius: 12, 
              padding: '1.5rem',
              marginBottom: '2rem'
            }}>
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>Transaction Ledger ({client.project_name})</h3>
              {ledgerEntries.length === 0 ? (
                <p style={{ color: '#71717a', textAlign: 'center', padding: '2rem' }}>
                  No transactions found
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #333' }}>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Date</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Gross</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Platform Fee</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Agent Fee</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Net</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerEntries.map((entry) => (
                        <tr key={entry.transaction_id} style={{ borderBottom: '1px solid #27272a' }}>
                          <td style={{ padding: '0.75rem' }}>{formatDate(entry.timestamp)}</td>
                          <td style={{ padding: '0.75rem' }}>{formatCurrency(entry.amount_gross)}</td>
                          <td style={{ padding: '0.75rem', color: '#ef4444' }}>
                            {formatCurrency(entry.platform_fee_amount)}
                          </td>
                          <td style={{ padding: '0.75rem', color: '#ef4444' }}>
                            {formatCurrency(entry.agent_fee_amount)}
                          </td>
                          <td style={{ padding: '0.75rem', color: '#00e5a0' }}>
                            {formatCurrency(entry.net_amount)}
                          </td>
                          <td style={{ padding: '0.75rem' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '0.2rem 0.5rem',
                              background: entry.status === 'completed' ? 'rgba(0,229,160,0.1)' : 'rgba(234,179,8,0.1)',
                              color: entry.status === 'completed' ? '#00e5a0' : '#eab308',
                              borderRadius: 4,
                              fontSize: 11
                            }}>
                              {entry.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Payout History */}
            <div style={{ 
              background: '#18181b', 
              border: '1px solid #333', 
              borderRadius: 12, 
              padding: '1.5rem'
            }}>
              <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.1rem' }}>Payout History</h3>
              {payoutHistory.length === 0 ? (
                <p style={{ color: '#71717a', textAlign: 'center', padding: '2rem' }}>
                  No payouts yet
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #333' }}>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Period</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Payout Date</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Gross</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Net</th>
                        <th style={{ textAlign: 'left', padding: '0.75rem', color: '#a1a1aa', fontWeight: 400 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payoutHistory.map((payout) => (
                        <tr key={payout.payout_id} style={{ borderBottom: '1px solid #27272a' }}>
                          <td style={{ padding: '0.75rem' }}>
                            {formatDate(payout.period_start)} - {formatDate(payout.period_end)}
                          </td>
                          <td style={{ padding: '0.75rem' }}>{formatDate(payout.payout_date)}</td>
                          <td style={{ padding: '0.75rem' }}>{formatCurrency(payout.gross_earnings)}</td>
                          <td style={{ padding: '0.75rem', color: '#00e5a0' }}>
                            {formatCurrency(payout.net_payout_amount)}
                          </td>
                          <td style={{ padding: '0.75rem' }}>
                            <span style={{
                              display: 'inline-block',
                              padding: '0.2rem 0.5rem',
                              background: payout.status === 'completed' ? 'rgba(0,229,160,0.1)' : 
                                        payout.status === 'pending' ? 'rgba(234,179,8,0.1)' : 'rgba(239,68,68,0.1)',
                              color: payout.status === 'completed' ? '#00e5a0' : 
                                     payout.status === 'pending' ? '#eab308' : '#ef4444',
                              borderRadius: 4,
                              fontSize: 11
                            }}>
                              {payout.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
