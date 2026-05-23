/**
 * api/rezonate/marketplace-checkout.js
 *
 * POST { project_id, license_type? }
 *   → creates Stripe Checkout session
 *   → returns { checkout_url }
 *
 * Payment is routed to the STRIPE_ACCOUNT_REZONATE Connect sub-account.
 * Platform takes 15% application fee. Stripe takes ~2.9% + $0.30.
 */
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' });

const db = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { project_id, license_type } = req.body || {};
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  // Fetch project
  const supabase = db();
  const { data: project, error } = await supabase
    .from('rezonate_projects')
    .select('id, name, price_cents, license_type, is_published, public_slug')
    .eq('id', project_id)
    .single();

  if (error || !project) return res.status(404).json({ error: 'Project not found' });
  if (!project.is_published) return res.status(400).json({ error: 'Beat is not published' });
  if (project.price_cents <= 0) return res.status(400).json({ error: 'Beat is free — no checkout needed' });

  const resolvedLicense = license_type || project.license_type;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const platformFeeAmount = Math.round(project.price_cents * 0.15); // 15% platform fee

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: project.price_cents,
            product_data: {
              name: `${project.name} — Beat License`,
              description: `${resolvedLicense === 'exclusive' ? 'Exclusive' : 'Non-Exclusive'} license`,
            },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        application_fee_amount: platformFeeAmount,
        transfer_data: {
          destination: process.env.STRIPE_ACCOUNT_REZONATE,
        },
        metadata: {
          project_id,
          license_type: resolvedLicense,
          revenue_stream: 'rezonate',
        },
      },
      success_url: `${appUrl}/rezonate/beat/${project.public_slug}?purchased=true`,
      cancel_url: `${appUrl}/rezonate/beat/${project.public_slug}?cancelled=true`,
      metadata: {
        project_id,
        license_type: resolvedLicense,
        revenue_stream: 'rezonate',
      },
    });

    // Write a pending ledger entry
    const grossAmount = project.price_cents / 100;
    const platformFee = grossAmount * 0.15;
    const stripeFee = grossAmount * 0.029 + 0.30;
    const netAmount = grossAmount - platformFee - stripeFee;

    await supabase.from('ledger').insert({
      gross_amount: grossAmount,
      platform_fee: platformFee,
      stripe_fee: stripeFee,
      net_amount: parseFloat(netAmount.toFixed(2)),
      revenue_stream: 'rezonate',
      project_code: project_id,
      status: 'pending',
      metadata: {
        stripe_session_id: session.id,
        license_type: resolvedLicense,
        beat_name: project.name,
      },
    });

    return res.status(200).json({ checkout_url: session.url });
  } catch (err) {
    console.error('[MARKETPLACE-CHECKOUT]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
