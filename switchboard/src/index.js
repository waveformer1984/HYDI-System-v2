const { createConfig } = require('./config');
const { createLogger } = require('./logger');
const { createRepository } = require('./repository');
const { createApp } = require('./api');

async function main() {
  const config = createConfig();
  const logger = createLogger(config);
  const repository = createRepository({ config, logger });
  await repository.init();
  const app = createApp(repository, config, logger);
  app.listen(config.port, () => {
    logger.info('startup', 'server.listening', `Switchboard running on http://localhost:${config.port}`);
  });
}

main().catch(err => {
  console.error('Switchboard failed to start:', err);
  process.exit(1);
});
