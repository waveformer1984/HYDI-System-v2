// See pages/api/health.js for why this bridge exists. Stripe requires the
// raw request body for signature verification, so the `config` export
// (which disables Next.js's default JSON body parsing) must also be
// re-exported here, not just the handler. See ISSUES_FOUND.md #33.
export { default, config } from '../../api/stripe-connect-webhook.js';
