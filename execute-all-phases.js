/**
 * EXECUTE ALL PHASES
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function executePhase(phase, description, command) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`EXECUTING: ${description}`);
    console.log('='.repeat(60));
    
    try {
        if (command.startsWith('node')) {
            execSync(command, { stdio: 'inherit', cwd: __dirname });
        } else {
            console.log('\n⚠️  MANUAL ACTION REQUIRED:');
            console.log('Run this SQL in Supabase SQL Editor:');
            console.log('\n' + fs.readFileSync(command, 'utf8'));
            console.log('\nPress Enter when complete...');
            await new Promise(resolve => process.stdin.once('data', resolve));
        }
        console.log(`✅ Phase ${phase} completed`);
        return true;
    } catch (error) {
        console.log(`❌ Phase ${phase} failed: ${error.message}`);
        return false;
    }
}

async function main() {
    console.log('🚀 STARTING FULL AUTONOMY SETUP\n');
    
    const phases = [
        ['1', 'Database Fixes', 'phase1-db-fixes.sql'],
        ['2', 'Vault Configuration', 'node phase2-vault-check.js'],
        ['3', 'Cron Automation', 'phase3-cron-setup.sql'],
        ['4', 'System Validation', 'node phase4-validation.js'],
        ['5', 'Observability', 'phase5-observability.sql'],
        ['6', 'Hardening', 'phase6-hardening.sql']
    ];
    
    const results = [];
    
    for (const [phase, desc, cmd] of phases) {
        const success = await executePhase(phase, desc, cmd);
        results.push({ phase: phase, description: desc, success: success });
        
        if (!success) {
            console.log(`\n🛑 STOPPED at Phase ${phase}`);
            break;
        }
    }
    
    // Final report
    console.log('\n' + '='.repeat(60));
    console.log('FINAL REPORT');
    console.log('='.repeat(60));
    
    console.log('\n✅ Completed Steps:');
    results.filter(r => r.success).forEach(r => {
        console.log(`   Phase ${r.phase}: ${r.description}`);
    });
    
    const failed = results.filter(r => !r.success);
    if (failed.length > 0) {
        console.log('\n❌ Failed Steps:');
        failed.forEach(r => {
            console.log(`   Phase ${r.phase}: ${r.description}`);
        });
        console.log('\nSTATUS: NOT READY');
    } else {
        console.log('\n🎉 ALL PHASES COMPLETED');
        console.log('\nSTATUS: READY');
        console.log('\nSystem is fully autonomous!');
    }
    
    console.log('\n' + '='.repeat(60));
}

main().catch(console.error);
