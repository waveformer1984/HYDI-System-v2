// See pages/api/checkout.js for why this bridge exists. `config` must be
// re-exported too -- Stripe signature verification needs the raw request
// body, so Next.js's built-in bodyParser has to stay disabled here.
export { default, config } from '../../api/stripe-connect-webhook.js';
