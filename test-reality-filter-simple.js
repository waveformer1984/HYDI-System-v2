/**
 * Simple tests for CASCADE Reality Filter
 * Confirms all four rules gate correctly
 */

const RealityFilter = require('./src/control/RealityFilter');

// Override Supabase for testing
const originalRequire = require;
require = function(id) {
  if (id === '@supabase/supabase-js') {
    return {
      createClient: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({
              in: () => ({
                limit: () => Promise.resolve({ data: [], error: null })
              })
            }),
            limit: () => Promise.resolve({ data: [], error: null, count: 0 })
          }),
          insert: () => Promise.resolve({ data: null, error: null })
        })
      })
    };
  }
  return originalRequire.apply(this, arguments);
};

async function runTests() {
  console.log('🧪 Running CASCADE Reality Filter Tests...\n');
  
  const filter = new RealityFilter();
  let passed = 0;
  let total = 0;

  // Test 1: Lead Source Validation - Allowed source
  console.log('📍 RULE 1: Lead Source Validation');
  
  total++;
  try {
    const test1 = await filter.filter({ type: 'outreach', leadSource: 'linkedin' });
    if (test1.approved) {
      console.log('✅ Allows proven sources');
      passed++;
    } else {
      console.log('❌ Failed: Should allow proven sources');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Test 2: Lead Source Validation - Blocked source
  total++;
  try {
    const test2 = await filter.filter({ type: 'outreach', leadSource: 'random_scrape' });
    if (!test2.approved && test2.reason.includes('conversion signal')) {
      console.log('✅ Blocks unproven sources');
      passed++;
    } else {
      console.log('❌ Failed: Should block unproven sources');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Test 3: Personalization - Good message
  console.log('\n📍 RULE 2: Outreach Personalization');
  
  total++;
  try {
    const test3 = await filter.filter({
      type: 'outreach',
      message: 'Hi Sarah at TechCorp - I noticed you need rapid prototyping. We can deliver parts in 24 hours for $150.'
    });
    if (test3.approved) {
      console.log('✅ Allows personalized messages');
      passed++;
    } else {
      console.log('❌ Failed: Should allow personalized messages');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Test 4: Personalization - Blocked message
  total++;
  try {
    const test4 = await filter.filter({
      type: 'outreach',
      message: 'Dear friend, act now on this limited time opportunity!'
    });
    if (!test4.approved && test4.reason.includes('blocked')) {
      console.log('✅ Blocks generic spam');
      passed++;
    } else {
      console.log('❌ Failed: Should block generic spam');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Test 5: Product Demand - Has demand
  console.log('\n📍 RULE 3: Product Demand Validation');
  
  total++;
  try {
    const test5 = await filter.filter({
      type: 'product_listing',
      product: { category: 'organizers', searchVolume: 500 }
    });
    if (test5.approved) {
      console.log('✅ Allows products with demand');
      passed++;
    } else {
      console.log('❌ Failed: Should allow products with demand');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Test 6: Product Demand - No demand
  total++;
  try {
    const test6 = await filter.filter({
      type: 'product_listing',
      product: { category: 'random', searchVolume: 0 }
    });
    if (!test6.approved && test6.reason.includes('demand validation')) {
      console.log('✅ Blocks products without demand');
      passed++;
    } else {
      console.log('❌ Failed: Should block products without demand');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Test 7: Margin Gate - Good margin
  console.log('\n📍 RULE 4: Execution Margin Gate');
  
  total++;
  try {
    const test7 = await filter.filter({
      type: 'execution',
      estimatedRevenue: 200,
      estimatedCost: 100
    });
    if (test7.approved) {
      console.log('✅ Allows sufficient margin');
      passed++;
    } else {
      console.log('❌ Failed: Should allow sufficient margin');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Test 8: Margin Gate - Bad margin
  total++;
  try {
    const test8 = await filter.filter({
      type: 'execution',
      estimatedRevenue: 100,
      estimatedCost: 80
    });
    if (!test8.approved && test8.reason.includes('Margin')) {
      console.log('✅ Blocks insufficient margin');
      passed++;
    } else {
      console.log('❌ Failed: Should block insufficient margin');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Test 9: Margin Gate - No calculation
  total++;
  try {
    const test9 = await filter.filter({
      type: 'execution',
      estimatedRevenue: null,
      estimatedCost: 50
    });
    if (!test9.approved && test9.reason.includes('Cannot calculate margin')) {
      console.log('✅ Blocks uncalculable margin');
      passed++;
    } else {
      console.log('❌ Failed: Should block uncalculable margin');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Test 10: Non-relevant task passes through
  total++;
  try {
    const test10 = await filter.filter({
      type: 'system_check'
    });
    if (test10.approved) {
      console.log('✅ Non-relevant tasks pass through');
      passed++;
    } else {
      console.log('❌ Failed: Non-relevant tasks should pass through');
    }
  } catch (e) {
    console.log(`❌ Error: ${e.message}`);
  }

  // Summary
  console.log(`\n📊 Test Results: ${passed}/${total} passed`);
  
  if (passed === total) {
    console.log('✅ All CASCADE Reality Filter rules are working correctly!');
    console.log('\n🔹 Rule 1: Lead Source Validation - ✅');
    console.log('🔹 Rule 2: Outreach Personalization - ✅');
    console.log('🔹 Rule 3: Product Demand Validation - ✅');
    console.log('🔹 Rule 4: Execution Margin Gate - ✅');
    console.log('\nCASCADE is ready to kill bad tasks before they waste resources.');
  } else {
    console.log('❌ Some tests failed. Check the implementation.');
  }
}

// Run if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests };
