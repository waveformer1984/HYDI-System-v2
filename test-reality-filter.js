/**
 * Tests for CASCADE Reality Filter
 * Confirms all four rules gate correctly
 */

const RealityFilter = require('./src/control/RealityFilter');

describe('CASCADE Reality Filter', () => {
  let filter;

  beforeAll(() => {
    filter = new RealityFilter();
  });

  describe('RULE 1: Lead Source Validation', () => {
    test('should allow proven sources', async () => {
      const task = {
        type: 'outreach',
        leadSource: 'linkedin'
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(true);
    });

    test('should block unproven sources without conversion signal', async () => {
      const task = {
        type: 'outreach',
        leadSource: 'random_scrape'
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('lacks conversion signal');
    });

    test('should allow sources with conversion signal', async () => {
      // Mock conversion data
      mockSupabase.from = () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              limit: () => Promise.resolve({ 
                data: [{ id: '1', status: 'paid' }], 
                error: null 
              })
            })
          }),
          limit: () => Promise.resolve({ data: [], error: null, count: 0 })
        }),
        insert: () => Promise.resolve({ data: null, error: null })
      });

      const task = {
        type: 'outreach',
        leadSource: 'new_source'
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(true);
    });
  });

  describe('RULE 2: Outreach Personalization Score', () => {
    test('should allow highly personalized messages', async () => {
      const task = {
        type: 'outreach',
        message: 'Hi Sarah at TechCorp - I noticed you need rapid prototyping for your new product. We can deliver 3D printed parts in 24 hours for $150.'
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(true);
    });

    test('should block generic messages', async () => {
      const task = {
        type: 'outreach',
        message: 'Dear friend, this is a limited time opportunity you cannot miss! Act now!'
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('blocked sales patterns');
    });

    test('should block messages with low personalization score', async () => {
      const task = {
        type: 'outreach',
        message: 'We offer 3D printing services. Contact us for more info.'
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('Personalization score');
    });
  });

  describe('RULE 3: Product Listing Demand Validation', () => {
    test('should allow products with demand signals', async () => {
      // Mock demand signals
      mockSupabase.from = () => ({
        select: () => ({
          eq: () => ({
            limit: () => Promise.resolve({ 
              data: [
                { signal_type: 'search_volume' },
                { signal_type: 'competitor_reviews' }
              ], 
              error: null 
            })
          })
        }),
        insert: () => Promise.resolve({ data: null, error: null })
      });

      const task = {
        type: 'product_listing',
        product: {
          category: 'organizers',
          searchVolume: 500,
          competitorReviews: 10
        }
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(true);
    });

    test('should block products without demand validation', async () => {
      const task = {
        type: 'product_listing',
        product: {
          category: 'random_gadget',
          searchVolume: 0,
          waitlistCount: 0,
          competitorReviews: 0,
          customerRequests: 0
        }
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('lacks demand validation');
    });
  });

  describe('RULE 4: Execution Margin Gate', () => {
    test('should allow tasks with sufficient margin', async () => {
      const task = {
        type: 'execution',
        estimatedRevenue: 200,
        estimatedCost: 100
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(true);
    });

    test('should block tasks with insufficient margin', async () => {
      const task = {
        type: 'execution',
        estimatedRevenue: 100,
        estimatedCost: 80
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('Margin 20.0% below threshold 30.0%');
    });

    test('should block tasks with uncalculable margin', async () => {
      const task = {
        type: 'execution',
        estimatedRevenue: null,
        estimatedCost: 50
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('Cannot calculate margin');
    });
  });

  describe('Integration Tests', () => {
    test('should pass multiple rules when valid', async () => {
      // Mock all required data
      mockSupabase.from = () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              limit: () => Promise.resolve({ 
                data: [{ id: '1', status: 'paid' }], 
                error: null 
              })
            }),
            limit: () => Promise.resolve({ 
              data: [
                { signal_type: 'search_volume' }
              ], 
              error: null 
            })
          }),
          limit: () => Promise.resolve({ data: [], error: null, count: 0 })
        }),
        insert: () => Promise.resolve({ data: null, error: null })
      });

      const task = {
        type: 'outreach',
        leadSource: 'linkedin',
        message: 'Hi John at StartupXYZ - I see you need rapid prototyping. We can deliver parts in 24 hours for $150.',
        estimatedRevenue: 150,
        estimatedCost: 100
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(true);
    });

    test('should fail on first rule violation', async () => {
      const task = {
        type: 'outreach',
        leadSource: 'unproven_source',
        message: 'Generic message without personalization',
        estimatedRevenue: 50,
        estimatedCost: 40
      };

      const result = await filter.filter(task);
      expect(result.approved).toBe(false);
      // Should fail on rule 1, not even check others
      expect(result.reason).toContain('lacks conversion signal');
    });
  });
});

// Run tests without Jest for simplicity
async function runTests() {
  console.log('🧪 Running CASCADE Reality Filter Tests...\n');
  
  const filter = new RealityFilter();
  let passed = 0;
  let total = 0;

  // Test 1: Lead Source Validation
  console.log('📍 RULE 1: Lead Source Validation');
  
  total++;
  const test1 = await filter.filter({ type: 'outreach', leadSource: 'linkedin' });
  if (test1.approved) {
    console.log('✅ Allows proven sources');
    passed++;
  } else {
    console.log('❌ Failed: Should allow proven sources');
  }

  total++;
  const test2 = await filter.filter({ type: 'outreach', leadSource: 'random_scrape' });
  if (!test2.approved && test2.reason.includes('conversion signal')) {
    console.log('✅ Blocks unproven sources');
    passed++;
  } else {
    console.log('❌ Failed: Should block unproven sources');
  }

  // Test 2: Personalization
  console.log('\n📍 RULE 2: Outreach Personalization');
  
  total++;
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

  total++;
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

  // Test 3: Product Demand
  console.log('\n📍 RULE 3: Product Demand Validation');
  
  total++;
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

  total++;
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

  // Test 4: Margin Gate
  console.log('\n📍 RULE 4: Execution Margin Gate');
  
  total++;
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

  total++;
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

  // Summary
  console.log(`\n📊 Test Results: ${passed}/${total} passed`);
  
  if (passed === total) {
    console.log('✅ All CASCADE Reality Filter rules are working correctly!');
  } else {
    console.log('❌ Some tests failed. Check the implementation.');
  }
}

// Run if called directly
if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests };
