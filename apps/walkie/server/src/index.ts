import { createVerifier } from './auth.js';
import { loadConfig } from './config.js';
import { LiveKitGateway } from './livekit.js';
import { migrate } from './migrate.js';
import { buildApp } from './app.js';
import { MemoryStore } from './store/memory.js';
import { PgStore } from './store/pg.js';
import type { Store } from './store/types.js';

const config = loadConfig();

let store: Store;
if (config.databaseUrl) {
  await migrate(config.databaseUrl, (m) => console.log(`[walkie] migration ${m}`));
  store = new PgStore(config.databaseUrl);
} else {
  console.warn('[walkie] DATABASE_URL not set: using the in-memory store (development only; state is lost on restart)');
  store = new MemoryStore();
}

const { app, floor } = await buildApp({ config, store, media: new LiveKitGateway(config.livekit), verifier: createVerifier(config) });
floor.start();

const shutdown = async () => {
  floor.stop();
  await app.close();
  await store.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ host: config.host, port: config.port });
app.log.info({ auth: config.auth.mode, store: config.databaseUrl ? 'postgres' : 'memory' }, 'walkie server listening');
