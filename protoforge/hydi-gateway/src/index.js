const { loadConfig } = require('./config');
const { RawLedgerAdapter } = require('./adapters/raw-ledger');
const { Outbox } = require('./outbox/outbox');
const { RetryWorker } = require('./outbox/retry-worker');
const { createServer } = require('./server');

const config = loadConfig();
const outbox = new Outbox({ dataDir: config.outboxDataDir });
const rawLedger = new RawLedgerAdapter({
  supabaseUrl: config.supabaseUrl,
  supabaseKey: config.supabaseKey,
  outbox
});

const worker = new RetryWorker(outbox, async (rawEvent) => {
  return rawLedger.commit(rawEvent);
}, { intervalMs: config.retryIntervalMs });
rawLedger.setRetryWorker(worker);
worker.start();

const server = createServer(config, rawLedger);
server.listen(config.port, () => {
  console.log(`HYDI Event Gateway listening on http://localhost:${config.port}`);
});

process.on('SIGTERM', () => {
  worker.stop();
  server.close(() => process.exit(0));
});
