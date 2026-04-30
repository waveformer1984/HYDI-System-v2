// Validate function slugs exist locally before deployment
const fs = require('fs');
const path = require('path');

function validateFunctionSlugs() {
  console.log('🔍 VALIDATING FUNCTION SLUGS');
  console.log('==============================');
  
  // Load canonical slugs
  const slugsConfig = JSON.parse(fs.readFileSync('production-function-slugs.json', 'utf8'));
  const allSlugs = [
    ...slugsConfig.canonical_slugs.web_services,
    ...slugsConfig.canonical_slugs.marketing_services,
    ...slugsConfig.canonical_slugs.passive_services,
    ...slugsConfig.canonical_slugs.revenue_services
  ];
  
  const functionsDir = 'supabase/functions';
  const missingFunctions = [];
  const existingFunctions = [];
  
  // Check each slug
  for (const slug of allSlugs) {
    const functionPath = path.join(functionsDir, slug);
    
    if (fs.existsSync(functionPath)) {
      const indexPath = path.join(functionPath, 'index.ts');
      if (fs.existsSync(indexPath)) {
        existingFunctions.push(slug);
        console.log(`✅ ${slug}: Function exists`);
      } else {
        missingFunctions.push({ slug, reason: 'Missing index.ts' });
        console.log(`❌ ${slug}: Missing index.ts`);
      }
    } else {
      missingFunctions.push({ slug, reason: 'Function directory not found' });
      console.log(`❌ ${slug}: Function directory not found`);
    }
  }
  
  // Summary
  console.log('\n📊 VALIDATION SUMMARY');
  console.log('====================');
  console.log(`Total functions to validate: ${allSlugs.length}`);
  console.log(`Existing functions: ${existingFunctions.length}`);
  console.log(`Missing functions: ${missingFunctions.length}`);
  
  if (missingFunctions.length > 0) {
    console.log('\n❌ MISSING FUNCTIONS:');
    missingFunctions.forEach(({ slug, reason }) => {
      console.log(`   - ${slug}: ${reason}`);
    });
    console.log('\n🔧 REQUIRED ACTIONS:');
    console.log('   1. Create missing function directories');
    console.log('   2. Add index.ts files for each function');
    console.log('   3. Re-run validation before deployment');
    return false;
  } else {
    console.log('\n✅ ALL FUNCTIONS VALIDATED SUCCESSFULLY');
    console.log('Ready for deployment!');
    return true;
  }
}

// Run validation
if (require.main === module) {
  const isValid = validateFunctionSlugs();
  process.exit(isValid ? 0 : 1);
}

module.exports = { validateFunctionSlugs };
