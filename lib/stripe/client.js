import Stripe from 'stripe';

const apiKey = process.env.STRIPE_SECRET_KEY;

if (!apiKey) {
  throw new Error('STRIPE_SECRET_KEY is not set in the environment');
}

const stripe = new Stripe(apiKey, {
  apiVersion: '2026-04-22.dahlia',
  appInfo: {
    name: 'HYDI Stripe Integration',
    version: '0.9.0',
  },
});

export default stripe;
