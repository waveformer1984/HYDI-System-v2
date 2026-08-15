const fs = require('fs');
const path = require('path');

describe('Persistence factory guard', () => {
  test('src/persistence/supabase-client.js exists and exports canonical factory functions', () => {
    const factoryPath = path.resolve(__dirname, '../../src/persistence/supabase-client.js');
    expect(fs.existsSync(factoryPath)).toBe(true);
    const factory = require(factoryPath);
    expect(typeof factory.createSupabaseClient).toBe('function');
    expect(typeof factory.getSupabaseClient).toBe('function');
    expect(typeof factory.getPersistenceSource).toBe('function');
    expect(typeof factory.resetSupabaseClient).toBe('function');
  });

  test('src/database.js imports the canonical factory', () => {
    const dbPath = path.resolve(__dirname, '../../src/database.js');
    const content = fs.readFileSync(dbPath, 'utf-8');
    expect(content).toContain("require('./persistence/supabase-client')");
    expect(content).toContain('getSupabaseClient()');
  });

  test('persistence factory supports local-only mode', () => {
    const { createSupabaseClient, resetSupabaseClient } = require('../../src/persistence/supabase-client');
    resetSupabaseClient();
    process.env.HYDI_PERSISTENCE_MODE = 'local';
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
    const local = createSupabaseClient();
    expect(local.source).toBe('local');
    expect(local.client).toBeDefined();

    resetSupabaseClient();
    process.env.HYDI_PERSISTENCE_MODE = 'cloud';
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_test';
    const forced = createSupabaseClient();
    expect(forced.source).toBe('local');
    expect(forced.client).toBeDefined();
  });
});
