#!/usr/bin/env node

/**
 * CI ENFORCEMENT SCRIPT
 * 
 * This script enforces build compliance by failing CI builds
 * when violations are detected in the HYDI system.
 * 
 * Usage: node scripts/enforce-build-compliance.js
 * Exit codes:
 * 0 - Compliance check passed
 * 1 - Compliance check failed
 */

const RuntimeEnforcer = require('../src/enforcement/RuntimeEnforcer');
const path = require('path');

async function enforceBuildCompliance() {
  console.log('🔒 CI ENFORCEMENT - Build Compliance Check');
  console.log('======================================\n');
  
  const enforcer = new RuntimeEnforcer({
    manifestPath: path.resolve(__dirname, '../system-manifest.json'),
    enforcementMode: 'strict',
    enableCIFailure: true,
    ciExitCode: 1,
    enableModuleHooking: false, // Disabled in CI
    enableServiceValidation: true,
    enableCreationBlocking: true
  });
  
  try {
    console.log('🔍 Running compliance checks...');
    
    // Load and validate manifest
    const manifestLoaded = await enforcer.loadManifest();
    if (!manifestLoaded) {
      console.error('❌ FAILED: System manifest not found or invalid');
      process.exit(1);
    }
    
    console.log('✅ Manifest loaded successfully');
    
    // Validate build
    const buildValidation = enforcer.validateBuild();
    
    if (!buildValidation.passed) {
      console.error('❌ BUILD VALIDATION FAILED');
      console.error('\nViolations:');
      buildValidation.violations.forEach((violation, index) => {
        console.error(`  ${index + 1}. ${violation.type}: ${violation.path || violation.cycle || 'Unknown'}`);
        console.error(`     Reason: ${violation.reason}`);
      });
      
      console.error('\nErrors:');
      buildValidation.errors.forEach((error, index) => {
        console.error(`  ${index + 1}. ${error}`);
      });
      
      console.error('\n🚨 BUILD FAILED - Fix violations before merging');
      process.exit(1);
    }
    
    console.log('✅ Build validation passed');
    
    // Get compliance report
    const report = enforcer.getComplianceReport();
    console.log(`\n📊 Compliance Report:`);
    console.log(`  Overall compliance: ${report.compliance.overallCompliance.toUpperCase()}`);
    console.log(`  Manifest compliant: ${report.compliance.manifestCompliant ? 'YES' : 'NO'}`);
    console.log(`  Registration compliant: ${report.compliance.registrationCompliant ? 'YES' : 'NO'}`);
    console.log(`  Violation rate: ${(report.compliance.violationRate * 100).toFixed(1)}%`);
    
    if (report.recommendations.length > 0) {
      console.log('\n💡 Recommendations:');
      report.recommendations.forEach((rec, index) => {
        console.log(`  ${index + 1}. [${rec.priority.toUpperCase()}] ${rec.type}: ${rec.message}`);
      });
    }
    
    // Show registered services
    console.log(`\n📋 Registered Services (${report.registered.services.length}):`);
    report.registered.services.forEach((service, index) => {
      console.log(`  ${index + 1}. ${service}`);
    });
    
    console.log('\n✅ BUILD COMPLIANCE CHECK PASSED');
    console.log('🎉 System is compliant and ready for deployment');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Compliance check failed with error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the enforcement
enforceBuildCompliance();
