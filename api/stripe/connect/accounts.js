import Stripe from 'stripe';
import { getRawBody } from '../../../lib/get-raw-body';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2026-04-22.dahlia',
  appInfo: { name: 'HYDI Stripe Integration', version: '0.9.0' },
});

const ORIGIN = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    try {
      const accounts = await stripe.accounts.list({ limit: 10 });
      return res.status(200).json({ accounts: accounts.data });
    } catch (error) {
      console.error('[stripe/connect/accounts] list failed:', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  if (req.method === 'POST') {
    let body;
    try {
      const raw = await getRawBody(req);
      body = JSON.parse(raw);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const { email, country = 'US', type = 'express', stream } = body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    try {
      const account = await stripe.accounts.create({
        type,
        country,
        email,
        metadata: {
          hydi_stream: stream || 'unknown',
          hydi_integration: 'v0.9.0',
        },
      });

      const accountLink = await stripe.accountLinks.create({
        account: account.id,
        refresh_url: `${ORIGIN}/stripe/connect/refresh?account_id=${account.id}`,
        return_url: `${ORIGIN}/stripe/connect/return?account_id=${account.id}`,
        type: 'account_onboarding',
      });

      return res.status(200).json({
        account_id: account.id,
        onboarding_url: accountLink.url,
      });
    } catch (error) {
      console.error('[stripe/connect/accounts] create failed:', error.message);
      return res.status(500).json({ error: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export const config = {
  api: {
    bodyParser: false,
  },
};
