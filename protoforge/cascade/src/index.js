const { loadConfig } = require('./config');
const { LedgerAdapter } = require('./adapters/ledger-adapter');
const { EventProcessor } = require('./processor');
const { DerivedStore, LineageGraph } = require('./derived-store');
const { Metrics } = require('./metrics');
const { ReplayEngine } = require('./replay');
const { createServer } = require('./server');
const { createDefaultAdapters } = require('./versioning/adapters');

const config = loadConfig();
const ledger = new LedgerAdapter({
  supabaseUrl: config.supabaseUrl,
  supabaseKey: config.supabaseKey,
  table: config.table
});
const processor = new EventProcessor({
  versionAdapters: createDefaultAdapters(),
  processorVersion: config.processorVersion
});
const store = new DerivedStore({ dataDir: config.dataDir });
const lineage = new LineageGraph(store);
const metrics = new Metrics();
const replay = new ReplayEngine({ ledger, processor, store, metrics });

const server = createServer(config, { store, lineage, metrics, replay });
server.listen(config.port, () => {
  console.log(`CASCADE listening on http://localhost:${config.port}`);
});
