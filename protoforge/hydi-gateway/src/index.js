const { loadConfig } = require('./config');
const { Ledger } = require('./store');
const { createServer } = require('./server');

const config = loadConfig();
const store = new Ledger(config);
const server = createServer(config, store);

server.listen(config.port, () => {
  console.log(`HYDI Event Gateway listening on http://localhost:${config.port}`);
});
