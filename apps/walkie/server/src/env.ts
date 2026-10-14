import { existsSync } from 'node:fs';

/**
 * Loads server/.env (when present) into process.env before configuration is
 * read. Variables already set in the environment win, so PM2/CI settings are
 * never overridden. Import this first.
 */
const file = new URL('../.env', import.meta.url);
if (existsSync(file)) process.loadEnvFile(file);
