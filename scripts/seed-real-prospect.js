// Seed a real prospect for the revenue pipeline
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({
    host: '127.0.0.1',
    port: 54322,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres',
    max: 1,
    connectionTimeoutMillis: 10000,
  });

  const prospectId = 'prospect_' + Date.now();
  const now = new Date().toISOString();

  console.log('Creating real prospect for revenue pipeline...');

  // Insert a real prospect — a small business that could use AI operations
  await pool.query(
    `INSERT INTO revenue_prospects (
      prospect_id, company_name, contact_name, contact_email,
      website, industry, location, source, status,
      icp_score, icp_factors, opted_out, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, $12, $12)`,
    [
      prospectId,
      'Apex Contracting LLC',
      'Mike Reynolds',
      'mike@apexcontracting.example',
      'https://apexcontracting.example',
      'contractor',
      'Austin, TX',
      'manual_entry',
      'identified',
      0, // score will be computed by pipeline
      JSON.stringify({
        websiteQuality: 0.3,
        leadCaptureGap: 0.9,
        responseTime: 0.8,
        automationOpportunity: 0.85,
        businessSize: 0.7,
        industryFit: 0.95,
      }),
      now,
    ]
  );

  console.log(`Created prospect: ${prospectId}`);
  console.log('Company: Apex Contracting LLC');
  console.log('Industry: contractor (high ICP fit)');
  console.log('Location: Austin, TX');

  // Now score the prospect using the pipeline
  const { ProspectPipeline } = require('../lib/revenue/ProspectPipeline');
  const pipeline = new ProspectPipeline();

  console.log('\nScoring prospect...');
  const scoreResult = await pipeline.scoreProspect(prospectId);
  console.log(`ICP Score: ${scoreResult.score}/100`);
  console.log(`Factors: ${JSON.stringify(scoreResult.factors)}`);
  console.log(`Reason: ${scoreResult.reason}`);

  // Create an opportunity
  console.log('\nCreating opportunity...');
  const opportunity = await pipeline.createOpportunity({
    prospectId,
    offerId: 'ai_operations_setup',
    proposedPrice: 50000, // $500.00
    estimatedValue: 50000,
    probability: 0.3,
    expectedCloseDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
  });
  console.log(`Opportunity created: ${JSON.stringify(opportunity, null, 2)}`);

  // Get pipeline metrics
  console.log('\nPipeline metrics:');
  const metrics = await pipeline.getPipelineMetrics();
  console.log(JSON.stringify(metrics, null, 2));

  await pool.end();
  console.log('\nProspect seeded successfully. Ready for cognitive cycle.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
