/**
 * Simple Stripe Webhook Test Handler
 */

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Stripe-Signature');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    
    console.log('Webhook received:', {
      signature: sig ? 'present' : 'missing',
      secret: webhookSecret ? 'configured' : 'missing',
      body: req.body ? 'present' : 'missing'
    });

    // Simple test response
    return res.status(200).json({
      status: 'received',
      message: 'Webhook endpoint is working',
      timestamp: new Date().toISOString(),
      signature_present: !!sig,
      secret_configured: !!webhookSecret
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
