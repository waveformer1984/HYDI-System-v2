const { loadConfig } = require('./config');
const { RawLedgerAdapter } = require('./adapters/raw-ledger');
const { createServer } = require('./server');

const config = loadConfig();
const rawLedger = new RawLedgerAdapter({
  supabaseUrl: config.supabaseUrl,
  supabaseKey: config.supabaseKey
});
const server = createServer(config, rawLedger);

server.listen(config.port, () => {
  console.log(`HYDI Event Gateway listening on http://localhost:${config.port}`);
});
