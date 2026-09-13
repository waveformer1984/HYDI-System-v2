// Quick debug script
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve('.env.local') });
dotenv.config({ path: path.resolve('.env') });

async function main() {
  const { ProspectDiscoveryAdapter, createDiscoveryAdapterFromEnv } = require('./lib/revenue/ProspectDiscoveryAdapter');
  const { ProspectPipeline } = require('./lib/revenue/ProspectPipeline');
  const { RevenueDatabase } = require('./lib/revenue/RevenueDatabase');
  const { CommercialWorkflow } = require('./lib/revenue/CommercialWorkflow');
  const { RevenueLedger } = require('./lib/revenue/RevenueLedger');
  const { CustomerLifecycle } = require('./lib/revenue/CustomerLifecycle');

  const DB_CONFIG = { host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' };
  const revDb = new RevenueDatabase(DB_CONFIG);
  const pipeline = new ProspectPipeline(undefined, revDb);
  const ledger = new RevenueLedger(revDb);
  const lifecycle = new CustomerLifecycle(revDb);
  const discovery = createDiscoveryAdapterFromEnv();
  const workflow = new CommercialWorkflow({ pipeline, ledger, lifecycle, discovery });

  const csvData = [{
    company_name: 'Debug Test Biz',
    contact_name: 'Debug Owner',
    contact_email: 'debugtest123@debug.test',
    contact_phone: '555-0100',
    website: 'https://debug-biz.example',
    industry: 'contractor',
    location: 'Austin, TX',
  }];

  console.log('1. Calling importFromCsv...');
  const discovered = await discovery.importFromCsv(csvData, 'authorized_test');
  console.log('   Discovered:', discovered.length, 'prospects');
  console.log('   First:', JSON.stringify(discovered[0]?.companyName));

  console.log('2. Calling ingestProspect...');
  try {
    const result = await workflow.ingestProspect(discovered[0]);
    console.log('   Created:', result.created);
    console.log('   Score:', result.score);
    console.log('   Qualified:', result.qualified);
    console.log('   Prospect ID:', result.prospect.prospectId);
  } catch (e) {
    console.log('   ERROR:', e.message);
  }

  await revDb.close();
}

main().catch(console.error);
