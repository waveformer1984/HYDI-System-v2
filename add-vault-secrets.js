/**
 * Seed Supabase Vault secrets used by pg_cron-invoked Edge Functions.
 *
 * Never hardcode secret values here -- everything is read from the local
 * environment (.env) and never printed to the console, per
 * SECURITY_PROTOCOL.md. Run this once after rotating credentials, or
 * whenever a new Vault-backed cron invoker is added.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// name -> env var the value is sourced from. 'action_worker_project_url' and
// 'action_worker_service_jwt' are consumed by
// supabase/migrations/20260715210000_secure_action_worker_cron.sql and
// 20260426123500_billing_retry_cron.sql via vault.decrypted_secrets.
const SECRET_ENV_MAP = {
    project_url: 'SUPABASE_URL',
    anon_key: 'SUPABASE_PUBLISHABLE_KEY',
    action_worker_project_url: 'SUPABASE_URL',
    action_worker_service_jwt: 'SUPABASE_SERVICE_ROLE_KEY',
};

async function addVaultSecrets() {
    console.log('Adding secrets to Vault...\n');

    const missingEnvVars = [];

    for (const [name, envVar] of Object.entries(SECRET_ENV_MAP)) {
        const value = process.env[envVar];

        if (!value) {
            console.log(`SKIP ${name}: env var ${envVar} is not set`);
            missingEnvVars.push(envVar);
            continue;
        }

        console.log(`Adding ${name}...`);

        try {
            const { error } = await supabase.rpc('vault_create_secret', {
                name,
                secret: value,
            });

            if (error) {
                console.log(`FAILED to add ${name}: ${error.message}`);
                console.log('Add it manually via the Supabase Dashboard (Project Settings > Vault) instead.');
            } else {
                console.log(`OK: added ${name}`);
            }
        } catch (err) {
            console.log(`FAILED to add ${name}: ${err.message}`);
            console.log(`Add it manually via the Dashboard. Source env var: ${envVar} (value not printed).`);
        }
    }

    // Verify existing secrets -- names/timestamps only, never values.
    console.log('\nCurrent Vault secrets:');
    try {
        const { data } = await supabase
            .from('vault.decrypted_secrets')
            .select('name, created_at')
            .order('name');

        if (data) {
            data.forEach((secret) => {
                console.log(`  - ${secret.name} (added: ${secret.created_at})`);
            });
        }
    } catch (err) {
        console.log('Cannot list secrets via API:', err.message);
    }

    if (missingEnvVars.length > 0) {
        console.log(`\nSet these env vars and re-run to seed the remaining secrets: ${[...new Set(missingEnvVars)].join(', ')}`);
    }
}

addVaultSecrets();
