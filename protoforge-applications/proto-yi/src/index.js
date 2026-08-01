const { createConfig } = require('./config');
const { createLogger } = require('./logger');
const { createRepository } = require('./repository');
const { createApi } = require('./api/router');
const { ProtoIYEngineAdapter } = require('./adapters/protoiy-engine');

async function main() {
  const config = createConfig();
  const logger = createLogger(config);
  const repository = createRepository({ config, logger });
  await repository.init();

  const adapter = new ProtoIYEngineAdapter({
    endpoint: config.protoiyEndpoint,
    eventBus: repository.eventBus,
    logger
  });

  const app = createApi(repository, adapter, config);
  app.listen(config.port, () => {
    logger.info('api', 'server.started', `Listening on port ${config.port}`);
  });
}

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });

module.exports = { main };
