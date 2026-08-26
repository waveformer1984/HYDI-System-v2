// Legacy tier/subscription checkout bridge.
//
// This route re-exports the Vercel-style handler in api/checkout.js, which
// creates subscription-mode Stripe Checkout Sessions for the old
// starter/pro/enterprise tier model. It is NOT linked to the customer job
// pipeline (JobManager) and its webhook events bypass JobWebhookBridge.
//
// The qualified production revenue path is:
//   POST /api/revenue/jobs  →  Stripe Checkout  →  webhook  →  JobManager
//
// This legacy route is explicitly UNSUPPORTED in production. It returns
// 410 Gone with a pointer to the qualified path when NODE_ENV=production.
// In development it remains available for testing.
//
// See docs/REVENUE_PATH_BOUNDARY.md for the full boundary definition.

const isProduction = process.env.NODE_ENV === 'production';

export default async function handler(req, res) {
    if (isProduction) {
        res.setHeader('Allow', ['POST']);
        return res.status(410).json({
            error: 'Legacy checkout is not supported in production',
            reason: 'This route creates subscription-mode sessions not linked to the customer job pipeline. Use POST /api/revenue/jobs instead.',
            qualifiedPath: '/api/revenue/jobs',
            documentation: 'docs/REVENUE_PATH_BOUNDARY.md',
        });
    }

    // Development: delegate to the legacy handler
    const legacy = (await import('../../api/checkout.js')).default;
    return legacy(req, res);
}
